"""Tests for the external analyzer node overlay sync."""

from unittest.mock import patch

import pytest

from app.models import ExternalMapNode
from app.repository.external_map import ExternalMapRepository
from app.services.external_map import _parse_nodes


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
    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            if error is not None:
                raise error
            return response

    return patch("app.services.external_map.httpx.AsyncClient", _FakeClient)


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
