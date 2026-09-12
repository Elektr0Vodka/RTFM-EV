"""Tests for settings router endpoints and validation behavior."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from meshcore import EventType

from app.models import CONTACT_TYPE_REPEATER, AnalyzerSite, AppSettings, ContactUpsert
from app.repository import AppSettingsRepository, ContactRepository
from app.routers.settings import (
    AppSettingsUpdate,
    FavoriteRequest,
    TrackedTelemetryRequest,
    get_telemetry_schedule,
    toggle_favorite,
    toggle_tracked_telemetry,
    update_settings,
)
from app.services.flood_scope import FORCE_UNSCOPED_FRAME


class TestUpdateSettings:
    @pytest.mark.asyncio
    async def test_forwards_only_provided_fields(self, test_db):
        result = await update_settings(
            AppSettingsUpdate(
                max_radio_contacts=321,
                advert_interval=3600,
            )
        )

        assert result.max_radio_contacts == 321
        assert result.advert_interval == 3600

    @pytest.mark.asyncio
    async def test_advert_interval_below_minimum_is_clamped_to_one_hour(self, test_db):
        result = await update_settings(AppSettingsUpdate(advert_interval=600))
        assert result.advert_interval == 3600

    @pytest.mark.asyncio
    async def test_advert_interval_zero_stays_disabled(self, test_db):
        result = await update_settings(AppSettingsUpdate(advert_interval=0))
        assert result.advert_interval == 0

    @pytest.mark.asyncio
    async def test_advert_interval_above_minimum_is_preserved(self, test_db):
        result = await update_settings(AppSettingsUpdate(advert_interval=86400))
        assert result.advert_interval == 86400

    @pytest.mark.asyncio
    async def test_empty_patch_returns_current_settings(self, test_db):
        result = await update_settings(AppSettingsUpdate())

        # Should return default settings without error
        assert isinstance(result, AppSettings)
        assert result.max_radio_contacts == 200  # default

    @pytest.mark.asyncio
    async def test_show_mention_ticker_defaults_enabled(self, test_db):
        result = await update_settings(AppSettingsUpdate())
        assert result.show_mention_ticker is True

    @pytest.mark.asyncio
    async def test_show_mention_ticker_round_trip(self, test_db):
        """show_mention_ticker should be saved and retrieved correctly."""
        result = await update_settings(AppSettingsUpdate(show_mention_ticker=False))
        assert result.show_mention_ticker is False

        fresh = await AppSettingsRepository.get()
        assert fresh.show_mention_ticker is False

    @pytest.mark.asyncio
    async def test_auto_add_mentioned_channels_defaults_disabled(self, test_db):
        result = await update_settings(AppSettingsUpdate())
        assert result.auto_add_mentioned_channels is False

    @pytest.mark.asyncio
    async def test_auto_add_mentioned_channels_round_trip(self, test_db):
        result = await update_settings(AppSettingsUpdate(auto_add_mentioned_channels=True))
        assert result.auto_add_mentioned_channels is True
        fresh = await AppSettingsRepository.get()
        assert fresh.auto_add_mentioned_channels is True

    @pytest.mark.asyncio
    async def test_registry_sync_url_defaults_empty(self, test_db):
        result = await update_settings(AppSettingsUpdate())
        assert result.registry_sync_url == ""

    @pytest.mark.asyncio
    async def test_registry_sync_url_round_trip(self, test_db):
        url = "https://example.com/channels.json"
        result = await update_settings(AppSettingsUpdate(registry_sync_url=url))
        assert result.registry_sync_url == url

        fresh = await AppSettingsRepository.get()
        assert fresh.registry_sync_url == url

    @pytest.mark.asyncio
    async def test_region_sync_url_defaults_empty(self, test_db):
        result = await update_settings(AppSettingsUpdate())
        assert result.region_sync_url == ""

    @pytest.mark.asyncio
    async def test_region_sync_url_round_trip(self, test_db):
        url = "https://meshcore-analyzer.eu/api/regions/scopes"
        result = await update_settings(AppSettingsUpdate(region_sync_url=url))
        assert result.region_sync_url == url

        fresh = await AppSettingsRepository.get()
        assert fresh.region_sync_url == url

    @pytest.mark.asyncio
    async def test_wordlist_sync_url_defaults_empty(self, test_db):
        result = await update_settings(AppSettingsUpdate())
        assert result.wordlist_sync_url == ""

    @pytest.mark.asyncio
    async def test_wordlist_sync_url_round_trip(self, test_db):
        url = "https://example.com/wordlist.json"
        result = await update_settings(AppSettingsUpdate(wordlist_sync_url=url))
        assert result.wordlist_sync_url == url

        fresh = await AppSettingsRepository.get()
        assert fresh.wordlist_sync_url == url

    @pytest.mark.asyncio
    async def test_analyzer_sites_defaults_empty(self, test_db):
        result = await update_settings(AppSettingsUpdate())
        assert result.analyzer_sites == []

    @pytest.mark.asyncio
    async def test_analyzer_sites_round_trip(self, test_db):
        sites = [
            AnalyzerSite(
                name="mc-radar",
                node_url_template="https://mc-radar.woodwar.com/node/{pubkey}",
            )
        ]
        result = await update_settings(AppSettingsUpdate(analyzer_sites=sites))
        assert len(result.analyzer_sites) == 1
        assert result.analyzer_sites[0].name == "mc-radar"
        assert result.analyzer_sites[0].node_url_template.endswith("/node/{pubkey}")
        assert result.analyzer_sites[0].packet_url_template is None

        fresh = await AppSettingsRepository.get()
        assert fresh.analyzer_sites == result.analyzer_sites

    @pytest.mark.asyncio
    async def test_analyzer_sites_packet_template_round_trip(self, test_db):
        sites = [
            AnalyzerSite(
                name="cornmeister",
                node_url_template="https://cornmeister.nl/#node?id={pubkey}",
                packet_url_template="https://cornmeister.nl/#packets?hash={hash}",
            )
        ]
        result = await update_settings(AppSettingsUpdate(analyzer_sites=sites))
        assert result.analyzer_sites[0].packet_url_template == (
            "https://cornmeister.nl/#packets?hash={hash}"
        )

    @pytest.mark.asyncio
    async def test_analyzer_sites_name_and_template_stripped(self, test_db):
        sites = [
            AnalyzerSite(
                name="  mc-radar  ",
                node_url_template="  https://mc-radar.woodwar.com/node/{pubkey}  ",
            )
        ]
        result = await update_settings(AppSettingsUpdate(analyzer_sites=sites))
        assert result.analyzer_sites[0].name == "mc-radar"
        assert result.analyzer_sites[0].node_url_template == (
            "https://mc-radar.woodwar.com/node/{pubkey}"
        )

    @pytest.mark.asyncio
    async def test_analyzer_sites_rejects_missing_pubkey_placeholder(self, test_db):
        sites = [AnalyzerSite(name="bad", node_url_template="https://example.com/node")]
        with pytest.raises(HTTPException) as exc:
            await update_settings(AppSettingsUpdate(analyzer_sites=sites))
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_analyzer_sites_rejects_non_http_template(self, test_db):
        sites = [AnalyzerSite(name="bad", node_url_template="javascript:alert('{pubkey}')")]
        with pytest.raises(HTTPException) as exc:
            await update_settings(AppSettingsUpdate(analyzer_sites=sites))
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_analyzer_sites_rejects_empty_name(self, test_db):
        sites = [AnalyzerSite(name="   ", node_url_template="https://example.com/{pubkey}")]
        with pytest.raises(HTTPException) as exc:
            await update_settings(AppSettingsUpdate(analyzer_sites=sites))
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_analyzer_sites_rejects_bad_packet_template(self, test_db):
        sites = [
            AnalyzerSite(
                name="ok",
                node_url_template="https://example.com/{pubkey}",
                packet_url_template="https://example.com/packet-no-placeholder",
            )
        ]
        with pytest.raises(HTTPException) as exc:
            await update_settings(AppSettingsUpdate(analyzer_sites=sites))
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_flood_scope_round_trip(self, test_db):
        """Flood scope should be saved and retrieved correctly."""
        result = await update_settings(AppSettingsUpdate(flood_scope="MyRegion"))
        assert result.flood_scope == "#MyRegion"

        fresh = await AppSettingsRepository.get()
        assert fresh.flood_scope == "#MyRegion"

    @pytest.mark.asyncio
    async def test_flood_scope_default_empty(self, test_db):
        """Fresh DB should have flood_scope as empty string."""
        settings = await AppSettingsRepository.get()
        assert settings.flood_scope == ""

    @pytest.mark.asyncio
    async def test_flood_scope_whitespace_stripped(self, test_db):
        """Flood scope should be stripped of whitespace."""
        result = await update_settings(AppSettingsUpdate(flood_scope="  MyRegion  "))
        assert result.flood_scope == "#MyRegion"

    @pytest.mark.asyncio
    async def test_flood_scope_existing_hash_is_not_doubled(self, test_db):
        """Existing leading hash should be preserved for backward compatibility."""
        result = await update_settings(AppSettingsUpdate(flood_scope="#MyRegion"))
        assert result.flood_scope == "#MyRegion"

    @pytest.mark.asyncio
    async def test_known_regions_round_trip(self, test_db):
        """Known regions should be saved and retrieved as a clean list."""
        result = await update_settings(AppSettingsUpdate(known_regions=["nl-gr", "de-by"]))
        assert result.known_regions == ["nl-gr", "de-by"]

        fresh = await AppSettingsRepository.get()
        assert fresh.known_regions == ["nl-gr", "de-by"]

    @pytest.mark.asyncio
    async def test_known_regions_default_empty(self, test_db):
        """Fresh DB should have known_regions as an empty list."""
        settings = await AppSettingsRepository.get()
        assert settings.known_regions == []

    @pytest.mark.asyncio
    async def test_known_regions_cleaned_and_deduped(self, test_db):
        """Leading hashes, whitespace, blanks, and case-insensitive dupes are normalized."""
        result = await update_settings(
            AppSettingsUpdate(known_regions=["  #nl-gr ", "", "nl-gr", "DE-BY", "de-by"])
        )
        assert result.known_regions == ["nl-gr", "DE-BY"]

    @pytest.mark.asyncio
    async def test_known_regions_change_triggers_backfill(self, test_db):
        """Changing the region list schedules a background message re-tag."""
        import asyncio

        with patch(
            "app.services.messages.backfill_message_regions", new_callable=AsyncMock
        ) as mock_backfill:
            await update_settings(AppSettingsUpdate(known_regions=["nl-gr", "de-by"]))
            await asyncio.sleep(0)  # let the scheduled task run

        mock_backfill.assert_awaited_once_with(["nl-gr", "de-by"])

    @pytest.mark.asyncio
    async def test_known_regions_unchanged_skips_backfill(self, test_db):
        """Saving the same region list does not re-run the backfill."""
        import asyncio

        await update_settings(AppSettingsUpdate(known_regions=["nl-gr"]))
        with patch(
            "app.services.messages.backfill_message_regions", new_callable=AsyncMock
        ) as mock_backfill:
            await update_settings(AppSettingsUpdate(known_regions=["#nl-gr"]))  # same after cleanup
            await asyncio.sleep(0)

        mock_backfill.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_flood_scope_applies_to_radio(self, test_db):
        """When radio is connected, setting flood_scope calls set_flood_scope on radio."""
        mock_mc = AsyncMock()
        mock_mc.commands.set_flood_scope = AsyncMock()

        mock_rm = AsyncMock()
        mock_rm.is_connected = True
        mock_rm.meshcore = mock_mc
        mock_rm.firmware_ver_code = 13  # supports mode-1 unscoped

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def mock_radio_op(name):
            yield mock_mc

        mock_rm.radio_operation = mock_radio_op

        with patch("app.radio.radio_manager", mock_rm):
            await update_settings(AppSettingsUpdate(flood_scope="TestRegion"))

        mock_mc.commands.set_flood_scope.assert_awaited_once_with("#TestRegion")

    @pytest.mark.asyncio
    async def test_flood_scope_empty_resets_radio(self, test_db):
        """Setting flood_scope to empty calls set_flood_scope("") on radio."""
        # First set a non-empty scope
        await update_settings(AppSettingsUpdate(flood_scope="#TestRegion"))

        mock_mc = AsyncMock()
        mock_mc.commands.set_flood_scope = AsyncMock()

        mock_rm = AsyncMock()
        mock_rm.is_connected = True
        mock_rm.meshcore = mock_mc
        mock_rm.firmware_ver_code = 13  # supports mode-1 unscoped

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def mock_radio_op(name):
            yield mock_mc

        mock_rm.radio_operation = mock_radio_op

        with patch("app.radio.radio_manager", mock_rm):
            await update_settings(AppSettingsUpdate(flood_scope=""))

        mock_mc.commands.send.assert_awaited_once_with(
            FORCE_UNSCOPED_FRAME, [EventType.OK, EventType.ERROR]
        )
        mock_mc.commands.set_flood_scope.assert_not_awaited()


class TestToggleFavorite:
    @pytest.mark.asyncio
    async def test_adds_when_not_favorited(self, test_db):
        await ContactRepository.upsert(ContactUpsert(public_key="aa" * 32, name="Alice"))
        request = FavoriteRequest(type="contact", id="aa" * 32)
        with (
            patch("app.radio_sync.ensure_contact_on_radio", new_callable=AsyncMock) as mock_sync,
            patch("app.routers.settings.asyncio.create_task") as mock_create_task,
        ):
            mock_create_task.side_effect = lambda coro: coro.close()
            result = await toggle_favorite(request)

        assert result.favorite is True
        assert result.type == "contact"
        assert result.id == "aa" * 32
        mock_sync.assert_called_once_with("aa" * 32, force=True)
        mock_create_task.assert_called_once()

    @pytest.mark.asyncio
    async def test_removes_when_already_favorited(self, test_db):
        await ContactRepository.upsert(ContactUpsert(public_key="aa" * 32, name="Alice"))
        await ContactRepository.set_favorite("aa" * 32, True)

        request = FavoriteRequest(type="contact", id="aa" * 32)
        with (
            patch("app.radio_sync.ensure_contact_on_radio", new_callable=AsyncMock) as mock_sync,
            patch("app.routers.settings.asyncio.create_task") as mock_create_task,
        ):
            mock_create_task.side_effect = lambda coro: coro.close()
            result = await toggle_favorite(request)

        assert result.favorite is False
        mock_sync.assert_not_called()
        mock_create_task.assert_not_called()


class TestToggleTrackedTelemetry:
    """Tests for POST /settings/tracked-telemetry/toggle."""

    async def _create_repeater(self, key: str, name: str = "TestRepeater") -> None:
        await ContactRepository.upsert(
            ContactUpsert(public_key=key, name=name, type=CONTACT_TYPE_REPEATER)
        )

    @pytest.mark.asyncio
    async def test_add_repeater_to_tracking(self, test_db):
        key = "aa" * 32
        await self._create_repeater(key)

        result = await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key=key))

        assert key in result.tracked_telemetry_repeaters
        assert result.names[key] == "TestRepeater"

        # Verify persisted
        settings = await AppSettingsRepository.get()
        assert key in settings.tracked_telemetry_repeaters

    @pytest.mark.asyncio
    async def test_remove_repeater_from_tracking(self, test_db):
        key = "bb" * 32
        await self._create_repeater(key)
        await AppSettingsRepository.update(tracked_telemetry_repeaters=[key])

        result = await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key=key))

        assert key not in result.tracked_telemetry_repeaters

    @pytest.mark.asyncio
    async def test_rejects_non_repeater_contact(self, test_db):
        key = "cc" * 32
        await ContactRepository.upsert(ContactUpsert(public_key=key, name="Client", type=1))

        with pytest.raises(HTTPException) as exc_info:
            await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key=key))
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_unknown_contact(self, test_db):
        with pytest.raises(HTTPException) as exc_info:
            await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key="dd" * 32))
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_rejects_when_limit_reached(self, test_db):
        existing_keys = []
        for i in range(8):
            key = f"{i:02x}" * 32
            await self._create_repeater(key, name=f"Repeater{i}")
            existing_keys.append(key)
        await AppSettingsRepository.update(tracked_telemetry_repeaters=existing_keys)

        new_key = "ff" * 32
        await self._create_repeater(new_key, name="NewRepeater")

        with pytest.raises(HTTPException) as exc_info:
            await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key=new_key))
        assert exc_info.value.status_code == 409
        detail = exc_info.value.detail
        assert len(detail["tracked_telemetry_repeaters"]) == 8

    @pytest.mark.asyncio
    async def test_remove_still_works_when_limit_reached(self, test_db):
        """Toggling OFF an already-tracked repeater should work even at max capacity."""
        keys = []
        for i in range(8):
            key = f"{i:02x}" * 32
            await self._create_repeater(key)
            keys.append(key)
        await AppSettingsRepository.update(tracked_telemetry_repeaters=keys)

        result = await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key=keys[0]))
        assert keys[0] not in result.tracked_telemetry_repeaters
        assert len(result.tracked_telemetry_repeaters) == 7

    @pytest.mark.asyncio
    async def test_toggle_response_includes_schedule(self, test_db):
        """After toggle, response must carry the schedule derivation so the UI
        can update the interval dropdown without a follow-up fetch."""
        key = "aa" * 32
        await self._create_repeater(key)

        result = await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key=key))

        assert result.schedule.tracked_count == 1
        # N=1 unlocks the full menu including 1h
        assert 1 in result.schedule.options
        assert result.schedule.max_tracked == 8


class TestTelemetryIntervalValidation:
    """PATCH /settings validation for telemetry_interval_hours."""

    @pytest.mark.asyncio
    async def test_accepts_valid_interval(self, test_db):
        result = await update_settings(AppSettingsUpdate(telemetry_interval_hours=4))
        assert result.telemetry_interval_hours == 4

    @pytest.mark.asyncio
    async def test_invalid_interval_falls_back_to_default(self, test_db):
        """Non-menu values are defaulted rather than 400-ing to keep stale
        clients from getting stuck on a save error."""
        result = await update_settings(AppSettingsUpdate(telemetry_interval_hours=99))
        assert result.telemetry_interval_hours == 8  # DEFAULT_TELEMETRY_INTERVAL_HOURS

    @pytest.mark.asyncio
    async def test_preference_is_preserved_even_when_illegal_for_count(self, test_db):
        """User picks 1h at N=5 tracked: stored pref must stay 1h. Scheduler
        handles the clamping at run time; storage is verbatim."""
        # Seed 5 tracked repeaters
        keys = [f"{i:02x}" * 32 for i in range(5)]
        for k in keys:
            await ContactRepository.upsert(
                ContactUpsert(public_key=k, name=f"R{k[:4]}", type=CONTACT_TYPE_REPEATER)
            )
        await AppSettingsRepository.update(tracked_telemetry_repeaters=keys)

        result = await update_settings(AppSettingsUpdate(telemetry_interval_hours=1))
        assert result.telemetry_interval_hours == 1

        # But the GET schedule endpoint should report the clamped effective value.
        schedule = await get_telemetry_schedule()
        assert schedule.preferred_hours == 1
        assert schedule.effective_hours == 6  # N=5 -> shortest legal = 6h


class TestTelemetryScheduleEndpoint:
    """GET /settings/tracked-telemetry/schedule."""

    @pytest.mark.asyncio
    async def test_schedule_with_no_tracked_repeaters(self, test_db):
        """No tracked repeaters means nothing to schedule; next_run_at is None.

        At N=0 the clamp helper returns the default 8h, which is a fine
        display value for an empty state. Options start at 8h for the same
        reason — any lower shortest-legal only makes sense once the user
        has at least one repeater tracked.
        """
        schedule = await get_telemetry_schedule()

        assert schedule.tracked_count == 0
        assert schedule.next_run_at is None
        # At N=0 shortest-legal defaults to 8h.
        assert schedule.options == [8, 12, 24]

    @pytest.mark.asyncio
    async def test_schedule_filters_options_by_tracked_count(self, test_db):
        keys = [f"{i:02x}" * 32 for i in range(5)]
        for k in keys:
            await ContactRepository.upsert(
                ContactUpsert(public_key=k, name=f"R{k[:4]}", type=CONTACT_TYPE_REPEATER)
            )
        await AppSettingsRepository.update(tracked_telemetry_repeaters=keys)

        schedule = await get_telemetry_schedule()

        assert schedule.tracked_count == 5
        assert schedule.options == [6, 8, 12, 24]
        assert schedule.next_run_at is not None


class TestRoutedHourlySetting:
    """Tests for the telemetry_routed_hourly setting."""

    @pytest.mark.asyncio
    async def test_defaults_to_false(self, test_db):
        settings = await AppSettingsRepository.get()
        assert settings.telemetry_routed_hourly is False

    @pytest.mark.asyncio
    async def test_round_trip_via_patch(self, test_db):
        result = await update_settings(AppSettingsUpdate(telemetry_routed_hourly=True))
        assert result.telemetry_routed_hourly is True

        result = await update_settings(AppSettingsUpdate(telemetry_routed_hourly=False))
        assert result.telemetry_routed_hourly is False

    @pytest.mark.asyncio
    async def test_schedule_includes_routed_fields_when_enabled(self, test_db):
        key = "aa" * 32
        await ContactRepository.upsert(
            ContactUpsert(public_key=key, name="R1", type=CONTACT_TYPE_REPEATER)
        )
        await AppSettingsRepository.update(
            tracked_telemetry_repeaters=[key],
            telemetry_routed_hourly=True,
        )

        schedule = await get_telemetry_schedule()

        assert schedule.routed_hourly is True
        assert schedule.next_routed_run_at is not None
        assert schedule.next_run_at is not None

    @pytest.mark.asyncio
    async def test_schedule_omits_routed_run_when_disabled(self, test_db):
        key = "aa" * 32
        await ContactRepository.upsert(
            ContactUpsert(public_key=key, name="R1", type=CONTACT_TYPE_REPEATER)
        )
        await AppSettingsRepository.update(
            tracked_telemetry_repeaters=[key],
            telemetry_routed_hourly=False,
        )

        schedule = await get_telemetry_schedule()

        assert schedule.routed_hourly is False
        assert schedule.next_routed_run_at is None

    @pytest.mark.asyncio
    async def test_toggle_response_carries_routed_hourly(self, test_db):
        key = "bb" * 32
        await ContactRepository.upsert(
            ContactUpsert(public_key=key, name="R2", type=CONTACT_TYPE_REPEATER)
        )
        await AppSettingsRepository.update(telemetry_routed_hourly=True)

        result = await toggle_tracked_telemetry(TrackedTelemetryRequest(public_key=key))

        assert result.schedule.routed_hourly is True
        assert result.schedule.next_routed_run_at is not None


class TestAdvertRetentionSetting:
    """PATCH /settings for advert_retention_days (mesh-health history)."""

    @pytest.mark.asyncio
    async def test_default_is_30(self, test_db):
        settings = await AppSettingsRepository.get()
        assert settings.advert_retention_days == 30

    @pytest.mark.asyncio
    async def test_update_persists(self, test_db):
        result = await update_settings(AppSettingsUpdate(advert_retention_days=7))
        assert result.advert_retention_days == 7
        again = await AppSettingsRepository.get()
        assert again.advert_retention_days == 7

    @pytest.mark.asyncio
    async def test_rejects_out_of_range(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            AppSettingsUpdate(advert_retention_days=0)
        with pytest.raises(ValidationError):
            AppSettingsUpdate(advert_retention_days=366)
