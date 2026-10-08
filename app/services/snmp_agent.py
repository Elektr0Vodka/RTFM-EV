"""RTFM-EV's own SNMP agent: serves this host node with the firmware's OID layout.

Off by default. When enabled it listens on UDP and answers SNMPv2c GET,
GETNEXT and GETBULK with the same 22 OIDs as the observer firmware
(``app/snmp/mib.py``), so one monitoring template fits a firmware node and
this host. It never touches the radio: every value comes from state the app
already holds.

Where the host values come from, per group:
- system: the radio's uptime, firmware version and name.
- radio: the 60 s radio stats sample (``app/services/radio_stats.py``).
- mqtt: how many MQTT fanout integrations are connected. This app has no
  packet queue and does not skip publishes under memory pressure, so those
  two are 0.
- memory: the host's available memory (``/proc/meminfo``), not a heap. The
  OIDs are 32-bit INTEGERs, so values stop at 2 GiB - 1. PSRAM is 0.
- network: -127, the firmware's own value for "no RSSI on this medium".

A value that is not known yet (for example before the first stats sample) is
served as 0 for numbers and an empty string for the two names.
"""

from __future__ import annotations

import asyncio
import errno
import logging
from typing import Any

from app.models import SnmpAgentSettings, SnmpAgentState
from app.repository.snmp_agent import SnmpAgentRepository
from app.snmp import ber, mib
from app.snmp.agent import SnmpAgentProtocol
from app.snmp.ber import SnmpValue
from app.snmp.message import VarBind

logger = logging.getLogger(__name__)

INT32_MAX = 2**31 - 1
INT32_MIN = -(2**31)
NO_RSSI = -127
BIND_HOST = "0.0.0.0"
RESTART_RETRY_SECONDS = 0.2

_transport: asyncio.DatagramTransport | None = None
_protocol: SnmpAgentProtocol | None = None
_active: SnmpAgentSettings | None = None
_error: str | None = None


def _read_meminfo() -> dict[str, int]:
    """``/proc/meminfo`` values in bytes; empty when the file is not there."""
    values: dict[str, int] = {}
    try:
        with open("/proc/meminfo", encoding="ascii") as handle:
            for line in handle:
                name, _, rest = line.partition(":")
                parts = rest.split()
                if parts and parts[0].isdigit():
                    values[name] = int(parts[0]) * 1024
    except OSError:
        pass
    return values


def _connected_mqtt_integrations() -> int:
    try:
        from app.fanout.manager import fanout_manager

        statuses = fanout_manager.get_statuses()
    except Exception:  # noqa: BLE001 - the agent must answer even if fanout is not up
        return 0
    return sum(
        1
        for info in statuses.values()
        if str(info.get("type", "")).startswith("mqtt") and info.get("status") == "connected"
    )


def host_values() -> dict[str, Any]:
    """This host's values for the MeshCore OID table, by mib key."""
    from app.services.radio_runtime import radio_runtime as radio_manager
    from app.services.radio_stats import get_latest_radio_stats

    stats = get_latest_radio_stats()
    packets = stats.get("packets") or {}
    mc = radio_manager.meshcore
    self_info = mc.self_info if mc else None
    name = self_info.get("name") if isinstance(self_info, dict) else None
    meminfo = _read_meminfo()
    available = meminfo.get("MemAvailable", 0)

    return {
        "uptime_secs": stats.get("uptime_secs"),
        "firmware_version": getattr(radio_manager, "firmware_version", None),
        "node_name": name,
        "packets_recv": packets.get("recv"),
        "packets_sent": packets.get("sent"),
        "recv_errors": packets.get("recv_errors", stats.get("recv_errors")),
        "noise_floor": stats.get("noise_floor"),
        "last_rssi": stats.get("last_rssi"),
        "last_snr": stats.get("last_snr"),
        "sent_flood": packets.get("flood_tx"),
        "sent_direct": packets.get("direct_tx"),
        "recv_flood": packets.get("flood_rx"),
        "recv_direct": packets.get("direct_rx"),
        "total_air_time_secs": stats.get("tx_air_secs"),
        "mqtt_connected_slots": _connected_mqtt_integrations(),
        "mqtt_queue_depth": 0,
        "mqtt_skipped_publishes": 0,
        "free_heap": available,
        "max_alloc": available,
        "internal_free": meminfo.get("MemFree", 0),
        "psram_free": 0,
        "wifi_rssi": NO_RSSI,
    }


