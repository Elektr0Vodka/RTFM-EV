"""Queued channel frames the library fetches on its own are stored, once."""

import asyncio
import time
from collections import OrderedDict
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from meshcore import EventType

from app.radio import radio_manager
from app.repository import ChannelRepository, MessageRepository
from app.services import queued_channel_ingest
from app.services.message_send import send_channel_message_with_effective_scope

CHAN_KEY = "AB" * 16
OTHER_KEY = "CD" * 16


@pytest.fixture
def slot_zero(monkeypatch):
    monkeypatch.setattr(radio_manager, "_channel_key_by_slot", {0: CHAN_KEY})


@pytest.mark.asyncio
async def test_queued_channel_message_is_stored_once(test_db, slot_zero):
    await ChannelRepository.upsert(key=CHAN_KEY, name="#queued")
    payload = {"channel_idx": 0, "text": "Bob: hello there", "sender_timestamp": 1_700_000_000}
    with patch("app.services.queued_channel_ingest.broadcast_event"):
        await queued_channel_ingest.store_channel_message(CHAN_KEY, dict(payload))
        await queued_channel_ingest.store_channel_message(CHAN_KEY, dict(payload))

    rows = await MessageRepository.get_all(msg_type="CHAN", conversation_key=CHAN_KEY)
    assert [row.text for row in rows] == ["Bob: hello there"]


@pytest.mark.asyncio
async def test_unknown_slot_is_left_alone(test_db, monkeypatch):
    monkeypatch.setattr(queued_channel_ingest, "QUEUED_FRAME_GRACE_SECONDS", 0)
    monkeypatch.setattr(radio_manager, "_channel_key_by_slot", {})
    monkeypatch.setattr(radio_manager, "_pending_message_channel_key_by_slot", {})
    await queued_channel_ingest.on_channel_message(
        SimpleNamespace(payload={"channel_idx": 5, "text": "Bob: hi"})
    )
    await asyncio.sleep(0.05)
    assert await MessageRepository.get_all(msg_type="CHAN") == []


@pytest.mark.asyncio
async def test_queued_channel_data_gets_a_placeholder_row(test_db, slot_zero):
    await ChannelRepository.upsert(key=CHAN_KEY, name="#queued")
    payload = {
        "channel_idx": 0,
        "data_type": 0x1234,
        "payload": "deadbeef",
        "path_len": 2,
        "SNR": 5.5,
    }
    with (
        patch("app.services.queued_channel_ingest.broadcast_event"),
        patch("app.services.trackers.handle_tracker_datagram", return_value=False),
    ):
        await queued_channel_ingest.store_channel_data(CHAN_KEY, payload)

    rows = await MessageRepository.get_all(msg_type="CHAN", conversation_key=CHAN_KEY)
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_handler_waits_the_grace_period_before_storing(monkeypatch, slot_zero):
    """The raw packet of the same message is given time to be stored first."""
    monkeypatch.setattr(queued_channel_ingest, "QUEUED_FRAME_GRACE_SECONDS", 0.05)
    store = AsyncMock()
    monkeypatch.setattr(queued_channel_ingest, "store_channel_message", store)

    await queued_channel_ingest.on_channel_message(SimpleNamespace(payload={"channel_idx": 0}))
    store.assert_called_once()  # the coroutine is created now ...
    store.assert_not_awaited()  # ... and awaited only after the grace period

    await asyncio.sleep(0.15)
    store.assert_awaited_once_with(CHAN_KEY, {"channel_idx": 0})


@pytest.mark.asyncio
async def test_handler_reads_the_slot_when_the_frame_arrives(monkeypatch, slot_zero):
    """A send during the grace period loads another channel into the slot."""
    monkeypatch.setattr(queued_channel_ingest, "QUEUED_FRAME_GRACE_SECONDS", 0.05)
    store = AsyncMock()
    monkeypatch.setattr(queued_channel_ingest, "store_channel_message", store)

    await queued_channel_ingest.on_channel_message(SimpleNamespace(payload={"channel_idx": 0}))
    radio_manager._channel_key_by_slot[0] = OTHER_KEY

    await asyncio.sleep(0.15)
    store.assert_awaited_once_with(CHAN_KEY, {"channel_idx": 0})


