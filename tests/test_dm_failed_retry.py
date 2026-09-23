"""DM failed state, late-ACK recovery and manual retry (plan 28 item 1.1).

Every send here goes to a mocked MeshCore connection; nothing reaches a radio.
"""

import asyncio
import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from meshcore import EventType

import app.services.message_send as message_send_service
from app.events import dump_ws_event
from app.models import SendDirectMessageRequest
from app.radio import radio_manager
from app.repository import ContactRepository, MessageRepository
from app.routers.messages import resend_direct_message, send_direct_message
from app.services import dm_ack_tracker

PUB_KEY = "c1" * 32


@pytest.fixture(autouse=True)
def _reset_state():
    prev = radio_manager._meshcore
    prev_lock = radio_manager._operation_lock
    prev_pending = dm_ack_tracker._pending_acks.copy()
    prev_buffered = dm_ack_tracker._buffered_acks.copy()
    prev_failed = dm_ack_tracker._failed_acks.copy()
    yield
    radio_manager._meshcore = prev
    radio_manager._operation_lock = prev_lock
    for store, saved in (
        (dm_ack_tracker._pending_acks, prev_pending),
        (dm_ack_tracker._buffered_acks, prev_buffered),
        (dm_ack_tracker._failed_acks, prev_failed),
    ):
        store.clear()
        store.update(saved)


def _result(payload=None, event_type=EventType.MSG_SENT):
    result = MagicMock()
    result.type = event_type
    result.payload = payload or {}
    return result


def _sent(code: bytes, timeout_ms: int = 5000):
    return _result({"expected_ack": code, "suggested_timeout": timeout_ms})


def _make_mc():
    mc = MagicMock()
    mc.self_info = {"name": "TestNode"}
    mc.commands = MagicMock()
    mc.commands.send_msg = AsyncMock(return_value=_result())
    mc.commands.add_contact = AsyncMock(return_value=_result())
    mc.commands.reset_path = AsyncMock(return_value=_result(event_type=EventType.OK))
    mc.get_contact_by_key_prefix = MagicMock(return_value=None)
    return mc


async def _insert_contact(public_key=PUB_KEY, name="Alice"):
    await ContactRepository.upsert(
        {
            "public_key": public_key,
            "name": name,
            "type": 0,
            "flags": 0,
            "direct_path": None,
            "direct_path_len": -1,
            "direct_path_hash_mode": -1,
            "last_advert": None,
            "lat": None,
            "lon": None,
            "last_seen": None,
            "on_radio": False,
            "last_contacted": None,
        }
    )


async def _send_until_failed(mc, broadcasts, codes=(b"\x00\x00\x00\x01", b"\x00\x00\x00\x02")):
    """Send a DM through the router with 2 attempts and let every retry run out."""
    mc.commands.send_msg = AsyncMock(side_effect=[_sent(code) for code in codes])
    loop = asyncio.get_running_loop()
    retry_tasks = []

    def schedule_retry(coro):
        task = loop.create_task(coro)
        retry_tasks.append(task)
        return task

    async def no_wait(_seconds):
        return None

    with (
        patch.object(message_send_service, "DM_SEND_MAX_ATTEMPTS", len(codes)),
        patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
        patch(
            "app.routers.messages.broadcast_event",
            side_effect=lambda t, d, **_kw: broadcasts.append((t, d)),
        ),
        patch("app.services.message_send.asyncio.create_task", side_effect=schedule_retry),
        patch("app.services.message_send.asyncio.sleep", side_effect=no_wait),
    ):
        message = await send_direct_message(
            SendDirectMessageRequest(destination=PUB_KEY, text="Hello")
        )
        await asyncio.gather(*retry_tasks)
    return message


async def _ack(code_hex: str, broadcasts):
    from app.event_handlers import on_ack

    class AckEvent:
        payload = {"code": code_hex}

    with patch(
        "app.event_handlers.broadcast_event",
        side_effect=lambda t, d, **_kw: broadcasts.append((t, d)),
    ):
        await on_ack(AckEvent())


async def _create_failed_dm(text="Hello", failed=True, acked=False):
    now = int(time.time()) - 60
    msg_id = await MessageRepository.create(
        msg_type="PRIV",
        text=text,
        conversation_key=PUB_KEY,
        sender_timestamp=now,
        received_at=now,
        outgoing=True,
    )
    assert msg_id is not None
    if failed:
        assert await MessageRepository.mark_failed(msg_id, now + 30)
    if acked:
        await MessageRepository.increment_ack_count(msg_id)
    return msg_id


