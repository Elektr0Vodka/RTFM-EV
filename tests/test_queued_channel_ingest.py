"""Queued channel frames the library fetches on its own are stored, once."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.radio import radio_manager
from app.repository import ChannelRepository, MessageRepository
from app.services import queued_channel_ingest

CHAN_KEY = "AB" * 16


@pytest.fixture
def slot_zero(monkeypatch):
    monkeypatch.setattr(radio_manager, "_channel_key_by_slot", {0: CHAN_KEY})


@pytest.mark.asyncio
async def test_queued_channel_message_is_stored_once(test_db, slot_zero):
    await ChannelRepository.upsert(key=CHAN_KEY, name="#queued")
    payload = {"channel_idx": 0, "text": "Bob: hello there", "sender_timestamp": 1_700_000_000}
    with patch("app.services.queued_channel_ingest.broadcast_event"):
        await queued_channel_ingest.store_channel_message(dict(payload))
        await queued_channel_ingest.store_channel_message(dict(payload))

    rows = await MessageRepository.get_all(msg_type="CHAN", conversation_key=CHAN_KEY)
    assert [row.text for row in rows] == ["Bob: hello there"]


@pytest.mark.asyncio
async def test_unknown_slot_is_left_alone(test_db, monkeypatch):
    monkeypatch.setattr(radio_manager, "_channel_key_by_slot", {})
    await queued_channel_ingest.store_channel_message({"channel_idx": 5, "text": "Bob: hi"})
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
        await queued_channel_ingest.store_channel_data(payload)

    rows = await MessageRepository.get_all(msg_type="CHAN", conversation_key=CHAN_KEY)
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_handler_waits_the_grace_period_before_storing(monkeypatch):
    """The raw packet of the same message is given time to be stored first."""
    monkeypatch.setattr(queued_channel_ingest, "QUEUED_FRAME_GRACE_SECONDS", 0.05)
    store = AsyncMock()
    monkeypatch.setattr(queued_channel_ingest, "store_channel_message", store)

    await queued_channel_ingest.on_channel_message(SimpleNamespace(payload={"channel_idx": 0}))
    store.assert_called_once()  # the coroutine is created now ...
    store.assert_not_awaited()  # ... and awaited only after the grace period

    await asyncio.sleep(0.15)
    store.assert_awaited_once_with({"channel_idx": 0})