@pytest.mark.asyncio
async def test_queued_frame_lands_in_the_channel_a_tcp_send_loaded(test_db, monkeypatch):
    """TCP keeps no send cache, so a send must still say what the slot now holds.

    The app connected with OTHER_KEY in slot 0 and offloaded it. A send then put
    CHAN_KEY in slot 0, so the radio numbers CHAN_KEY's messages as slot 0.
    """
    monkeypatch.setattr(radio_manager, "_connection_info", "TCP: 192.0.2.1:5000")
    monkeypatch.setattr(radio_manager, "_channel_key_by_slot", {})
    monkeypatch.setattr(radio_manager, "_channel_slot_by_key", OrderedDict())
    monkeypatch.setattr(radio_manager, "_pending_message_channel_key_by_slot", {0: OTHER_KEY})
    await ChannelRepository.upsert(key=CHAN_KEY, name="#mc-radar")
    await ChannelRepository.upsert(key=OTHER_KEY, name="#almere")

    ok = SimpleNamespace(type=EventType.OK, payload={})
    mc = MagicMock()
    mc.commands.set_channel = AsyncMock(return_value=ok)
    mc.commands.send_chan_msg = AsyncMock(return_value=ok)
    await send_channel_message_with_effective_scope(
        mc=mc,
        channel=SimpleNamespace(
            name="#mc-radar", flood_scope_override=None, path_hash_mode_override=None
        ),
        channel_key=CHAN_KEY,
        key_bytes=bytes.fromhex(CHAN_KEY),
        text="hello",
        timestamp_bytes=b"\x00\x00\x00\x00",
        action_label="test send",
        radio_manager=radio_manager,
        temp_radio_slot=0,
        error_broadcast_fn=MagicMock(),
    )

    assert queued_channel_ingest._channel_key_for_slot(0) == CHAN_KEY


@pytest.mark.asyncio
async def test_queued_copy_of_a_message_stored_in_another_channel_is_skipped(test_db):
    """A wrong slot never adds a second copy of a message the raw packet stored."""
    await ChannelRepository.upsert(key=CHAN_KEY, name="#mc-radar")
    await ChannelRepository.upsert(key=OTHER_KEY, name="#almere")
    timestamp = 1_700_000_000
    await MessageRepository.create(
        msg_type="CHAN",
        text="Bob: Test",
        conversation_key=CHAN_KEY,
        sender_timestamp=timestamp,
        received_at=int(time.time()),
    )

    with patch("app.services.queued_channel_ingest.broadcast_event"):
        await queued_channel_ingest.store_channel_message(
            OTHER_KEY, {"channel_idx": 0, "text": "Bob: Test", "sender_timestamp": timestamp}
        )

    assert await MessageRepository.get_all(msg_type="CHAN", conversation_key=OTHER_KEY) == []


@pytest.mark.asyncio
async def test_same_text_in_another_channel_with_another_timestamp_is_stored(test_db):
    await ChannelRepository.upsert(key=CHAN_KEY, name="#mc-radar")
    await ChannelRepository.upsert(key=OTHER_KEY, name="#almere")
    await MessageRepository.create(
        msg_type="CHAN",
        text="Bob: Test",
        conversation_key=CHAN_KEY,
        sender_timestamp=1_700_000_000,
        received_at=int(time.time()),
    )

    with patch("app.services.queued_channel_ingest.broadcast_event"):
        await queued_channel_ingest.store_channel_message(
            OTHER_KEY, {"channel_idx": 0, "text": "Bob: Test", "sender_timestamp": 1_700_000_001}
        )

    rows = await MessageRepository.get_all(msg_type="CHAN", conversation_key=OTHER_KEY)
    assert [row.text for row in rows] == ["Bob: Test"]
