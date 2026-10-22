# ruff: noqa: F811  (pytest fixtures imported from test_temp_radio)
"""Small follow-up fixes for temporary radio settings (the deferred review minors)."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app import radio_stamp
from app.models import RadioStamp, TempRadioState
from app.repository.raw_packets import RawPacketRepository
from app.services import temp_radio as temp_radio_module
from app.services.radio_commands import RadioCommandRejectedError
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


class TestRestoreChecksTheRadio:
    @pytest.mark.asyncio
    async def test_changed_elsewhere_at_expiry_is_not_overwritten(self, svc, radio, broadcasts):
        await svc.start(_req(duration=60))
        radio.stamp = OTHER  # changed through the radio's own command line
        await svc.restore()
        assert radio.stamp == OTHER
        assert len(radio.applied) == 1
        assert (await svc.get_state()).active is False
        assert any(event == "temp_radio_dropped" for event, _ in broadcasts)

    @pytest.mark.asyncio
    async def test_already_on_normal_just_ends(self, svc, radio):
        await svc.start(_req(duration=60))
        radio.stamp = HOME
        await svc.restore()
        assert len(radio.applied) == 1
        assert (await svc.get_state()).active is False


class TestSwitchingGuard:
    @pytest.mark.asyncio
    async def test_no_stamp_while_switching(self, svc, radio):
        seen: list[bool] = []
        real_apply = radio.apply

        async def apply(stamp, repeat):
            seen.append(radio_stamp.is_switching())
            await real_apply(stamp, repeat)

        svc._apply_radio = apply
        await svc.start(_req())
        await svc.restore()
        assert seen == [True, True]
        assert radio_stamp.is_switching() is False

    def test_current_stamp_none_while_switching(self):
        info = {"radio_freq": 869.618, "radio_bw": 62.5, "radio_sf": 8, "radio_cr": 8}

        class _Mgr:
            meshcore = type("MC", (), {"self_info": info})()

        with patch("app.radio_stamp.radio_manager", _Mgr()):
            assert radio_stamp.current_radio_stamp() is not None
            with radio_stamp.switching():
                assert radio_stamp.current_radio_stamp() is None
            assert radio_stamp.current_radio_stamp() is not None

    @pytest.mark.asyncio
    async def test_stored_outgoing_message_keeps_its_stamp(self, test_db):
        from app.repository import MessageRepository
        from app.services.messages import build_stored_outgoing_channel_message

        sf7 = RadioStamp(freq=869.618, bw=62.5, sf=7, cr=8)
        sf8 = RadioStamp(freq=869.618, bw=62.5, sf=8, cr=8)
        msg_id = await MessageRepository.create(
            msg_type="CHAN",
            text="me: hi",
            received_at=1,
            conversation_key="AB" * 16,
            sender_timestamp=1,
            outgoing=True,
            radio_stamp=sf7,
        )
        assert msg_id is not None
        with patch("app.radio_stamp.current_radio_stamp", return_value=sf8):
            message = await build_stored_outgoing_channel_message(
                message_id=msg_id,
                conversation_key="AB" * 16,
                text="me: hi",
                sender_timestamp=1,
                received_at=1,
                sender_name="me",
                sender_key=None,
                channel_name="#x",
            )
        assert message.radio_stamp == sf7


class TestExpiryLoop:
    @pytest.mark.asyncio
    async def test_real_schedule_restores_after_wall_clock_expiry(self, svc, radio, clock):
        # The real timer: sleeps in steps and re-checks the wall clock, so a
        # host that slept past the expiry restores on the next step.
        del svc._schedule
        sleeps: list[float] = []

        async def fake_sleep(seconds):
            sleeps.append(seconds)
            clock["now"] += 40  # each step the wall clock moves on

        with patch.object(temp_radio_module.asyncio, "sleep", fake_sleep):
            await svc.start(_req(duration=100))
            task = svc._task
            assert task is not None
            await task
        assert radio.stamp == HOME
        assert len(sleeps) >= 3
        assert all(s <= temp_radio_module.EXPIRY_CHECK_SECS for s in sleeps)


class TestHostRepeater:
    @pytest.mark.asyncio
    async def test_start_disarms_an_armed_host_repeater(self, svc, radio):
        from app.services.host_repeater_tx import host_repeater_tx

        with (
            patch.object(host_repeater_tx, "armed", True),
            patch.object(host_repeater_tx, "disarm") as disarm,
        ):
            await svc.start(_req())
        disarm.assert_called_once_with("radio_settings_changed")

    def test_arming_blocked_during_session(self):
        from app.services.host_repeater_tx import host_repeater_tx
        from app.services.temp_radio import temp_radio

        snap = type(
            "Snap",
            (),
            {
                "connected": True,
                "public_key": b"x",
                "raw_send_supported": True,
                "client_repeat": False,
                "is_openhop": False,
                "radio": None,
            },
        )()
        with patch.object(temp_radio, "session_active", return_value=True):
            assert "temp_radio_session" in host_repeater_tx.blockers(snap)
        with patch.object(temp_radio, "session_active", return_value=False):
            assert "temp_radio_session" not in host_repeater_tx.blockers(snap)


class TestContactProfileOnNormal:
    @pytest.mark.asyncio
    async def test_profile_equal_to_normal_ends_the_session(self, test_db, client):
        from app.services.temp_radio import ensure_contact_settings, temp_radio

        key = "c2" * 32
        body = {
            "radio": HOME.model_dump(),
            "region": None,
            "duration_secs": 600,
            "auto_switch": True,
        }
        await client.put(f"/api/contacts/{key}/radio-profile", json=body)
        session = TempRadioState(
            active=True,
            companion_key=KEY,
            original=HOME,
            temp=RadioStamp(**AWAY.model_dump()),
        )
        with (
            patch.object(temp_radio, "_state", session),
            patch.object(temp_radio, "_connected_key", return_value=KEY),
            patch.object(temp_radio, "_current", return_value=RadioStamp(**AWAY.model_dump())),
            patch.object(temp_radio, "restore", AsyncMock()) as restore,
            patch.object(temp_radio, "start", AsyncMock()) as start,
        ):
            assert await ensure_contact_settings(key) is True
        restore.assert_awaited_once()
        start.assert_not_awaited()


class TestRouterAndHistory:
    @pytest.mark.asyncio
    async def test_rejected_restore_says_pending(self, test_db, client):
        with patch.object(
            temp_radio_module.temp_radio,
            "restore",
            AsyncMock(side_effect=RadioCommandRejectedError("bad")),
        ):
            resp = await client.post("/api/radio/temp/restore")
        assert resp.status_code == 422
        assert "pending" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_history_with_no_sf_shown_returns_nothing(self, test_db, client):
        await RawPacketRepository.create(
            b"\x10\x00\x09", 100, radio_stamp=RadioStamp(freq=869.6, bw=62.5, sf=8, cr=8)
        )
        await RawPacketRepository.create(b"\x10\x00\x0a", 101)
        rows = (await client.get("/api/packets/history?radio_sfs=none")).json()["packets"]
        assert rows == []


class TestScanHold:
    @pytest.mark.asyncio
    async def test_hold_keeps_task_and_broadcasts_new_end(self):
        from app.models import RadioScanState
        from app.services.radio_scan import RadioScanService

        events: list[tuple[str, dict]] = []
        temp = type("T", (), {})()
        temp.extend_to = AsyncMock()
        svc = RadioScanService(temp=temp)
        svc.broadcast = lambda event, data: events.append((event, data))
        svc.clock = lambda: 1_000.0
        svc._state = RadioScanState(running=True, entry_ends_at=1_010.0)
        svc._entry_ends_at = 1_010.0
        svc._hold_secs = 40
        svc.on_activity()
        assert svc._pending_extends  # a reference is kept until the task ends
        await asyncio.sleep(0)
        temp.extend_to.assert_awaited_once()
        assert events and events[-1][0] == "radio_scan_state"
        assert events[-1][1]["entry_ends_at"] == 1_040.0
