"""Automatic sending and integrations pause during a temporary radio session (spec 4.5)."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from meshcore import EventType

from app.fanout.manager import FanoutManager
from app.radio_sync import _maybe_run_scheduled_cycle, send_advertisement
from app.services import team_beacon_sender
from app.services.temp_radio import temp_radio
from tests.test_fanout import StubModule


def _session(opt_ins: set[str] | None = None, fanout: set[str] | None = None):
    """Patch the service as if a session runs with the given opt-ins."""
    allowed = opt_ins or set()
    ids = fanout or set()
    return (
        patch.object(temp_radio, "session_active", return_value=True),
        patch.object(temp_radio, "opted_in", side_effect=lambda item: item in allowed),
        patch.object(temp_radio, "fanout_allowed", side_effect=lambda cid: cid in ids),
    )


def _mc():
    mc = MagicMock()
    mc.commands.send_advert = AsyncMock(return_value=MagicMock(type=EventType.OK))
    return mc


class TestAdverts:
    @pytest.mark.asyncio
    async def test_automatic_advert_skipped_during_session(self, test_db):
        from app.repository import AppSettingsRepository

        # Due by the normal rules: only the session holds it back.
        await AppSettingsRepository.update(advert_interval=3600, last_advert_time=0)
        mc = _mc()
        a, b, c = _session()
        with a, b, c:
            assert await send_advertisement(mc) is False
        mc.commands.send_advert.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_forced_advert_still_sends(self, test_db):
        mc = _mc()
        a, b, c = _session()
        with a, b, c:
            assert await send_advertisement(mc, force=True) is True
        mc.commands.send_advert.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_opted_in_advert_follows_normal_rules(self, test_db):
        from app.repository import AppSettingsRepository

        await AppSettingsRepository.update(advert_interval=3600, last_advert_time=0)
        mc = _mc()
        a, b, c = _session(opt_ins={"adverts"})
        with a, b, c:
            assert await send_advertisement(mc) is True


class TestTeamBeacon:
    @pytest.mark.asyncio
    async def test_beacon_skipped_during_session(self, test_db):
        a, b, c = _session()
        with (
            a,
            b,
            c,
            patch.object(
                team_beacon_sender.AppSettingsRepository, "get", new_callable=AsyncMock
            ) as get,
        ):
            assert await team_beacon_sender.send_team_beacon_if_due() is False
        get.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_beacon_checked_when_opted_in(self, test_db):
        a, b, c = _session(opt_ins={"team_beacon"})
        with a, b, c:
            # Beacon disabled in settings: the normal rules run and say no.
            assert await team_beacon_sender.send_team_beacon_if_due() is False


class TestTelemetry:
    @pytest.mark.asyncio
    async def test_scheduled_cycle_skipped_during_session(self, test_db):
        a, b, c = _session()
        with (
            a,
            b,
            c,
            patch("app.radio_sync.AppSettingsRepository.get", new_callable=AsyncMock) as get,
        ):
            await _maybe_run_scheduled_cycle(datetime(2026, 10, 22, 12, tzinfo=UTC))
        get.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_scheduled_cycle_runs_when_opted_in(self, test_db):
        a, b, c = _session(opt_ins={"telemetry"})
        with (
            a,
            b,
            c,
            patch("app.radio_sync.AppSettingsRepository.get", new_callable=AsyncMock) as get,
        ):
            get.return_value = MagicMock(
                tracked_telemetry_repeaters=[], tracked_telemetry_contacts=[]
            )
            await _maybe_run_scheduled_cycle(datetime(2026, 10, 22, 12, tzinfo=UTC))
        get.assert_awaited_once()


class TestFanout:
    @pytest.mark.asyncio
    async def test_non_opted_module_skipped(self):
        manager = FanoutManager()
        blocked, allowed = StubModule(), StubModule()
        scope = {"messages": "all", "raw_packets": "all"}
        manager._modules["blocked"] = (blocked, scope)
        manager._modules["allowed"] = (allowed, scope)
        a, b, c = _session(fanout={"allowed"})
        with a, b, c:
            await manager.broadcast_raw({"data": "aabb"})
        assert blocked.raw_calls == []
        assert len(allowed.raw_calls) == 1

    @pytest.mark.asyncio
    async def test_everything_dispatched_without_session(self):
        manager = FanoutManager()
        mod = StubModule()
        manager._modules["m"] = (mod, {"messages": "all", "raw_packets": "all"})
        await manager.broadcast_raw({"data": "aabb"})
        assert len(mod.raw_calls) == 1