def _to_snmp(entry: mib.MibEntry, value: Any) -> SnmpValue:
    if entry.kind == "str":
        text = value if isinstance(value, str) else ""
        return SnmpValue(ber.TAG_OCTET_STRING, text.encode("utf-8")[:255])
    number = 0.0
    if isinstance(value, int | float) and not isinstance(value, bool):
        number = float(value)
    # mib.scale turns the wire value into the unit; invert it for serving.
    raw = round(number / entry.scale)
    return SnmpValue(ber.TAG_INTEGER, max(INT32_MIN, min(INT32_MAX, raw)))


def build_table(values: dict[str, Any] | None = None) -> list[VarBind]:
    """The served OID table, sorted by OID, from ``values`` (default: this host)."""
    values = host_values() if values is None else values
    table = [(entry.oid, _to_snmp(entry, values.get(entry.key))) for entry in mib.ENTRIES]
    return sorted(table, key=lambda item: item[0])


def _safe_table() -> list[VarBind]:
    try:
        return build_table()
    except Exception:  # noqa: BLE001 - serve zeros rather than drop the request
        logger.exception("SNMP agent could not read host values")
        return build_table({})


def get_snmp_agent_state(settings: SnmpAgentSettings) -> SnmpAgentState:
    counters = _protocol.counters if _protocol is not None else None
    return SnmpAgentState(
        settings=settings,
        running=_transport is not None,
        error=_error,
        requests=counters.requests if counters else 0,
        bad_community=counters.bad_community if counters else 0,
    )


async def _close() -> None:
    """Close the listener and let the loop release the socket.

    ``transport.close()`` only schedules the close; a restart on the same port
    would otherwise try to bind while the old socket still holds it.
    """
    global _transport, _protocol, _active
    transport = _transport
    _transport = None
    _protocol = None
    _active = None
    if transport is not None:
        transport.close()
        await asyncio.sleep(0)


async def _bind(settings: SnmpAgentSettings) -> tuple[asyncio.DatagramTransport, SnmpAgentProtocol]:
    loop = asyncio.get_running_loop()
    return await loop.create_datagram_endpoint(
        lambda: SnmpAgentProtocol(settings.community.encode("utf-8"), _safe_table),
        local_addr=(BIND_HOST, settings.port),
    )


async def apply_snmp_agent_settings(settings: SnmpAgentSettings) -> None:
    """Start, restart or stop the listener so it matches ``settings``.

    A bind failure (port in use, no permission for a port below 1024) is kept
    as the state's ``error``; it does not raise.
    """
    global _transport, _protocol, _active, _error
    if not settings.enabled:
        if _transport is not None:
            logger.info("SNMP agent stopped")
        await _close()
        _error = None
        return
    if _transport is not None and _active == settings:
        return

    restarting = _transport is not None
    await _close()
    try:
        try:
            transport, protocol = await _bind(settings)
        except OSError as exc:
            if not (restarting and exc.errno == errno.EADDRINUSE):
                raise
            # The old listener's socket was not released yet; give it a moment.
            await asyncio.sleep(RESTART_RETRY_SECONDS)
            transport, protocol = await _bind(settings)
    except OSError as exc:
        _error = f"cannot listen on UDP port {settings.port}: {exc}"
        logger.warning("SNMP agent: %s", _error)
        return
    _transport, _protocol, _active, _error = transport, protocol, settings.model_copy(), None
    logger.info("SNMP agent listening on UDP port %d", settings.port)


async def start_snmp_agent() -> None:
    """Lifespan hook: bring the agent up when it is enabled in the settings."""
    try:
        await apply_snmp_agent_settings(await SnmpAgentRepository.get())
    except Exception as exc:  # noqa: BLE001 - an optional feature must not block startup
        logger.error("SNMP agent failed to start: %s", exc, exc_info=True)


async def stop_snmp_agent() -> None:
    global _error
    if _transport is not None:
        logger.info("SNMP agent stopped")
    await _close()
    _error = None
