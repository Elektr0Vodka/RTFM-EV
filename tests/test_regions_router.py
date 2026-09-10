"""Tests for the analyzer region sync router."""

from unittest.mock import patch

import httpx
import pytest

from app.repository import AppSettingsRepository


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
    """Patch httpx.AsyncClient used by the regions router."""

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

    return patch("app.routers.regions.httpx.AsyncClient", _FakeClient)


class TestRegionSync:
    @pytest.mark.asyncio
    async def test_400_when_no_url_configured(self, test_db, client):
        resp = await client.get("/api/regions/sync")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_maps_codes_only_and_dedupes(self, test_db, client):
        # The display ``name`` is ignored: a scoped packet's transport code is
        # derived from the region *code*, so only the code can resolve.
        await AppSettingsRepository.update(
            region_sync_url="https://meshcore-analyzer.eu/api/regions/scopes"
        )
        fake = _FakeResponse(
            payload=[
                {"code": "nl-dr", "name": "Drenthe"},
                {"code": "nl", "name": ""},
                {"code": "nl-dr", "name": "drenthe"},  # case-insensitive dup, dropped
                {"code": "*", "name": ""},  # wildcard sentinel, dropped
                {"code": "de-bw", "name": "Baden-Wurttemberg"},
            ]
        )
        with _patch_client(response=fake):
            resp = await client.get("/api/regions/sync")
        assert resp.status_code == 200
        assert resp.json()["regions"] == ["nl-dr", "nl", "de-bw"]

    @pytest.mark.asyncio
    async def test_ignores_non_object_and_entries_without_string_code(self, test_db, client):
        await AppSettingsRepository.update(region_sync_url="https://example.com/regions.json")
        fake = _FakeResponse(
            payload=[
                "not-an-object",
                {"code": 123, "name": None},  # non-string code, dropped
                {"name": "Utrecht"},  # code missing, dropped (name is not usable)
                {"code": "nl-ut", "name": "Utrecht"},
            ]
        )
        with _patch_client(response=fake):
            resp = await client.get("/api/regions/sync")
        assert resp.status_code == 200
        assert resp.json()["regions"] == ["nl-ut"]

    @pytest.mark.asyncio
    async def test_502_when_payload_not_array(self, test_db, client):
        await AppSettingsRepository.update(region_sync_url="https://example.com/regions.json")
        fake = _FakeResponse(payload={"code": "nl", "name": "Netherlands"})
        with _patch_client(response=fake):
            resp = await client.get("/api/regions/sync")
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_502_when_remote_not_json(self, test_db, client):
        await AppSettingsRepository.update(region_sync_url="https://example.com/regions.json")
        fake = _FakeResponse(raise_json=True)
        with _patch_client(response=fake):
            resp = await client.get("/api/regions/sync")
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_502_when_remote_unreachable(self, test_db, client):
        await AppSettingsRepository.update(region_sync_url="https://example.com/regions.json")
        with _patch_client(error=httpx.ConnectError("boom")):
            resp = await client.get("/api/regions/sync")
        assert resp.status_code == 502
