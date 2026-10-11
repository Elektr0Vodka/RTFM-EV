"""Who heard this packet: the analyzer answer parser, the HTTP call and the endpoint."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.models import AnalyzerSite
from app.path_utils import calculate_packet_hash
from app.routers.settings import AppSettingsUpdate, update_settings
from app.services.analyzer_packet_lookup import (
    MAX_OBSERVATIONS,
    PacketObservation,
    PacketObservations,
    fetch_packet_observations,
    parse_packet_observations,
)
from app.services.analyzer_path_check import AnalyzerCheckError

BASE = "https://analyzer.example"
# A packet and its hash as served by meshcore-analyzer.eu on 2026-10-10.
PACKET_HEX = "0902fcdcca0f0db91509b501d0fdf8c8951d6bdfb1b9727b"
PACKET_HASH = "00eb3a41ec998411"


def _observation(observer="AA" * 32, name="Obs", iata="AMS", heard="2026-10-10T20:58:28Z"):
    return {
        "observer_id": observer,
        "observer_name": name,
        "observer_iata": iata,
        "heard_at": heard,
        "rssi": -31,
        "snr": 12.25,
    }


class TestPacketHash:
    def test_our_hash_equals_the_analyzers_for_a_real_packet(self):
        assert calculate_packet_hash(bytes.fromhex(PACKET_HEX)).lower() == PACKET_HASH


class TestParsePacketObservations:
    def test_maps_the_analyzer_fields(self):
        result = parse_packet_observations(
            {"hash": PACKET_HASH, "observation_count": 1, "observations": [_observation()]}
        )

        assert result.found is True
        assert result.observation_count == 1
        assert result.observer_count == 1
        assert result.observations == [
            PacketObservation(
                observer_id="AA" * 32,
                observer_name="Obs",
                region="AMS",
                heard_at=1791665908.0,
                rssi=-31,
                snr=12.25,
            )
        ]

    def test_sorts_oldest_first_and_puts_untimed_entries_last(self):
        result = parse_packet_observations(
            {
                "observations": [
                    _observation(name="late", heard="2026-10-10T20:58:30.500Z"),
                    _observation(name="no time", heard=None),
                    _observation(name="early", heard="2026-10-10T20:58:28.636Z"),
                ]
            }
        )

        assert [o.observer_name for o in result.observations] == ["early", "late", "no time"]
        assert result.observations[0].heard_at == pytest.approx(1791665908.636)

    def test_counts_distinct_observers_not_receptions(self):
        result = parse_packet_observations(
            {
                "observations": [
                    _observation(observer="AA" * 32),
                    _observation(observer="AA" * 32, heard="2026-10-10T20:58:29Z"),
                    _observation(observer="BB" * 32),
                ]
            }
        )

        assert result.observation_count == 3
        assert result.observer_count == 2

    def test_keeps_the_analyzers_own_count_when_it_is_higher(self):
        result = parse_packet_observations(
            {"observation_count": 340, "observations": [_observation()]}
        )

        assert result.observation_count == 340

    def test_tolerates_missing_and_wrongly_typed_fields(self):
        result = parse_packet_observations(
            {
                "observations": [
                    "junk",
                    {"observer_name": "  ", "rssi": "loud", "snr": True, "heard_at": "soon"},
                ]
            }
        )

        assert result.observations == [
            PacketObservation(
                observer_id=None,
                observer_name=None,
                region=None,
                heard_at=None,
                rssi=None,
                snr=None,
            )
        ]
        assert result.observer_count == 0

    def test_a_packet_without_observations_is_still_found(self):
        result = parse_packet_observations({"hash": PACKET_HASH})

        assert result.found is True
        assert result.observations == []

    def test_caps_a_very_long_list_and_says_so(self):
        many = [_observation(observer=f"{i:064x}") for i in range(MAX_OBSERVATIONS + 5)]

        result = parse_packet_observations({"observations": many})

        assert len(result.observations) == MAX_OBSERVATIONS
        assert result.truncated is True
        assert result.observation_count == MAX_OBSERVATIONS + 5

    def test_anything_but_an_object_is_not_found(self):
        assert parse_packet_observations([]).found is False


class _FakeResponse:
    def __init__(self, status_code=200, payload=None, raise_json=False):
        self.status_code = status_code
        self._payload = payload
        self._raise_json = raise_json

    def json(self):
        if self._raise_json:
            raise ValueError("not json")
        return self._payload


def _patch_client(response=None, error=None):
    calls: list[str] = []

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, **kwargs):
            calls.append(url)
            if error is not None:
                raise error
            return response

    return patch("app.services.analyzer_packet_lookup.httpx.AsyncClient", _FakeClient), calls


class TestFetchPacketObservations:
    @pytest.mark.asyncio
    async def test_asks_for_the_lower_case_hash(self):
        patcher, calls = _patch_client(_FakeResponse(payload={"observations": [_observation()]}))
        with patcher:
            result = await fetch_packet_observations(BASE, PACKET_HASH.upper())

        assert calls == [f"{BASE}/api/packets/{PACKET_HASH}"]
        assert result.found is True
        assert len(result.observations) == 1

    @pytest.mark.asyncio
    async def test_a_404_means_the_analyzer_does_not_know_the_packet(self):
        patcher, _calls = _patch_client(_FakeResponse(404))
        with patcher:
            result = await fetch_packet_observations(BASE, PACKET_HASH)

        assert result == PacketObservations(found=False)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("kwargs", "message"),
        [
            ({"error": httpx.ConnectError("boom")}, "Could not reach analyzer"),
            ({"response": _FakeResponse(500)}, "HTTP 500"),
            ({"response": _FakeResponse(raise_json=True)}, "not JSON"),
            ({"response": _FakeResponse(payload=[1, 2])}, "expected object"),
        ],
    )
    async def test_failures_raise(self, kwargs, message):
        patcher, _calls = _patch_client(**kwargs)
        with patcher, pytest.raises(AnalyzerCheckError, match=message):
            await fetch_packet_observations(BASE, PACKET_HASH)


class TestWhoHeardEndpoint:
    @pytest.mark.asyncio
    async def test_without_lookup_nothing_is_asked(self, test_db, client):
        fetch = AsyncMock()
        with patch("app.routers.packets.fetch_packet_observations", fetch):
            response = await client.post("/api/packets/who-heard", json={"data": PACKET_HEX})

        assert response.status_code == 200
        body = response.json()
        assert body["packet_hash"] == PACKET_HASH
        assert body["analyzer_url"] == "https://meshcore-analyzer.eu"
        assert body["looked_up"] is False
        assert body["observers"] == []
        fetch.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_links_come_from_the_sites_that_have_a_packet_template(self, test_db, client):
        await update_settings(
            AppSettingsUpdate(
                analyzer_sites=[
                    AnalyzerSite(
                        name="With packets",
                        node_url_template="https://a.example/node/{pubkey}",
                        packet_url_template="https://a.example/#/packets/{hash}",
                    ),
                    AnalyzerSite(
                        name="Nodes only",
                        node_url_template="https://b.example/node/{pubkey}",
                    ),
                ]
            )
        )

        response = await client.post("/api/packets/who-heard", json={"data": PACKET_HEX})

        assert response.json()["links"] == [
            {"name": "With packets", "url": f"https://a.example/#/packets/{PACKET_HASH}"}
        ]

    @pytest.mark.asyncio
    async def test_lookup_uses_the_host_of_the_external_map_url(self, test_db, client):
        await update_settings(
            AppSettingsUpdate(external_map_sync_url="https://other.example/api/nodes")
        )
        fetch = AsyncMock(
            return_value=PacketObservations(
                found=True,
                observation_count=2,
                observer_count=1,
                observations=[
                    PacketObservation("AA" * 32, "Obs", "AMS", 1791665908.0, -31, 12.25),
                    PacketObservation("AA" * 32, "Obs", "AMS", 1791665909.5, -40, 9.0),
                ],
            )
        )
        with patch("app.routers.packets.fetch_packet_observations", fetch):
            response = await client.post(
                "/api/packets/who-heard", json={"data": PACKET_HEX.upper(), "lookup": True}
            )

        assert response.status_code == 200
        fetch.assert_awaited_once_with("https://other.example", PACKET_HASH)
        body = response.json()
        assert body["looked_up"] is True
        assert body["found"] is True
        assert body["observation_count"] == 2
        assert body["observer_count"] == 1
        assert body["observers"][0] == {
            "observer_id": "AA" * 32,
            "observer_name": "Obs",
            "region": "AMS",
            "heard_at": 1791665908.0,
            "rssi": -31,
            "snr": 12.25,
        }

    @pytest.mark.asyncio
    async def test_a_packet_the_analyzer_does_not_know(self, test_db, client):
        fetch = AsyncMock(return_value=PacketObservations(found=False))
        with patch("app.routers.packets.fetch_packet_observations", fetch):
            response = await client.post(
                "/api/packets/who-heard", json={"data": PACKET_HEX, "lookup": True}
            )

        body = response.json()
        assert body["looked_up"] is True
        assert body["found"] is False
        assert body["observers"] == []

    @pytest.mark.asyncio
    async def test_an_unreachable_analyzer_is_a_502(self, test_db, client):
        fetch = AsyncMock(side_effect=AnalyzerCheckError("Could not reach analyzer: boom"))
        with patch("app.routers.packets.fetch_packet_observations", fetch):
            response = await client.post(
                "/api/packets/who-heard", json={"data": PACKET_HEX, "lookup": True}
            )

        assert response.status_code == 502
        assert "Could not reach analyzer" in response.json()["detail"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("data", ["zz", "0", ""])
    async def test_rejects_data_that_is_not_a_packet(self, test_db, client, data):
        fetch = AsyncMock()
        with patch("app.routers.packets.fetch_packet_observations", fetch):
            response = await client.post(
                "/api/packets/who-heard", json={"data": data, "lookup": True}
            )

        assert response.status_code == 400
        fetch.assert_not_awaited()
