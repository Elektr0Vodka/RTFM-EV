"""DMC observer MQTT export fanout module.

Mirrors the Dutch-MeshCore observer firmware's MQTT bridge (status/packets/raw
topics) for a companion radio, which has no MQTT of its own. Reuses the
community MQTT connection/JWT/stats machinery via subclassing without modifying
it. See docs/superpowers/specs/2026-09-10-mqtt-dmc-observer-export-design.md.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from app.fanout.base import FanoutModule
from app.fanout.community_mqtt import (
    CommunityMqttPublisher,
    _build_radio_info,
    _decode_packet_fields,
    _get_client_version,
)
from app.path_utils import calculate_packet_hash

logger = logging.getLogger(__name__)

_IATA_RE = re.compile(r"^[A-Z]{3}$")

_STATUS_INTERVAL_DEFAULT_MS = 300000
_STATUS_INTERVAL_MIN_MS = 1000
_STATUS_INTERVAL_MAX_MS = 3600000

# on_health field -> DMC stats field. Fields with no host source
# (errors, recv_errors, internal_heap) are intentionally absent.
_HEALTH_TO_STATS = {
    "battery_mv": "battery_mv",
    "uptime_secs": "uptime_secs",
    "packets_sent": "packets_sent",
    "packets_recv": "packets_received",
    "noise_floor_dbm": "noise_floor",
    "tx_air_secs": "tx_air_secs",
    "rx_air_secs": "rx_air_secs",
}
# Firmware stats field order (queue_len inserted after packets_received).
_STATS_ORDER = [
    "battery_mv",
    "uptime_secs",
    "packets_sent",
    "packets_received",
    "queue_len",
    "noise_floor",
    "tx_air_secs",
    "rx_air_secs",
]


def clamp_status_interval_ms(value: Any) -> int:
    """Clamp a status interval to [1000, 3600000] ms, else the 300000 default."""
    try:
        ms = int(value)
    except (TypeError, ValueError):
        return _STATUS_INTERVAL_DEFAULT_MS
    if _STATUS_INTERVAL_MIN_MS <= ms <= _STATUS_INTERVAL_MAX_MS:
        return ms
    return _STATUS_INTERVAL_DEFAULT_MS


def _dmc_timestamp(dt: datetime | None = None) -> str:
    """ISO-8601 UTC ending in +00:00 (matches firmware; never 'Z')."""
    current = dt.astimezone(UTC) if dt is not None else datetime.now(UTC)
    return current.isoformat()


def build_dmc_topic(iata: str, device_hex: str, type_name: str) -> str:
    """Build meshcore/{IATA}/{DEVICE}/{type}."""
    return f"meshcore/{iata.upper()}/{device_hex.upper()}/{type_name}"


def _stats_from_health(health: dict[str, Any] | None, *, queue_len: int) -> dict[str, Any]:
    """Map an on_health snapshot to the firmware stats schema, omitting unknowns."""
    mapped: dict[str, Any] = {}
    if health:
        for src, dest in _HEALTH_TO_STATS.items():
            value = health.get(src)
            if value is not None:
                mapped[dest] = value
    mapped["queue_len"] = queue_len
    return {k: mapped[k] for k in _STATS_ORDER if k in mapped}


def build_status_payload(
    *,
    origin: str,
    origin_id: str,
    model: str,
    firmware_version: str,
    radio: str,
    client_version: str,
    stats: dict[str, Any],
    dt: datetime | None = None,
) -> dict[str, Any]:
    """Build the STATUS payload in firmware field order."""
    payload: dict[str, Any] = {
        "status": "online",
        "timestamp": _dmc_timestamp(dt),
        "origin": origin or "MeshCore Device",
        "origin_id": origin_id.upper(),
        "model": model or "unknown",
        "firmware_version": firmware_version or "unknown",
        "radio": radio,
        "client_version": client_version,
        "repeat": "off",
    }
    if stats:
        payload["stats"] = stats
    return payload


def build_packet_payload(
    data: dict[str, Any], device_name: str, public_key_hex: str
) -> dict[str, Any] | None:
    """Build the PACKETS payload, or None if the packet cannot be decoded/routed."""
    raw_hex = data.get("data", "")
    raw_bytes = bytes.fromhex(raw_hex) if raw_hex else b""

    route, packet_type, payload_len, path_values, _pt = _decode_packet_fields(raw_bytes)
    if route == "U":
        return None

    now = datetime.now(UTC)
    packet_hash = calculate_packet_hash(raw_bytes)

    payload: dict[str, Any] = {
        "timestamp": _dmc_timestamp(now),
        "hash": str(packet_hash).upper(),
        "origin": device_name or "MeshCore Device",
        "type": "PACKET",
        "direction": "rx",
        "time": now.strftime("%H:%M:%S"),
        "date": now.strftime("%d/%m/%Y"),
        "len": str(len(raw_bytes)),
        "packet_type": packet_type,
        "route": route,
        "payload_len": payload_len,
        "raw": raw_hex.upper(),
        "origin_id": public_key_hex.upper(),
    }

    snr_val = data.get("snr")
    if snr_val is not None:
        payload["SNR"] = f"{float(snr_val):.1f}"
    rssi_val = data.get("rssi")
    if rssi_val is not None:
        payload["RSSI"] = f"{int(rssi_val):d}"

    # score: host has no firmware rebroadcast score -> omitted (as firmware omits on NaN).

    if route == "D" and path_values:
        payload["path"] = list(path_values)

    return payload


def build_raw_payload(
    data: dict[str, Any], device_name: str, public_key_hex: str
) -> dict[str, Any] | None:
    """Build the minimal RAW payload, or None when there is no raw hex."""
    raw_hex = data.get("data", "")
    if not raw_hex:
        return None
    return {
        "origin": device_name or "MeshCore Device",
        "origin_id": public_key_hex.upper(),
        "timestamp": _dmc_timestamp(),
        "type": "RAW",
        "data": raw_hex.upper(),
    }


class DmcObserverPublisher(CommunityMqttPublisher):
    """Community MQTT connection, re-shaped to the DMC observer wire schema.

    Reuses CommunityMqttPublisher's connection loop, JWT auth, and device-info
    gathering. Overrides status publishing (DMC schema, config interval, no LWT).
    """

    _log_prefix = "DMC Observer MQTT"

    def __init__(self) -> None:
        super().__init__()
        self.latest_health: dict[str, Any] | None = None

    def _status_interval_secs(self) -> float:
        s = self._settings
        raw = (
            getattr(s, "dmc_status_interval_ms", _STATUS_INTERVAL_DEFAULT_MS)
            if s
            else _STATUS_INTERVAL_DEFAULT_MS
        )
        return clamp_status_interval_ms(raw) / 1000.0

    def _build_client_kwargs(self, settings: object) -> dict[str, Any]:
        # Reuse community broker/auth/TLS/JWT construction, then drop the LWT
        # (the firmware publishes no will message; decision C).
        kwargs = super()._build_client_kwargs(settings)
        kwargs.pop("will", None)
        return kwargs

    def _on_connected(self, settings: object) -> tuple[str, str]:
        host = getattr(settings, "community_mqtt_broker_host", "") or "broker"
        port = getattr(settings, "community_mqtt_broker_port", "")
        return ("DMC Observer MQTT connected", f"{host}:{port}")

    def _on_error(self) -> tuple[str, str]:
        return (
            "DMC Observer MQTT connection failure",
            "Check your internet connection or try again later.",
        )

    async def _publish_status(self, settings: object, *, refresh_stats: bool = True) -> None:
        """Publish the DMC-schema STATUS payload (retained), if enabled."""
        if not getattr(settings, "dmc_publish_status", True):
            return

        from app.keystore import get_public_key
        from app.services.radio_runtime import radio_runtime as radio_manager

        public_key = get_public_key()
        if public_key is None:
            return
        pubkey_hex = public_key.hex().upper()

        iata = getattr(settings, "community_mqtt_iata", "").upper().strip()
        if not _IATA_RE.fullmatch(iata):
            return

        device_name = ""
        if radio_manager.meshcore and radio_manager.meshcore.self_info:
            device_name = radio_manager.meshcore.self_info.get("name", "")

        if radio_manager.device_info_loaded:
            raw_ver = radio_manager.firmware_version or "unknown"
            fw_build = radio_manager.firmware_build or ""
            fw_str = f"{raw_ver} (Build: {fw_build})" if fw_build else f"{raw_ver}"
            model = radio_manager.device_model or "unknown"
        else:
            info = await self._fetch_device_info()
            model = info.get("model", "unknown")
            fw_str = info.get("firmware_version", "unknown")

        stats = _stats_from_health(self.latest_health, queue_len=0)

        payload = build_status_payload(
            origin=device_name,
            origin_id=pubkey_hex,
            model=model,
            firmware_version=fw_str,
            radio=_build_radio_info(),
            client_version=_get_client_version(),
            stats=stats,
        )
        topic = build_dmc_topic(iata, pubkey_hex, "status")
        await self.publish(topic, payload, retain=True)
        self._last_status_publish = time.monotonic()

    async def _on_connected_async(self, settings: object) -> None:
        await self._publish_status(settings)

    async def _on_periodic_wake(self, elapsed: float) -> None:
        if not self._settings:
            return
        now = time.monotonic()
        if (now - self._last_status_publish) >= self._status_interval_secs():
            await self._publish_status(self._settings, refresh_stats=True)


def _config_to_dmc_settings(config: dict) -> SimpleNamespace:
    """Map a fanout config blob to the settings namespace the publisher reads."""
    return SimpleNamespace(
        # Connection knobs reused by the inherited community connection code.
        community_mqtt_enabled=True,
        community_mqtt_broker_host=config.get("broker_host", ""),
        community_mqtt_broker_port=config.get("broker_port", 443),
        community_mqtt_transport=config.get("transport", "websockets"),
        community_mqtt_use_tls=config.get("use_tls", True),
        community_mqtt_tls_verify=config.get("tls_verify", True),
        community_mqtt_auth_mode=config.get("auth_mode", "token"),
        community_mqtt_username=config.get("username", ""),
        community_mqtt_password=config.get("password", ""),
        community_mqtt_iata=config.get("iata", ""),
        community_mqtt_email=config.get("email", ""),
        community_mqtt_token_audience=config.get("token_audience", ""),
        community_mqtt_websocket_path=config.get("websocket_path", "/"),
        # DMC knobs.
        dmc_publish_status=bool(config.get("publish_status", True)),
        dmc_publish_packets=bool(config.get("publish_packets", True)),
        dmc_publish_raw=bool(config.get("publish_raw", False)),
        dmc_status_interval_ms=clamp_status_interval_ms(
            config.get("status_interval_ms", _STATUS_INTERVAL_DEFAULT_MS)
        ),
    )


def _get_pubkey_hex() -> str | None:
    from app.keystore import get_public_key

    key = get_public_key()
    return key.hex().upper() if key is not None else None


def _get_device_name() -> str:
    from app.services.radio_runtime import radio_runtime as radio_manager

    if radio_manager.meshcore and radio_manager.meshcore.self_info:
        return radio_manager.meshcore.self_info.get("name", "")
    return ""


class DmcObserverModule(FanoutModule):
    """Fanout module that mirrors the DMC observer firmware MQTT bridge."""

    def __init__(self, config_id: str, config: dict, *, name: str = "") -> None:
        super().__init__(config_id, config, name=name)
        self._publisher = DmcObserverPublisher()
        self._publisher.set_integration_name(name or config_id)

    async def start(self) -> None:
        await self._publisher.start(_config_to_dmc_settings(self.config))

    async def stop(self) -> None:
        await self._publisher.stop()

    async def on_message(self, data: dict) -> None:
        # DMC observer export publishes packets/raw/status, not decoded messages.
        pass

    async def on_health(self, data: dict) -> None:
        self._publisher.latest_health = data

    async def on_raw(self, data: dict) -> None:
        if not self._publisher.connected:
            return
        pubkey_hex = _get_pubkey_hex()
        if pubkey_hex is None:
            return
        iata = str(self.config.get("iata", "")).upper().strip()
        if not _IATA_RE.fullmatch(iata):
            return
        device_name = _get_device_name()

        try:
            if bool(self.config.get("publish_packets", True)):
                pkt = build_packet_payload(data, device_name, pubkey_hex)
                if pkt is not None:
                    await self._publisher.publish(
                        build_dmc_topic(iata, pubkey_hex, "packets"), pkt
                    )
            if bool(self.config.get("publish_raw", False)):
                raw = build_raw_payload(data, device_name, pubkey_hex)
                if raw is not None:
                    await self._publisher.publish(
                        build_dmc_topic(iata, pubkey_hex, "raw"), raw
                    )
        except Exception as e:  # noqa: BLE001
            logger.warning("DMC Observer MQTT broadcast error: %s", e, exc_info=True)

    @property
    def status(self) -> str:
        if self.last_error:
            return "error"
        if self._publisher._is_configured():
            return "connected" if self._publisher.connected else "disconnected"
        return "disconnected"

    @property
    def last_error(self) -> str | None:
        return self._publisher.last_error
