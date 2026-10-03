"""Periodic MeshCore TEAM ``#TEL:`` position beacon.

Off unless ``app_settings.team_beacon.enabled`` is set. When on, this radio's
own advertised position is sent as a TEAM ``#TEL:`` channel message every
``interval_seconds`` on the one configured private channel, through the normal
channel send path (so the row is stored and shown like any outgoing message).

This transmits on RF. It never uses the Public channel or a hashtag channel,
and sends nothing without a connected radio and a valid position.
"""

import asyncio
import logging
import time

from app.channel_constants import is_public_channel_key
from app.repository import AppSettingsRepository, ChannelRepository, MessageRepository
from app.services.message_send import send_channel_message_to_channel
from app.services.radio_runtime import radio_runtime as radio_manager
from app.services.radio_stats import get_latest_radio_stats
from app.team_payloads import encode_telemetry
from app.websocket import broadcast_error, broadcast_event

logger = logging.getLogger(__name__)

# How often the loop looks whether a beacon is due (the interval itself is a setting).
CHECK_INTERVAL_SECONDS = 15
# Same scratch slot the channel send route uses for channels that are not on the radio.
TEMP_RADIO_SLOT = 0

_task: asyncio.Task | None = None
_last_sent_at: float | None = None


def reset_schedule() -> None:
    """Forget the last send, so the next check may send at once."""
    global _last_sent_at
    _last_sent_at = None


def latest_battery_mv() -> int | None:
    battery_mv = get_latest_radio_stats().get("battery_mv")
    return battery_mv if isinstance(battery_mv, int) else None


def _own_position() -> tuple[float, float] | None:
    mc = radio_manager.meshcore
    info = mc.self_info if mc else None
    if not isinstance(info, dict):
        return None
    lat, lon = info.get("adv_lat"), info.get("adv_lon")
    if not isinstance(lat, int | float) or not isinstance(lon, int | float):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None
    return float(lat), float(lon)


async def send_team_beacon_if_due(now: float | None = None) -> bool:
    """Send one beacon when the settings allow it and the interval has passed.

    Returns True when a beacon was sent. A failed send is not counted, so it is
    retried at the next check.
    """
    global _last_sent_at
    settings = (await AppSettingsRepository.get()).team_beacon
    if not settings.enabled or not radio_manager.is_connected:
        return False
    current = time.time() if now is None else now
    if _last_sent_at is not None and current - _last_sent_at < settings.interval_seconds:
        return False

    channel_key = settings.channel_key.upper()
    channel = await ChannelRepository.get_by_key(channel_key)
    if channel is None or channel.is_hashtag or is_public_channel_key(channel_key):
        logger.warning("TEAM beacon skipped: channel missing, public or hashtag")
        return False
    position = _own_position()
    if position is None:
        logger.debug("TEAM beacon skipped: the radio has no position set")
        return False

    try:
        await send_channel_message_to_channel(
            channel=channel,
            channel_key_upper=channel_key,
            key_bytes=bytes.fromhex(channel_key),
            text=encode_telemetry(*position, radio_battery_mv=latest_battery_mv()),
            radio_manager=radio_manager,
            broadcast_fn=broadcast_event,
            error_broadcast_fn=broadcast_error,
            now_fn=time.time,
            temp_radio_slot=TEMP_RADIO_SLOT,
            message_repository=MessageRepository,
        )
    except Exception as e:
        logger.warning("TEAM beacon send failed: %s", e)
        return False
    _last_sent_at = current
    return True


async def _beacon_loop() -> None:
    while True:
        try:
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)
            await send_team_beacon_if_due()
        except asyncio.CancelledError:
            logger.info("TEAM beacon task cancelled")
            break
        except Exception as e:
            logger.error("Error in TEAM beacon loop: %s", e, exc_info=True)


def start_team_beacon() -> None:
    """Start the beacon task. It reads the settings each check, so it idles while off."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_beacon_loop())
        logger.info("Started TEAM beacon task (off unless enabled in settings)")


async def stop_team_beacon() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    _task = None