class TestMarkFailed:
    @pytest.mark.asyncio
    async def test_retries_running_out_persists_and_broadcasts_failed(self, test_db):
        await _insert_contact()
        mc = _make_mc()
        broadcasts: list = []

        message = await _send_until_failed(mc, broadcasts)

        stored = await MessageRepository.get_by_id(message.id)
        assert stored is not None
        assert stored.acked == 0
        assert stored.failed_at is not None
        failed_events = [d for t, d in broadcasts if t == "message_failed"]
        assert failed_events == [{"message_id": message.id, "failed_at": stored.failed_at}]
        # Both attempts' ACK codes stay matchable; none are left pending.
        assert set(dm_ack_tracker._failed_acks) == {"00000001", "00000002"}
        assert not any(mid == message.id for mid, _t, _to in dm_ack_tracker._pending_acks.values())

    @pytest.mark.asyncio
    async def test_ack_during_final_window_is_not_marked_failed(self, test_db):
        await _insert_contact()
        mc = _make_mc()
        mc.commands.send_msg = AsyncMock(
            side_effect=[_sent(b"\x00\x00\x00\x01"), _sent(b"\x00\x00\x00\x02")]
        )
        broadcasts: list = []
        loop = asyncio.get_running_loop()
        retry_tasks = []
        sleeps = 0

        def schedule_retry(coro):
            task = loop.create_task(coro)
            retry_tasks.append(task)
            return task

        async def ack_on_final_wait(_seconds):
            nonlocal sleeps
            sleeps += 1
            if sleeps == 2:
                await _ack("00000002", broadcasts)

        with (
            patch.object(message_send_service, "DM_SEND_MAX_ATTEMPTS", 2),
            patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch(
                "app.routers.messages.broadcast_event",
                side_effect=lambda t, d, **_kw: broadcasts.append((t, d)),
            ),
            patch("app.services.message_send.asyncio.create_task", side_effect=schedule_retry),
            patch("app.services.message_send.asyncio.sleep", side_effect=ack_on_final_wait),
        ):
            message = await send_direct_message(
                SendDirectMessageRequest(destination=PUB_KEY, text="Hello")
            )
            await asyncio.gather(*retry_tasks)

        stored = await MessageRepository.get_by_id(message.id)
        assert stored is not None
        assert stored.acked == 1
        assert stored.failed_at is None
        assert not [t for t, _d in broadcasts if t == "message_failed"]

    @pytest.mark.asyncio
    async def test_mark_failed_never_overrides_an_ack(self, test_db):
        msg_id = await _create_failed_dm(failed=False, acked=True)

        assert await MessageRepository.mark_failed(msg_id, int(time.time())) is False
        stored = await MessageRepository.get_by_id(msg_id)
        assert stored is not None and stored.failed_at is None


class TestLateAck:
    @pytest.mark.asyncio
    async def test_late_ack_within_grace_flips_failed_to_delivered(self, test_db):
        await _insert_contact()
        mc = _make_mc()
        broadcasts: list = []
        message = await _send_until_failed(mc, broadcasts)

        # An ACK for the first attempt's code, after the message was marked failed.
        await _ack("00000001", broadcasts)

        stored = await MessageRepository.get_by_id(message.id)
        assert stored is not None
        assert stored.acked == 1
        assert stored.failed_at is None
        assert ("message_acked", {"message_id": message.id, "ack_count": 1}) in broadcasts
        # One ACK wins; the sibling code is no longer held.
        assert dm_ack_tracker._failed_acks == {}

    @pytest.mark.asyncio
    async def test_late_ack_after_grace_leaves_message_failed(self, test_db):
        await _insert_contact()
        mc = _make_mc()
        broadcasts: list = []
        message = await _send_until_failed(mc, broadcasts)
        expired = time.time() - dm_ack_tracker.FAILED_ACK_GRACE_SECONDS - 1
        for code, (message_id, _failed_at) in list(dm_ack_tracker._failed_acks.items()):
            dm_ack_tracker._failed_acks[code] = (message_id, expired)

        await _ack("00000002", broadcasts)

        stored = await MessageRepository.get_by_id(message.id)
        assert stored is not None
        assert stored.acked == 0
        assert stored.failed_at is not None
        assert not [t for t, _d in broadcasts if t == "message_acked"]
        assert "00000002" in dm_ack_tracker._buffered_acks


