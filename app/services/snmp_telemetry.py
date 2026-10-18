"""SNMP polls as a telemetry source, for nodes marked ``use_as_telemetry``.

A marked node's good SNMP polls feed the repeater telemetry history (at most
one row an hour, the RF scheduler's own fastest rate) and the fanout modules,
so its charts and Home Assistant sensors keep going while the RF
tracked-telemetry cycle skips it. ``is_snmp_healthy`` is the rule that cycle
uses to decide whether RF is needed as a fallback.

Only mapped telemetry values leave this module; the address and community stay
in ``contact_snmp``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.models import CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM
from app.repository import ContactRepository
from app.repository.repeater_telemetry import RepeaterTelemetryRepository

logger = logging.getLogger(__name__)

# Same rule the SNMP Home Assistant sensors use for "unavailable"
# (app/fanout/mqtt_ha.py _SNMP_EXPIRE_*): three missed polls, at least 10 minutes.
HEALTH_MIN_SECONDS = 600
HEALTH_MISSED_POLLS = 3
# The RF telemetry scheduler runs at most hourly; SNMP rows keep that density.
HISTORY_MIN_GAP_SECONDS = 3600

SNMP_SOURCE = "snmp"

# SNMP key -> RF telemetry key (names used by _collect_repeater_telemetry).
_FIELD_MAP = {
    "tx_queue_len": "tx_queue_len",
    "noise_floor": "noise_floor_dbm",
    "last_rssi": "last_rssi_dbm",
    "last_snr": "last_snr_db",
    "packets_recv": "packets_received",
    "packets_sent": "packets_sent",
    "total_air_time_secs": "airtime_seconds",
    "rx_air_time_secs": "rx_airtime_seconds",
    "uptime_secs": "uptime_seconds",
    "sent_flood": "sent_flood",
    "sent_direct": "sent_direct",
    "recv_flood": "recv_flood",
    "recv_direct": "recv_direct",
    "flood_dups": "flood_dups",
    "direct_dups": "direct_dups",
    "recv_errors": "recv_errors",
    "neighbour_count": "neighbor_count",
}

# Keeps fire-and-forget fanout tasks alive until they finish.
_background_tasks: set[asyncio.Task] = set()


def is_snmp_healthy(config: dict[str, Any], now: int) -> bool:
    """True when a marked node with scheduled polling answered recently enough
    that RF telemetry is not needed."""
    if not config.get("use_as_telemetry") or not config.get("poll_enabled"):
        return False
    last_ok = config.get("last_ok_at")
    if last_ok is None:
        return False
    window = max(
        HEALTH_MIN_SECONDS, HEALTH_MISSED_POLLS * int(config["poll_interval_minutes"]) * 60
    )
    return now - int(last_ok) <= window


def snmp_battery_volts(values: dict[str, Any]) -> float | None:
    """Battery in volts from ``battery_mv``; 0 is the firmware's "no reading"."""
    mv = values.get("battery_mv")
    if isinstance(mv, (int, float)) and not isinstance(mv, bool) and mv > 0:
        return mv / 1000.0
    return None


def snmp_mcu_temperature(values: dict[str, Any]) -> float | None:
    """Chip temperature from ``mcu_temp_c``; -127 is the firmware's "unavailable"."""
    temp = values.get("mcu_temp_c")
    if isinstance(temp, (int, float)) and not isinstance(temp, bool) and temp != -127:
        return float(temp)
    return None


def snmp_to_repeater_telemetry(values: dict[str, Any]) -> dict[str, Any]:
    """Map an SNMP poll onto the RF repeater telemetry field names.

    A value the node did not serve is left out, never written as 0.
    """
    data: dict[str, Any] = {}
    volts = snmp_battery_volts(values)
    if volts is not None:
        data["battery_volts"] = volts
    for snmp_key, rf_key in _FIELD_MAP.items():
        value = values.get(snmp_key)
        if value is not None:
            data[rf_key] = value
    data["source"] = SNMP_SOURCE
    return data


async def record_snmp_telemetry(
    config: dict[str, Any], contact_type: int | None, timestamp: int, values: dict[str, Any]
) -> bool:
    """Write a marked repeater's or room server's poll to the telemetry history
    when its newest row (any source) is an hour old or more, and hand it to
    the fanout modules. Returns True when a row was written.

    The mark only counts with scheduled polling on, as everywhere else, so a
    "Poll now" on a marked node without a schedule writes nothing here."""
    if not config.get("use_as_telemetry") or not config.get("poll_enabled"):
        return False
    if contact_type not in (CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM):
        return False
    public_key: str = config["public_key"]
    newest = await RepeaterTelemetryRepository.get_latest(public_key)
    if newest is not None and timestamp - int(newest["timestamp"]) < HISTORY_MIN_GAP_SECONDS:
        return False

    data = snmp_to_repeater_telemetry(values)
    await RepeaterTelemetryRepository.record(public_key=public_key, timestamp=timestamp, data=data)

    contact = await ContactRepository.get_by_key(public_key)
    name = (contact.name if contact else None) or public_key[:12]
    from app.fanout.manager import fanout_manager

    task = asyncio.create_task(
        fanout_manager.broadcast_telemetry(
            {"public_key": public_key, "name": name, "timestamp": timestamp, **data}
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return True
