"""Binary channel datagrams (GRP_DATA) sent through the companion."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from meshcore import EventType

from app.models import SendChannelDataRequest
from app.radio import radio_manager
from app.repository import ChannelRepository
from app.routers.messages import send_channel_data
from app.services.message_send import MAX_CHANNEL_DATA_BYTES, channel_data_frame

CHAN_KEY = "C3" * 16


def _ok(event_type=EventType.OK):
    result = MagicMock()
    result.type = event_type
    result.payload = {}
    return result


def _mc():
    mc = MagicMock()
    mc.self_info = {"name": "Node"}
    mc.commands = MagicMock()
    mc.commands.send = AsyncMock(return_value=_ok())
    mc.commands.set_channel = AsyncMock(return_value=_ok())
    mc.commands.set_flood_scope = AsyncMock(return_value=_ok())
    return mc


@pytest.fixture(autouse=True)
def _restore_radio():
    prev = radio_manager._meshcore
    prev_slots = radio_manager._channel_slot_by_key.copy()
    prev_keys = radio_manager._channel_key_by_slot.copy()
    yield
    radio_manager._meshcore = prev
    radio_manager._channel_slot_by_key = prev_slots
    radio_manager._channel_key_by_slot = prev_keys


def test_frame_layout_matches_the_companion_command():
    frame = channel_data_frame(3, 0xFF01, b"\xa1\xb2")
    assert frame == bytes([0x3E, 3, 0xFF, 0x01, 0xFF, 0xA1, 0xB2])


@pytest.mark.asyncio
async def test_sends_the_datagram_on_the_channel_slot(test_db):
    await ChannelRepository.upsert(key=CHAN_KEY, name="#data")
    mc = _mc()
    with (
        patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
    ):
        result = await send_channel_data(
            SendChannelDataRequest(channel_key=CHAN_KEY, data_type=0xFF00, payload_hex="0102 03")
        )

    assert result == {"status": "ok", "bytes": 3}
    mc.commands.set_channel.assert_awaited_once()
    slot = mc.commands.set_channel.await_args.kwargs["channel_idx"]
    frame = mc.commands.send.await_args.args[0]
    assert frame == bytes([0x3E, slot, 0xFF, 0x00, 0xFF, 1, 2, 3])


@pytest.mark.asyncio
async def test_refuses_a_payload_the_radio_would_not_send(test_db):
    await ChannelRepository.upsert(key=CHAN_KEY, name="#data")
    mc = _mc()
    with (
        patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
        pytest.raises(HTTPException) as exc_info,
    ):
        await send_channel_data(
            SendChannelDataRequest(
                channel_key=CHAN_KEY,
                data_type=0xFF00,
                payload_hex="00" * (MAX_CHANNEL_DATA_BYTES + 1),
            )
        )
    assert exc_info.value.status_code == 422
    mc.commands.send.assert_not_awaited()


@pytest.mark.asyncio
async def test_radio_refusal_is_reported(test_db):
    await ChannelRepository.upsert(key=CHAN_KEY, name="#data")
    mc = _mc()
    mc.commands.send = AsyncMock(return_value=_ok(EventType.ERROR))
    with (
        patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
        pytest.raises(HTTPException) as exc_info,
    ):
        await send_channel_data(
            SendChannelDataRequest(channel_key=CHAN_KEY, data_type=0xFF00, payload_hex="01")
        )
    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_unknown_channel_is_404(test_db):
    mc = _mc()
    with (
        patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
        pytest.raises(HTTPException) as exc_info,
    ):
        await send_channel_data(
            SendChannelDataRequest(channel_key="AB" * 16, data_type=0xFF00, payload_hex="01")
        )
    assert exc_info.value.status_code == 404


def test_reserved_data_type_is_rejected_by_the_model():
    with pytest.raises(ValueError):
        SendChannelDataRequest(channel_key=CHAN_KEY, data_type=0, payload_hex="01")
