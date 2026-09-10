"""Tests for the channel registry sync router."""

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
    """Patch httpx.AsyncClient used by the registry router."""

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

    return patch("app.routers.registry.httpx.AsyncClient", _FakeClient)


class TestRegistrySync:
    @pytest.mark.asyncio
    async def test_400_when_no_url_configured(self, test_db, client):
        resp = await client.get("/api/registry/sync")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_returns_normalised_channels(self, test_db, client):
        await AppSettingsRepository.update(registry_sync_url="https://example.com/ch.json")
        fake = _FakeResponse(payload={"#amsterdam": "deadbeef", "#rotterdam": "cafe"})
        with _patch_client(response=fake):
            resp = await client.get("/api/registry/sync")
        assert resp.status_code == 200
        channels = resp.json()["channels"]
        by_name = {c["name"]: c["key"] for c in channels}
        assert by_name == {"#amsterdam": "deadbeef", "#rotterdam": "cafe"}

    @pytest.mark.asyncio
    async def test_502_when_remote_not_json(self, test_db, client):
        await AppSettingsRepository.update(registry_sync_url="https://example.com/ch.json")
        fake = _FakeResponse(raise_json=True)
        with _patch_client(response=fake):
            resp = await client.get("/api/registry/sync")
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_502_when_remote_unreachable(self, test_db, client):
        await AppSettingsRepository.update(registry_sync_url="https://example.com/ch.json")
        with _patch_client(error=httpx.ConnectError("boom")):
            resp = await client.get("/api/registry/sync")
        assert resp.status_code == 502


class TestWordlistSync:
    @pytest.mark.asyncio
    async def test_400_when_no_url_configured(self, test_db, client):
        resp = await client.get("/api/registry/wordlist-sync")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_returns_string_array_filtering_non_strings(self, test_db, client):
        await AppSettingsRepository.update(wordlist_sync_url="https://example.com/words.json")
        fake = _FakeResponse(payload=["amsterdam", "rotterdam", 42, None, "#saarland"])
        with _patch_client(response=fake):
            resp = await client.get("/api/registry/wordlist-sync")
        assert resp.status_code == 200
        assert resp.json()["words"] == ["amsterdam", "rotterdam", "#saarland"]

    @pytest.mark.asyncio
    async def test_502_when_payload_not_array(self, test_db, client):
        await AppSettingsRepository.update(wordlist_sync_url="https://example.com/words.json")
        fake = _FakeResponse(payload={"amsterdam": "deadbeef"})
        with _patch_client(response=fake):
            resp = await client.get("/api/registry/wordlist-sync")
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_502_when_too_many_entries(self, test_db, client):
        from app.routers.registry import MAX_WORDLIST_ENTRIES

        await AppSettingsRepository.update(wordlist_sync_url="https://example.com/words.json")
        fake = _FakeResponse(payload=[f"w{i}" for i in range(MAX_WORDLIST_ENTRIES + 1)])
        with _patch_client(response=fake):
            resp = await client.get("/api/registry/wordlist-sync")
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_502_when_remote_not_json(self, test_db, client):
        await AppSettingsRepository.update(wordlist_sync_url="https://example.com/words.json")
        fake = _FakeResponse(raise_json=True)
        with _patch_client(response=fake):
            resp = await client.get("/api/registry/wordlist-sync")
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_502_when_remote_unreachable(self, test_db, client):
        await AppSettingsRepository.update(wordlist_sync_url="https://example.com/words.json")
        with _patch_client(error=httpx.ConnectError("boom")):
            resp = await client.get("/api/registry/wordlist-sync")
        assert resp.status_code == 502
