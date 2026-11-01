"""Channel messages and channel data the radio hands over from its queue.

The radio queues every channel message and channel datagram it receives and
says so; the library then fetches the queue by itself. Normally the same
packet also reached us as a raw packet first and was stored from that, and
the queued copy is recognised as a duplicate. These handlers store the frames
that never came as raw packets (heard while the app was not connected, or a
raw frame the radio did not pass on), so they are not lost.

The radio queues a frame even while the app is connected, right after it
passed the same packet on as a raw packet. A queued copy is therefore stored
only after ``QUEUED_FRAME_GRACE_SECONDS``: the raw packet, which carries the
route, signal and region, is stored first and the late copy is a duplicate.

The channel is looked up from the slots the app itself configured, when the
frame arrives; no radio command is sent from here. A frame names only a slot,
so a copy of a message another channel just stored is skipped: the raw packet
decrypted to the real channel.
"""

import asyncio
import logging
import time
from collections.abc import Coroutine
from typing import TYPE_CHECKING, Any

from app.decoder import (
    GROUP_DATA_TYPE_AEIC_IMAGE,
    DecryptedGroupData,
    parse_group_data_image_chunk,
)
from app.radio import radio_manager
from app.repository import ChannelRepository, MessageRepository
from app.services.messages import create_fallback_channel_message, create_group_data_message
from app.smaz import decode_message_text
from app.websocket import broadcast_event

if TYPE_CHECKING:
    from meshcore.events import Event

logger = logging.getLogger(__name__)

QUEUED_FRAME_GRACE_SECONDS = 3.0
OTHER_CHANNEL_COPY_WINDOW_SECONDS = 60
_pending: set[asyncio.Task] = set()


def _store_later(store: Coroutine[Any, Any, None]) -> None:
    async def run() -> None:
        await asyncio.sleep(QUEUED_FRAME_GRACE_SECONDS)
        await store

    task = asyncio.create_task(run())
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def _channel_key_for_slot(slot: object) -> str | None:
    try:
        index = int(slot)  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return None
    key = radio_manager._channel_key_by_slot.get(index)
    if key is None:
        key = radio_manager.get_pending_message_channel_key(index)
    return key


def _split_sender(text: str) -> tuple[str | None, str]:
    from app.radio_sync import _split_channel_sender_and_text

    return _split_channel_sender_and_text(text)


async def on_channel_message(event: "Event") -> None:
    """Store a queued channel message (CHANNEL_MSG_RECV) after the grace period."""
    payload = dict(event.payload or {})
    # Read the slot now: a send during the grace period can load another channel.
    channel_key = _channel_key_for_slot(payload.get("channel_idx"))
    if channel_key is None:
        logger.debug(
            "Queued channel message on unknown slot %r; left to the startup drain",
            payload.get("channel_idx"),
        )
        return
    _store_later(store_channel_message(channel_key, payload))


async def on_channel_data(event: "Event") -> None:
    """Store queued channel data (CHANNEL_DATA_RECV) after the grace period."""
    payload = dict(event.payload or {})
    channel_key = _channel_key_for_slot(payload.get("channel_idx"))
    if channel_key is None:
        logger.debug("Queued channel data on unknown slot %r", payload.get("channel_idx"))
        return
    _store_later(store_channel_data(channel_key, payload))


async def store_channel_message(channel_key: str, payload: dict) -> None:
    """Store a queued channel message unless it is already stored."""
    channel = await ChannelRepository.get_by_key(channel_key)
    received_at = int(time.time())
    ts = payload.get("sender_timestamp")
    sender_name, message_text = _split_sender(payload.get("text", ""))
    # A frame names only a slot, and the slot may have changed under us. The raw
    # packet decrypted to the real channel, so its row wins over this copy.
    decoded = decode_message_text(message_text)
    stored_text = f"{sender_name}: {decoded}" if sender_name else decoded
    if ts is not None and await MessageRepository.has_recent_copy_in_other_channel(
        stored_text, ts, channel_key, received_at - OTHER_CHANNEL_COPY_WINDOW_SECONDS
    ):
        logger.debug("Queued channel message already stored in another channel; skipped")
        return
    try:
        await create_fallback_channel_message(
            conversation_key=channel_key,
            message_text=message_text,
            sender_timestamp=ts if ts is not None else received_at,
            received_at=received_at,
            path=payload.get("path"),
            path_len=payload.get("path_len"),
            txt_type=payload.get("txt_type", 0),
            sender_name=sender_name,
            channel_name=channel.name if channel else None,
            broadcast_fn=broadcast_event,
        )
    except Exception:
        logger.warning("Failed to store a queued channel message", exc_info=True)


async def store_channel_data(channel_key: str, payload: dict) -> None:
    """Store a queued channel datagram like a received GRP_DATA."""
    try:
        blob = bytes.fromhex(payload.get("payload") or "")
        data_type = int(payload.get("data_type", 0))
    except (TypeError, ValueError):
        logger.debug("Queued channel data with an unreadable payload; skipped")
        return

    channel = await ChannelRepository.get_by_key(channel_key)
    decrypted = DecryptedGroupData(
        data_type=data_type,
        data=blob,
        channel_hash="",
        image_chunk=(
            parse_group_data_image_chunk(blob) if data_type == GROUP_DATA_TYPE_AEIC_IMAGE else None
        ),
    )
    path_len = payload.get("path_len")
    snr = payload.get("SNR")
    received_at = int(time.time())
    try:
        from app.services.trackers import DatagramContext, handle_tracker_datagram

        ctx = DatagramContext(
            packet_id=None,
            channel_key=channel_key.upper(),
            channel_name=channel.name if channel else None,
            received_at=received_at,
            path=None,
            path_len=path_len if isinstance(path_len, int) and path_len != 255 else None,
            rssi=None,
            snr=snr if isinstance(snr, int | float) else None,
            packet_hash=None,
            transport_code=None,
            region=None,
        )
        if await handle_tracker_datagram(decrypted, ctx):
            return
        await create_group_data_message(
            packet_id=None,
            channel_key=channel_key,
            decrypted=decrypted,
            received_at=received_at,
            path_len=ctx.path_len,
            snr=ctx.snr,
            channel_name=ctx.channel_name,
            broadcast_fn=broadcast_event,
        )
    except Exception:
        logger.warning("Failed to store queued channel data", exc_info=True)
