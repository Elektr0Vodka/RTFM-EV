# ruff: noqa: F811  (pytest fixtures imported from test_temp_radio)
"""Fixes from the final review of temporary radio settings (stranding, other companion, retries)."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest

from app.models import RadioStamp, RadioStampInput, TempRadioStartRequest
from app.repository import AppSettingsRepository
from app.services.temp_radio import (
    TempRadioConflictError,
    TempRadioService,
    radio_change_ends_session,
)
from tests.test_temp_radio import (  # noqa: F401  (fixtures)
    AWAY,
    HOME,
    KEY,
    OTHER,
    _req,
    broadcasts,
    clock,
    radio,
    svc,
)

OTHER_KEY = "cd" * 32


@asynccontextmanager
async def _fake_operation(*args, **kwargs):
    yield object()


class TestStartFailureNeverStrands:
    @pytest.mark.asyncio
    async def test_region_failure_restores_at_once(self, svc, radio):
        async def failing_region(region):
            if region is not None:
                raise RuntimeError("region timeout")

        svc._apply_region = failing_region
        with pytest.raises(RuntimeError):
            await svc.start(_req(region="be"))
        assert radio.stamp == HOME
        assert (await svc.get_state()).active is False

    @pytest.mark.asyncio
    async def test_failed_start_and_failed_restore_keeps_pending_session(self, svc, radio):
        calls = {"n": 0}

        async def apply_then_drop(stamp, repeat):
            calls["n"] += 1
            if calls["n"] == 1:
                # set_radio went out, then the link died before the reply.
                radio.stamp = RadioStamp(**stamp.model_dump())
            raise RuntimeError("radio gone")

        svc._apply_radio = apply_then_drop
        with pytest.raises(RuntimeError):
            await svc.start(_req())
        state = await svc.get_state()
        assert state.active is True
        assert state.restore_pending is True
        assert state.original == HOME

    @pytest.mark.asyncio
    async def test_reconcile_treats_previous_temp_as_ours(self, svc, radio, clock, broadcasts):
        await svc.start(_req(duration=600))
        second = RadioStampInput(freq=869.525, bw=250.0, sf=11, cr=5)

        async def failing_apply(stamp, repeat):
            raise RuntimeError("timeout")

        good_apply = svc._apply_radio
        svc._apply_radio = failing_apply
        with pytest.raises(RuntimeError):
            await svc.start(TempRadioStartRequest(radio=second, duration_secs=600))
        svc._apply_radio = good_apply
        # The radio is still on the first temporary settings.
        assert radio.stamp.sf == 8
        await svc.reconcile_on_connect()
        # Ours, with a restore pending: back to normal, never "changed elsewhere".
        assert radio.stamp == HOME
        assert (await svc.get_state()).active is False
        assert not any(event == "temp_radio_dropped" for event, _ in broadcasts)


class TestOtherCompanion:
    @pytest.mark.asyncio
    async def test_expiry_on_other_companion_does_not_apply(self, svc, radio, clock):
        await svc.start(_req(duration=60))
        radio.key = OTHER_KEY
        radio.stamp = OTHER
        clock["now"] = 1_061.0
        await svc.handle_expiry()
        assert radio.stamp == OTHER
        assert len(radio.applied) == 1
        state = await svc.get_state()
        assert state.active is True and state.restore_pending is True

    @pytest.mark.asyncio
    async def test_start_on_other_companion_refused(self, svc, radio):
        await svc.start(_req())
        radio.key = OTHER_KEY
        with pytest.raises(TempRadioConflictError):
            await svc.start(_req())

    @pytest.mark.asyncio
    async def test_pauses_only_apply_to_the_session_companion(self, svc, radio):
        await svc.start(_req())
        assert svc.opted_in("adverts") is False
        radio.key = OTHER_KEY
        assert svc.opted_in("adverts") is True
        assert svc.fanout_allowed("x") is True
        assert svc.session_active() is False


class TestRetry:
    @pytest.mark.asyncio
    async def test_expiry_retries_until_restored(self, svc, radio, clock):
        await svc.start(_req(duration=60))
        svc.retry_secs = 0
        fails = {"n": 2}
        real_apply = radio.apply

        async def flaky(stamp, repeat):
            if fails["n"] > 0:
                fails["n"] -= 1
                raise RuntimeError("busy")
            await real_apply(stamp, repeat)

        svc._apply_radio = flaky
        clock["now"] = 1_061.0
        await svc.handle_expiry()
        assert radio.stamp == HOME
        assert (await svc.get_state()).active is False

    @pytest.mark.asyncio
    async def test_reconcile_restores_pending_session_before_expiry(self, svc, radio, clock):
        await svc.start(_req(duration=600))
        radio.connected = False
        with pytest.raises(RuntimeError):
            await svc.restore()
        radio.connected = True
        clock["now"] = 1_100.0
        await svc.reconcile_on_connect()
        assert radio.stamp == HOME


class TestNewNormal:
    @pytest.mark.asyncio
    async def test_explicit_new_normal_ends_even_with_same_settings(self, svc):
        await svc.start(_req())
        current = RadioStamp(**AWAY.model_dump())
        assert radio_change_ends_session(svc, current, current=current, explicit=True)

    @pytest.mark.asyncio
    async def test_patch_new_normal_keeps_original_client_repeat(self, test_db):
        from app.routers import radio as radio_router
        from app.routers.radio import RadioConfigUpdate, RadioSettings
        from app.services import temp_radio as temp_radio_module

        service = TempRadioService()
        service._state = service._state.model_copy(
            update={
                "active": True,
                "original": HOME,
                "temp": RadioStamp(**AWAY.model_dump()),
                "original_repeat": True,
                "companion_key": KEY,
            }
        )
        service._connected_key = lambda: KEY
        apply = AsyncMock()
        update = RadioConfigUpdate(
            radio=RadioSettings(freq=869.618, bw=62.5, sf=8, cr=8), end_temp_session=True
        )
        with (
            patch.object(temp_radio_module, "temp_radio", service),
            patch.object(radio_router, "temp_radio", service),
            patch.object(radio_router.radio_manager, "require_connected"),
            patch.object(radio_router.radio_manager, "radio_operation", _fake_operation),
            patch.object(radio_router, "apply_radio_config_update", apply),
            patch.object(radio_router, "get_radio_config", AsyncMock(return_value=None)),
            patch.object(service, "_apply_region", AsyncMock()),
        ):
            await radio_router.update_radio_config(update)
        assert apply.await_args.kwargs["repeat_override"] is True
        assert service.session_active() is False
        assert await AppSettingsRepository.get_temp_radio_state() is None


class TestOtherTransmitters:
    @pytest.mark.asyncio
    async def test_sensor_push_renewals_paused(self, test_db):
        from app.services import sensor_push
        from app.services.temp_radio import temp_radio

        with (
            patch.object(sensor_push.radio_manager, "_meshcore", object(), create=True),
            patch.object(type(sensor_push.radio_manager), "is_connected", True, create=True),
            patch.object(temp_radio, "opted_in", side_effect=lambda item: item != "polls"),
            patch.object(sensor_push.SensorPushRepository, "list_enabled", AsyncMock()) as listed,
        ):
            assert await sensor_push.renew_due(1_000) == 0
        listed.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_neighbor_poll_paused(self):
        from app.services.host_repeater_neighbor_poll import NeighbourPoller
        from app.services.temp_radio import temp_radio

        poller = NeighbourPoller.__new__(NeighbourPoller)
        poller._eligible = lambda: True
        poller._eligible_since = 0.0
        poller.due_at = lambda: 0.0
        poller.poll_once = AsyncMock()

        class _Poll:
            running = False
            next_due = None
            last_finished = None

        class _Table:
            poll = _Poll()

        poller._table = _Table()
        with (
            patch.object(type(poller), "table", property(lambda self: self._table)),
            patch.object(temp_radio, "opted_in", side_effect=lambda item: item != "polls"),
        ):
            assert await poller.tick(now=10.0) is False
        poller.poll_once.assert_not_awaited()
