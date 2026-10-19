"""Full capture (meshcomod): ask the radio for the frames it drops and route them.

On a meshcomod connect RTFM-EV sends ``0xE0`` with the saved flags (0 turns it
off; the radio forgets it on reboot anyway). The reply tells whether the
firmware supports it. When it does, a permanent wrapper on the reader's
``handle_rx`` takes every ``0xC0`` push away from meshcore_py and reassembles
it (``app/full_capture.py``):

- over-long valid frames (status 0) go through ``process_raw_packet`` like any
  RX log frame;
- damaged frames (status 1-3) go to ``rx_bad_frames`` and out as a WS-only
  ``rx_bad_frame`` event, never to ``raw_packets``, fanout or MQTT;
- drop notices (status 4) add to ``radio_manager.rx_ring_drops``.

Nothing here transmits on RF: ``0xE0`` is a command to the companion only.
"""

import asyncio
import logging
import time

from meshcore import EventType

from app.full_capture import (
    FLAGS_SUPPORTED,
    FULL_CAPTURE_PUSH,
    STATUS_DROPS,
    STATUS_OK,
    CapturedFrame,
    Reassembler,
    build_set_full_capture_frame,
    parse_part,
)
from app.models import RxBadFrameBroadcast
from app.radio import radio_manager
from app.repository.rx_bad_frames import RxBadFrameRepository
from app.websocket import broadcast_event

logger = logging.getLogger(__name__)

RESP_CODE_OK = 0x00
# Set on the reader once wrapped, so a reconnect on the same reader does not wrap twice.
HOOK_ATTR = "_rtfm_full_capture_hooked"

reassembler = Reassembler()
_pending: set[asyncio.Task] = set()


async def enable_full_capture(mc, flags: int) -> int | None:
    """Send ``0xE0``; the supported flag mask, or None when the firmware refuses.

    meshcore_py turns the reply into an OK event without its payload byte, so
    the raw reply is read with a temporary hook, as ``capture_tuning_frame`` does.
    """
    reader = mc._reader
    original = reader.handle_rx
    holder: dict[str, bytes | None] = {"frame": None}

    async def hooked(data):
        try:
            frame = bytes(data)
            if frame and frame[0] == RESP_CODE_OK:
                holder["frame"] = frame
        except Exception:  # noqa: BLE001 - sniffing must not break the pipeline
            logger.debug("Full capture reply sniff failed", exc_info=True)
        return await original(data)

    reader.handle_rx = hooked
    try:
        result = await mc.commands.send(
            build_set_full_capture_frame(flags), [EventType.OK, EventType.ERROR]
        )
    except Exception:  # noqa: BLE001 - an unsupported command must not break connect
        logger.debug("Full capture command failed", exc_info=True)
        return None
    finally:
        reader.handle_rx = original
    frame = holder["frame"]
    if result is None or result.type != EventType.OK or frame is None or len(frame) < 2:
        return None
    return frame[1] & FLAGS_SUPPORTED


def install_full_capture_hook(mc) -> None:
    """Take ``0xC0`` pushes out of the reader; pass everything else on unchanged."""
    reader = mc._reader
    if getattr(reader, HOOK_ATTR, False):
        return
    original = reader.handle_rx

    async def hooked(data):
        if len(data) > 0 and data[0] == FULL_CAPTURE_PUSH:
            try:
                _handle_push(bytes(data))
            except Exception:  # noqa: BLE001 - a bad push must not break the reader
                logger.debug("Full capture push dropped", exc_info=True)
            return None
        return await original(data)

    reader.handle_rx = hooked
    setattr(reader, HOOK_ATTR, True)


def _handle_push(frame: bytes) -> None:
    now = time.monotonic()
    reassembler.expire(now)
    part = parse_part(frame)
    if part is None:
        logger.debug("Malformed full capture push: %s", frame.hex())
        return
    captured = reassembler.feed(part, now)
    if captured is None:
        return
    # Routing does database work; keep the reader loop free.
    task = asyncio.get_running_loop().create_task(_route_logged(captured))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def _route_logged(frame: CapturedFrame) -> None:
    try:
        await route_captured(frame)
    except Exception:
        logger.exception("Full capture frame could not be stored")


async def drain_pending() -> None:
    """Wait for frames still being routed (tests, shutdown)."""
    while _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)


async def route_captured(frame: CapturedFrame) -> None:
    if frame.status == STATUS_DROPS:
        radio_manager.rx_ring_drops += frame.dropped or 0
        return
    if frame.status == STATUS_OK:
        from app.packet_processor import process_raw_packet

        await process_raw_packet(frame.data, snr=frame.snr, rssi=frame.rssi)
        return
    from app.packet_processor import _raw_observation_counter

    timestamp = int(time.time())
    row_id = await RxBadFrameRepository.create(
        timestamp, frame.status, frame.data, frame.rssi, frame.snr
    )
    broadcast_event(
        "rx_bad_frame",
        RxBadFrameBroadcast(
            id=row_id,
            observation_id=next(_raw_observation_counter),
            timestamp=timestamp,
            data=frame.data.hex(),
            status=frame.status,
            snr=frame.snr,
            rssi=frame.rssi,
        ).model_dump(),
    )


async def apply_on_connect(mc) -> None:
    """Send the saved flags to a meshcomod radio and hook the reader when it answers."""
    radio_manager.full_capture_supported_flags = 0
    radio_manager.rx_ring_drops = 0
    flags = await RxBadFrameRepository.get_flags()
    supported = await enable_full_capture(mc, flags)
    if supported is None:
        logger.info("Full capture: not supported by this firmware")
        return
    install_full_capture_hook(mc)
    radio_manager.full_capture_supported_flags = supported
    logger.info("Full capture: flags 0x%02x (radio supports 0x%02x)", flags, supported)