class TestResendDirectMessage:
    @pytest.mark.asyncio
    async def test_resend_sends_new_copy_and_replaces_failed_row(self, test_db):
        await _insert_contact()
        old_id = await _create_failed_dm()
        old = await MessageRepository.get_by_id(old_id)
        assert old is not None and old.sender_timestamp is not None
        dm_ack_tracker.track_failed_acks(["0badc0de"], old_id)
        mc = _make_mc()
        mc.commands.send_msg = AsyncMock(return_value=_sent(b"\x12\x34\x56\x78"))
        broadcasts: list = []

        with (
            patch.object(message_send_service, "DM_SEND_MAX_ATTEMPTS", 1),
            patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch(
                "app.routers.messages.broadcast_event",
                side_effect=lambda t, d, **_kw: broadcasts.append((t, d)),
            ),
        ):
            response = await resend_direct_message(old_id)

        assert response.status == "ok"
        assert response.replaced_message_id == old_id
        assert response.message_id == response.message.id != old_id
        assert response.message.text == "Hello"
        assert response.message.failed_at is None
        new_timestamp = mc.commands.send_msg.await_args.kwargs["timestamp"]
        assert new_timestamp == response.message.sender_timestamp
        assert new_timestamp != old.sender_timestamp
        assert await MessageRepository.get_by_id(old_id) is None
        assert await MessageRepository.get_by_id(response.message_id) is not None
        types = [t for t, _d in broadcasts]
        assert types.index("message") < types.index("message_deleted")
        assert (
            "message_deleted",
            {"message_id": old_id, "type": "PRIV", "conversation_key": PUB_KEY},
        ) in broadcasts
        # The old copy's ACK codes no longer match anything.
        assert "0badc0de" not in dm_ack_tracker._failed_acks
        assert "12345678" in dm_ack_tracker._pending_acks

    @pytest.mark.asyncio
    async def test_resend_radio_error_keeps_failed_row(self, test_db):
        await _insert_contact()
        old_id = await _create_failed_dm()
        mc = _make_mc()
        mc.commands.send_msg = AsyncMock(
            return_value=_result({"reason": "nope"}, event_type=EventType.ERROR)
        )

        with (
            patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch("app.routers.messages.broadcast_event"),
            pytest.raises(HTTPException) as exc_info,
        ):
            await resend_direct_message(old_id)

        assert exc_info.value.status_code == 422
        stored = await MessageRepository.get_by_id(old_id)
        assert stored is not None and stored.failed_at is not None

    @pytest.mark.asyncio
    async def test_resend_without_radio_fails_cleanly(self, test_db):
        await _insert_contact()
        old_id = await _create_failed_dm()

        with (
            patch(
                "app.routers.messages.radio_manager.require_connected",
                side_effect=HTTPException(status_code=423, detail="Radio not connected"),
            ),
            pytest.raises(HTTPException) as exc_info,
        ):
            await resend_direct_message(old_id)

        assert exc_info.value.status_code == 423
        assert await MessageRepository.get_by_id(old_id) is not None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("failed", "acked", "status"),
        [(False, False, 409), (True, True, 409)],
    )
    async def test_resend_only_allowed_for_failed_unacked(self, test_db, failed, acked, status):
        await _insert_contact()
        msg_id = await _create_failed_dm(failed=failed, acked=acked)
        mc = _make_mc()

        with (
            patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
            pytest.raises(HTTPException) as exc_info,
        ):
            await resend_direct_message(msg_id)

        assert exc_info.value.status_code == status
        mc.commands.send_msg.assert_not_called()

    @pytest.mark.asyncio
    async def test_resend_rejects_channel_incoming_and_missing(self, test_db):
        now = int(time.time())
        chan_id = await MessageRepository.create(
            msg_type="CHAN",
            text="Me: hi",
            conversation_key="AB" * 16,
            sender_timestamp=now,
            received_at=now,
            outgoing=True,
        )
        incoming_id = await MessageRepository.create(
            msg_type="PRIV",
            text="hey",
            conversation_key=PUB_KEY,
            sender_timestamp=now,
            received_at=now,
            outgoing=False,
        )
        assert chan_id is not None and incoming_id is not None
        mc = _make_mc()

        with patch("app.routers.messages.radio_manager.require_connected", return_value=mc):
            for msg_id, status in ((chan_id, 400), (incoming_id, 400), (999999, 404)):
                with pytest.raises(HTTPException) as exc_info:
                    await resend_direct_message(msg_id)
                assert exc_info.value.status_code == status

        mc.commands.send_msg.assert_not_called()


class TestWsPayloads:
    def test_failed_and_deleted_events_validate(self):
        failed = json.loads(dump_ws_event("message_failed", {"message_id": 1, "failed_at": 5}))
        deleted = json.loads(
            dump_ws_event(
                "message_deleted",
                {"message_id": 1, "type": "PRIV", "conversation_key": PUB_KEY},
            )
        )
        assert failed == {"type": "message_failed", "data": {"message_id": 1, "failed_at": 5}}
        assert deleted["data"]["message_id"] == 1
