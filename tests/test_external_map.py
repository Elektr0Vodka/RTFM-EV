"""Tests for the external analyzer node overlay sync."""

import re
from unittest.mock import patch

import pytest

from app.models import ExternalMapNode
from app.repository.external_map import ExternalMapRepository
from app.repository.settings import AppSettingsRepository
from app.services.external_map import (
    MESHCORE_MAP_NODES_URL,
    ExternalMapSyncError,
    _parse_meshcore_map_nodes,
    _parse_nodes,
    sync_external_map,
)


class _FakeResponse:
    def __init__(self, status_code=200, payload=None, raise_json=False):
        self.status_code = status_code
        self._payload = payload
        self._raise_json = raise_json

    def json(self):
        if self._raise_json:
            raise ValueError("not json")
        return self._payload


def _patch_client(response=None, error=None, calls=None):
    class _FakeClient:
        def __init__(self, *a, **k):
            self._headers = k.get("headers") or {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            if calls is not None:
                calls.append((url, dict(self._headers)))
            if error is not None:
                raise error
            return response

    return patch("app.services.external_map.httpx.AsyncClient", _FakeClient)


class TestParseMeshcoreMapNodes:
    def test_keeps_located_nodes_and_maps_type_to_role(self):
        nodes = _parse_meshcore_map_nodes(
            [
                {
                    "public_key": "AbCd" + "0" * 60,
                    "type": 2,
                    "adv_name": "Repeater One",
                    # Node clock: ignored (can be years off).
                    "last_advert": "2087-11-13T14:33:41.000Z",
                    "updated_date": "2026-10-17T21:28:21.000Z",
                    "adv_lat": 52.1,
                    "adv_lon": 4.2,
                    "params": {"freq": 869.618},
                    "link": "meshcore://...",
                },
                {"public_key": "b" * 64, "type": 1, "adv_lat": 51.0, "adv_lon": 5.0},
                {"public_key": "c" * 64, "type": 3, "adv_lat": 51.0, "adv_lon": 5.0},
                {"public_key": "d" * 64, "type": 4, "adv_lat": 51.0, "adv_lon": 5.0},
                {"public_key": "e" * 64, "type": 9, "adv_lat": 51.0, "adv_lon": 5.0},
            ]
        )
        assert [n.role for n in nodes] == [
            "Repeater",
            "Companion",
            "Roomserver",
            "Sensor",
            "Unknown",
        ]
        n = nodes[0]
        assert n.pubkey == ("abcd" + "0" * 60)  # lowercased
        assert n.name == "Repeater One"
        assert n.lat == 52.1 and n.lon == 4.2
        assert n.last_seen == 1792272501  # from updated_date
        assert n.advert_count == 0 and n.mobile is False

    def test_drops_unlocated_and_bad_entries(self):
        nodes = _parse_meshcore_map_nodes(
            [
                {"public_key": "a" * 64, "adv_lat": None, "adv_lon": None},
                {"public_key": "b" * 64, "adv_lat": 0, "adv_lon": 0},  # null island
                {"public_key": "c" * 64, "adv_lat": 52.0, "adv_lon": 181.0},
                {"public_key": "", "adv_lat": 52.0, "adv_lon": 4.0},
                {"ID": "f" * 64, "Lat": 52.0, "Lon": 4.0},  # analyzer shape
                "not-an-object",
                {"public_key": "d" * 64, "adv_lat": 51.5, "adv_lon": 5.5},
            ]
        )
        assert [n.pubkey for n in nodes] == ["d" * 64]

    def test_non_array_raises(self):
        with pytest.raises(ExternalMapSyncError):
            _parse_meshcore_map_nodes({"nodes": []})


class TestSyncSource:
    @pytest.mark.asyncio
    async def test_meshcore_map_ignores_url_and_identifies(self, test_db):
        calls: list = []
        fake = _FakeResponse(
            payload=[{"public_key": "a" * 64, "type": 2, "adv_lat": 52.0, "adv_lon": 4.0}]
        )
        with _patch_client(response=fake, calls=calls):
            count, _ = await sync_external_map("https://analyzer.example/api/nodes", "meshcore_map")
        assert count == 1
        url, headers = calls[0]
        assert url == MESHCORE_MAP_NODES_URL
        assert re.fullmatch(r"RTFM-EV/\S+", headers["User-Agent"])

    @pytest.mark.asyncio
    async def test_analyzer_uses_url_and_default_user_agent(self, test_db):
        calls: list = []
        fake = _FakeResponse(payload=[{"ID": "a" * 64, "Lat": 52.0, "Lon": 4.0}])
        with _patch_client(response=fake, calls=calls):
            count, _ = await sync_external_map("https://analyzer.example/api/nodes", "analyzer")
        assert count == 1
        assert calls == [("https://analyzer.example/api/nodes", {})]


class TestParseNodes:
    def test_keeps_located_nodes_and_normalises(self):
        nodes = _parse_nodes(
            [
                {
                    "ID": "AbCd" + "0" * 60,
                    "Name": "Repeater One",
                    "Role": "Repeater",
                    "Lat": 52.1,
                    "Lon": 4.2,
                    "LastSeen": "2026-09-12T02:16:11Z",
                    "AdvertCount": 42,
                    "Mobile": True,
                }
            ]
        )
        assert len(nodes) == 1
        n = nodes[0]
        assert n.pubkey == ("abcd" + "0" * 60)  # lowercased
        assert n.role == "Repeater"
        assert n.lat == 52.1 and n.lon == 4.2
        assert n.last_seen is not None and n.last_seen > 0
        assert n.mobile is True
        assert n.advert_count == 42

    def test_drops_unlocated_and_bad_coordinates(self):
        nodes = _parse_nodes(
            [
                {"ID": "a" * 64, "Lat": None, "Lon": None},  # no location
                {"ID": "b" * 64, "Lat": 0, "Lon": 0},  # null island
                {"ID": "c" * 64, "Lat": 91.0, "Lon": 5.0},  # out of range
                {"ID": "", "Lat": 52.0, "Lon": 4.0},  # empty id
                "not-an-object",
                {"Lat": 52.0, "Lon": 4.0},  # missing id
                {"ID": "d" * 64, "Lat": 51.5, "Lon": 5.5},  # valid
            ]
        )
        assert [n.pubkey for n in nodes] == ["d" * 64]

    def test_non_array_raises(self):
        from app.services.external_map import ExternalMapSyncError

        with pytest.raises(ExternalMapSyncError):
            _parse_nodes({"nodes": []})


class TestRepository:
    @pytest.mark.asyncio
    async def test_replace_all_and_bbox_query(self, test_db):
        nodes = [
            ExternalMapNode(pubkey="a" * 64, name="In", role="Repeater", lat=52.0, lon=4.0),
            ExternalMapNode(pubkey="b" * 64, name="Out", role="Repeater", lat=10.0, lon=10.0),
        ]
        written = await ExternalMapRepository.replace_all(nodes, source="u", synced_at=123)
        assert written == 2

        in_box = await ExternalMapRepository.query_bbox(51.0, 3.0, 53.0, 5.0)
        assert [n.pubkey for n in in_box] == ["a" * 64]

        count, last = await ExternalMapRepository.status()
        assert count == 2 and last == 123

    @pytest.mark.asyncio
    async def test_replace_all_is_a_full_refresh(self, test_db):
        await ExternalMapRepository.replace_all(
            [ExternalMapNode(pubkey="a" * 64, lat=52.0, lon=4.0)], source="u", synced_at=1
        )
        await ExternalMapRepository.replace_all(
            [ExternalMapNode(pubkey="c" * 64, lat=52.0, lon=4.0)], source="u", synced_at=2
        )
        count, _ = await ExternalMapRepository.status()
        assert count == 1
        remaining = await ExternalMapRepository.query_bbox(-90, -180, 90, 180)
        assert [n.pubkey for n in remaining] == ["c" * 64]


class TestRouter:
    @pytest.mark.asyncio
    async def test_sync_fetches_and_stores(self, test_db, client):
        await AppSettingsRepository.update(external_map_source="analyzer")
        fake = _FakeResponse(
            payload=[
                {"ID": "a" * 64, "Role": "Repeater", "Lat": 52.0, "Lon": 4.0},
                {"ID": "b" * 64, "Role": "Companion", "Lat": None, "Lon": None},
            ]
        )
        with _patch_client(response=fake):
            resp = await client.post("/api/external-map/sync")
        assert resp.status_code == 200
        assert resp.json()["count"] == 1  # unlocated node dropped

    @pytest.mark.asyncio
    async def test_sync_upstream_error_is_502(self, test_db, client):
        fake = _FakeResponse(status_code=503, payload=None)
        with _patch_client(response=fake):
            resp = await client.post("/api/external-map/sync")
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_nodes_endpoint_bbox_filters(self, test_db, client):
        await ExternalMapRepository.replace_all(
            [
                ExternalMapNode(pubkey="a" * 64, lat=52.0, lon=4.0),
                ExternalMapNode(pubkey="b" * 64, lat=10.0, lon=10.0),
            ],
            source="u",
            synced_at=1,
        )
        resp = await client.get(
            "/api/external-map/nodes", params={"west": 3, "south": 51, "east": 5, "north": 53}
        )
        assert resp.status_code == 200
        assert [n["pubkey"] for n in resp.json()] == ["a" * 64]

    @pytest.mark.asyncio
    async def test_status_endpoint(self, test_db, client):
        resp = await client.get("/api/external-map/status")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 0
        assert body["enabled"] is False

    @pytest.mark.asyncio
    async def test_source_defaults_to_meshcore_map_and_is_patchable(self, test_db, client):
        resp = await client.get("/api/settings")
        assert resp.json()["external_map_source"] == "meshcore_map"

        resp = await client.patch("/api/settings", json={"external_map_source": "analyzer"})
        assert resp.status_code == 200
        assert resp.json()["external_map_source"] == "analyzer"

        resp = await client.patch("/api/settings", json={"external_map_source": "bogus"})
        assert resp.status_code == 422
