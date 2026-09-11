"""Tests for the official radio-presets sync feature.

Covers three layers:
- the pure normalization of the api.meshcore.nz payload,
- the httpx fetch (mocked transport, no network),
- the AppSettingsRepository persistence of a synced preset list,
- the radio-router GET / POST-sync / DELETE endpoints.
"""

from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException

from app.models import RadioPresetEntry, RadioPresetsStore
from app.repository import AppSettingsRepository
from app.routers.radio import (
    get_radio_presets,
    reset_radio_presets,
    sync_radio_presets,
)
from app.services.radio_presets import (
    OFFICIAL_PRESETS_URL,
    fetch_official_presets,
    normalize_upstream,
)

NL = RadioPresetEntry(name="Netherlands", freq=869.618, bw=62.5, sf=7, cr=5)

SAMPLE_UPSTREAM = {
    "config": {
        "suggested_radio_settings": {
            "info_message": "Community radio presets.",
            "entries": [
                {
                    "title": "Netherlands",
                    "description": "869.618MHz / SF7 / BW62.5 / CR5",
                    "frequency": "869.618",
                    "spreading_factor": "7",
                    "bandwidth": "62.5",
                    "coding_rate": "5",
                },
                {
                    "title": "Broken",
                    "description": "unparseable",
                    "frequency": "not-a-number",
                    "spreading_factor": "7",
                    "bandwidth": "62.5",
                    "coding_rate": "5",
                },
            ],
        }
    }
}


class TestNormalizeUpstream:
    def test_maps_upstream_entry_to_numeric_preset(self):
        entries, info = normalize_upstream(SAMPLE_UPSTREAM)

        assert info == "Community radio presets."
        assert entries == [RadioPresetEntry(name="Netherlands", freq=869.618, bw=62.5, sf=7, cr=5)]

    def test_skips_entries_that_fail_numeric_parse(self):
        entries, _ = normalize_upstream(SAMPLE_UPSTREAM)

        # The "Broken" entry has a non-numeric frequency and is dropped.
        assert [e.name for e in entries] == ["Netherlands"]

    def test_missing_suggested_radio_settings_yields_empty(self):
        entries, info = normalize_upstream({"config": {}})

        assert entries == []
        assert info == ""


class TestFetchOfficialPresets:
    @pytest.mark.asyncio
    async def test_fetches_and_normalizes_from_upstream(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert str(request.url) == OFFICIAL_PRESETS_URL
            return httpx.Response(200, json=SAMPLE_UPSTREAM)

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            entries, info = await fetch_official_presets(client=client)
        finally:
            await client.aclose()

        assert info == "Community radio presets."
        assert [e.name for e in entries] == ["Netherlands"]

    @pytest.mark.asyncio
    async def test_non_200_raises(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="unavailable")

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            with pytest.raises(httpx.HTTPStatusError):
                await fetch_official_presets(client=client)
        finally:
            await client.aclose()


class TestRadioPresetsPersistence:
    @pytest.mark.asyncio
    async def test_returns_none_when_never_synced(self, test_db):
        assert await AppSettingsRepository.get_radio_presets() is None

    @pytest.mark.asyncio
    async def test_set_then_get_round_trip(self, test_db):
        store = RadioPresetsStore(
            entries=[RadioPresetEntry(name="Netherlands", freq=869.618, bw=62.5, sf=7, cr=5)],
            info_message="hi",
            synced_at=1234567890,
            source_url=OFFICIAL_PRESETS_URL,
        )

        await AppSettingsRepository.set_radio_presets(store)
        fresh = await AppSettingsRepository.get_radio_presets()

        assert fresh == store

    @pytest.mark.asyncio
    async def test_clear_reverts_to_none(self, test_db):
        store = RadioPresetsStore(
            entries=[RadioPresetEntry(name="Netherlands", freq=869.618, bw=62.5, sf=7, cr=5)],
            info_message="hi",
            synced_at=1234567890,
            source_url=OFFICIAL_PRESETS_URL,
        )
        await AppSettingsRepository.set_radio_presets(store)

        await AppSettingsRepository.clear_radio_presets()

        assert await AppSettingsRepository.get_radio_presets() is None


class TestRadioPresetsRoutes:
    @pytest.mark.asyncio
    async def test_get_returns_never_synced_store_by_default(self, test_db):
        store = await get_radio_presets()

        assert store.entries == []
        assert store.synced_at is None
        assert store.source_url == OFFICIAL_PRESETS_URL

    @pytest.mark.asyncio
    async def test_sync_persists_and_returns_fetched_presets(self, test_db):
        with patch(
            "app.routers.radio.fetch_official_presets",
            new=AsyncMock(return_value=([NL], "Community radio presets.")),
        ):
            store = await sync_radio_presets()

        assert [e.name for e in store.entries] == ["Netherlands"]
        assert store.info_message == "Community radio presets."
        assert store.synced_at is not None
        assert store.source_url == OFFICIAL_PRESETS_URL

        # Persisted: a follow-up GET returns the same list.
        fetched = await get_radio_presets()
        assert [e.name for e in fetched.entries] == ["Netherlands"]
        assert fetched.synced_at == store.synced_at

    @pytest.mark.asyncio
    async def test_sync_upstream_failure_raises_502_and_keeps_prior_list(self, test_db):
        # Seed a previously synced list.
        with patch(
            "app.routers.radio.fetch_official_presets",
            new=AsyncMock(return_value=([NL], "first")),
        ):
            await sync_radio_presets()

        with patch(
            "app.routers.radio.fetch_official_presets",
            new=AsyncMock(side_effect=httpx.ConnectError("boom")),
        ):
            with pytest.raises(HTTPException) as exc:
                await sync_radio_presets()
        assert exc.value.status_code == 502

        # The earlier good list survives the failed sync.
        fetched = await get_radio_presets()
        assert [e.name for e in fetched.entries] == ["Netherlands"]
        assert fetched.info_message == "first"

    @pytest.mark.asyncio
    async def test_sync_with_zero_valid_entries_raises_502(self, test_db):
        with patch(
            "app.routers.radio.fetch_official_presets",
            new=AsyncMock(return_value=([], "empty")),
        ):
            with pytest.raises(HTTPException) as exc:
                await sync_radio_presets()
        assert exc.value.status_code == 502

        # Nothing persisted.
        assert await AppSettingsRepository.get_radio_presets() is None

    @pytest.mark.asyncio
    async def test_reset_clears_to_never_synced(self, test_db):
        with patch(
            "app.routers.radio.fetch_official_presets",
            new=AsyncMock(return_value=([NL], "info")),
        ):
            await sync_radio_presets()

        store = await reset_radio_presets()

        assert store.entries == []
        assert store.synced_at is None
        assert await AppSettingsRepository.get_radio_presets() is None
