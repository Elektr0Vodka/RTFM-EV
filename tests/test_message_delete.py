"""Local message delete: hard delete + linked raw packet + targeting reactions.

Covers plan 28 item 1.7: ``DELETE /messages/{id}`` deletes the message row and
its linked raw packet in one transaction (mirroring the retention pruner), also
deletes any stored reaction that resolves to the deleted message, broadcasts a
``message_deleted`` WS event per deleted row, and stops a background DM retry
that is still in flight for an outgoing direct message.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.repository import MessageRepository
from app.repository.raw_packets import RawPacketRepository
from app.routers.messages import delete_message
from app.services import dm_ack_tracker
from app.services.message_send import _retry_direct_message_until_acked

CHAN = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
CONTACT = "ab" * 32


async def _msg(text, ts, *, msg_type="CHAN", key=CHAN, outgoing=False, received=None):
    return await MessageRepository.create(
        msg_type=msg_type,
        text=text,
        conversation_key=key,
        sender_timestamp=ts,
        received_at=received if received is not None else ts + 5,
        outgoing=outgoing,
    )


@pytest.mark.asyncio
async def test_delete_message_removes_row_and_linked_raw_packet(test_db, monkeypatch):
    monkeypatch.setattr("app.routers.messages.broadcast_event", MagicMock())

    message_id = await _msg("Bob: hello", 1790113549)
    packet_id, _is_new = await RawPacketRepository.create(b"\x11some-raw-bytes")
    await RawPacketRepository.mark_decrypted(packet_id, message_id)

    result = await delete_message(message_id)

    assert result == {"status": "ok", "deleted": 1}
    assert await MessageRepository.get_by_id(message_id) is None
    assert await RawPacketRepository.get_by_id(packet_id) is None


@pytest.mark.asyncio
async def test_delete_message_missing_is_404(test_db):
    with pytest.raises(HTTPException) as exc:
        await delete_message(999999)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_message_also_deletes_targeting_reaction(test_db, monkeypatch):
    monkeypatch.setattr("app.routers.messages.broadcast_event", MagicMock())

    target_id = await _msg("NL-OV-ENS-NL1CTM-TEST: Test", 1790113549)
    reaction_id = await _msg("512 A: @[NL-OV-ENS-NL1CTM-TEST]\U0001f44d\n3eykm5rn", 1790113600)
    unrelated_id = await _msg("Carol: unrelated message", 1790113700)

    result = await delete_message(target_id)

    assert result["deleted"] == 2
    assert await MessageRepository.get_by_id(target_id) is None
    assert await MessageRepository.get_by_id(reaction_id) is None
    assert await MessageRepository.get_by_id(unrelated_id) is not None


@pytest.mark.asyncio
async def test_delete_message_broadcasts_one_event_per_deleted_row(test_db, monkeypatch):
    broadcast = MagicMock()
    monkeypatch.setattr("app.routers.messages.broadcast_event", broadcast)

    target_id = await _msg("NL-OV-ENS-NL1CTM-TEST: Test", 1790113549)
    reaction_id = await _msg("512 A: @[NL-OV-ENS-NL1CTM-TEST]\U0001f44d\n3eykm5rn", 1790113600)

    await delete_message(target_id)

    events = [call.args for call in broadcast.call_args_list]
    assert events == [
        ("message_deleted", {"id": target_id, "type": "CHAN", "conversation_key": CHAN}),
        ("message_deleted", {"id": reaction_id, "type": "CHAN", "conversation_key": CHAN}),
    ]


@pytest.mark.asyncio
async def test_delete_outgoing_dm_cancels_pending_retry(test_db, monkeypatch):
    monkeypatch.setattr("app.routers.messages.broadcast_event", MagicMock())

    message_id = await _msg("Hello", 1790113549, msg_type="PRIV", key=CONTACT, outgoing=True)
    assert dm_ack_tracker.is_message_deleted(message_id) is False

    await delete_message(message_id)

    assert dm_ack_tracker.is_message_deleted(message_id) is True
    dm_ack_tracker._deleted_message_ids.pop(message_id, None)


@pytest.mark.asyncio
async def test_delete_incoming_message_does_not_mark_dm_retry_cancellation(test_db, monkeypatch):
    monkeypatch.setattr("app.routers.messages.broadcast_event", MagicMock())

    message_id = await _msg("Bob: hi", 1790113549)  # CHAN, not outgoing PRIV

    await delete_message(message_id)

    assert dm_ack_tracker.is_message_deleted(message_id) is False


@pytest.mark.asyncio
async def test_delete_with_raw_packets_repository(test_db):
    keep_id = await _msg("keep me", 1, msg_type="PRIV", key=CONTACT, received=1)
    delete_id_1 = await _msg("delete me", 2, msg_type="PRIV", key=CONTACT, received=2)
    delete_id_2 = await _msg("delete me too", 3, msg_type="PRIV", key=CONTACT, received=3)

    packet_id, _ = await RawPacketRepository.create(b"\x22linked-to-delete-1")
    await RawPacketRepository.mark_decrypted(packet_id, delete_id_1)
    unlinked_packet_id, _ = await RawPacketRepository.create(b"\x33unlinked")

    messages_deleted, raw_deleted = await MessageRepository.delete_with_raw_packets(
        [delete_id_1, delete_id_2]
    )

    assert (messages_deleted, raw_deleted) == (2, 1)
    assert await MessageRepository.get_by_id(keep_id) is not None
    assert await MessageRepository.get_by_id(delete_id_1) is None
    assert await MessageRepository.get_by_id(delete_id_2) is None
    assert await RawPacketRepository.get_by_id(packet_id) is None
    assert await RawPacketRepository.get_by_id(unlinked_packet_id) is not None


@pytest.mark.asyncio
async def test_delete_with_raw_packets_empty_list_is_noop(test_db):
    assert await MessageRepository.delete_with_raw_packets([]) == (0, 0)


class TestDmAckTrackerDeletedMarks:
    def teardown_method(self):
        dm_ack_tracker._deleted_message_ids.clear()

    def test_mark_and_check(self):
        assert dm_ack_tracker.is_message_deleted(42) is False
        dm_ack_tracker.mark_message_deleted(42)
        assert dm_ack_tracker.is_message_deleted(42) is True

    def test_cleanup_expires_old_marks(self, monkeypatch):
        dm_ack_tracker.mark_message_deleted(7)
        # Simulate the mark being far older than the TTL.
        dm_ack_tracker._deleted_message_ids[7] -= dm_ack_tracker.DELETED_MESSAGE_TTL_SECONDS + 1
        dm_ack_tracker.cleanup_expired_deleted_marks()
        assert dm_ack_tracker.is_message_deleted(7) is False


@pytest.mark.asyncio
async def test_background_dm_retry_stops_when_message_deleted():
    message_id = 987654321
    dm_ack_tracker.mark_message_deleted(message_id)
    try:
        radio_manager = MagicMock()
        radio_manager.radio_operation = MagicMock(
            side_effect=AssertionError("radio should not be touched after delete")
        )
        message_repository = MagicMock()
        message_repository.get_ack_and_paths = AsyncMock(return_value=(0, None))

        await _retry_direct_message_until_acked(
            contact=MagicMock(public_key=CONTACT),
            text="hello",
            message_id=message_id,
            sender_timestamp=1790113549,
            radio_manager=radio_manager,
            track_pending_ack_fn=MagicMock(),
            broadcast_fn=MagicMock(),
            wait_timeout_ms=1,
            sleep_fn=AsyncMock(),
            message_repository=message_repository,
        )

        radio_manager.radio_operation.assert_not_called()
    finally:
        dm_ack_tracker._deleted_message_ids.pop(message_id, None)
