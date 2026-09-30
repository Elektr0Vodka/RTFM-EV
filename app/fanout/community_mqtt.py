"""Community MQTT publisher for sharing raw packets with the MeshCore community.

Publishes raw packet data to mqtt-us-v1.letsmesh.net using the protocol
defined by meshcore-packet-capture (https://github.com/agessaman/meshcore-packet-capture).

Authentication uses Ed25519 JWT tokens signed with the radio's private key.
This module is independent from the private MqttPublisher in app/mqtt.py.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import ssl
import time
from datetime import UTC, datetime
from typing import Any, Protocol

import aiomqtt

from app.fanout.mqtt_base import BaseMqttPublisher
from app.keystore import ed25519_sign_expanded
from app.path_utils import calculate_packet_hash, parse_packet_envelope, split_path_hex
from app.version_info import get_app_build_info

logger = logging.getLogger(__name__)

_DEFAULT_BROKER = "mqtt-us-v1.letsmesh.net"
_DEFAULT_PORT = 443  # Community protocol uses WSS on port 443 by default
_CLIENT_ID = "RTFM-EV"

# JWT lifetime kept under 1 hour for compatibility with services that reject
# tokens with exp > 3600s from iat (e.g. Waev.app).  Proactive renewal
# reconnects 5 minutes before expiry.
_TOKEN_LIFETIME = 3300  # 55 minutes
_TOKEN_RENEWAL_THRESHOLD = _TOKEN_LIFETIME - 300  # 50 minutes

# Periodic status republish interval (matches meshcore-packet-capture reference)
_STATS_REFRESH_INTERVAL = 300  # 5 minutes
_STATS_MIN_CACHE_SECS = 60  # Don't re-fetch stats within 60s

_STATUS_INTERVAL_DEFAULT_MS = 300000
_STATUS_INTERVAL_MIN_MS = 1000
_STATUS_INTERVAL_MAX_MS = 3600000

# DMC observer ``filter`` topic cadence (``set mqtt.filter.interval``, 60-600 s, default 60 s).
_FILTER_INTERVAL_DEFAULT_MS = 60000
_FILTER_INTERVAL_MIN_MS = 60000
_FILTER_INTERVAL_MAX_MS = 600000
# The periodic wake fires every ~60 s; allow for its jitter when an interval is due.
_WAKE_SLACK_SECONDS = 2.0
# Host repeater states in which the filter / own-neighbour topics are published.
_HOST_REPEATER_ACTIVE = ("shadow", "armed")
# Seeds the config topic's ``boot_id`` (fw: one id per boot).
_PROCESS_START = time.time()


def _clamp_status_interval_ms(value: object) -> int:
    """Clamp a status interval to [1000, 3600000] ms, else the 300000 default."""
    if isinstance(value, bool) or not isinstance(value, int):
        return _STATUS_INTERVAL_DEFAULT_MS
    if _STATUS_INTERVAL_MIN_MS <= value <= _STATUS_INTERVAL_MAX_MS:
        return value
    return _STATUS_INTERVAL_DEFAULT_MS


# Route type mapping: bottom 2 bits of first byte
_ROUTE_MAP = {0: "F", 1: "F", 2: "D", 3: "T"}


def _clamp_filter_interval_ms(value: object) -> int:
    """Clamp the ``filter`` topic interval to the firmware's 60-600 s band."""
    if not isinstance(value, int) or isinstance(value, bool):
        return _FILTER_INTERVAL_DEFAULT_MS
    return max(_FILTER_INTERVAL_MIN_MS, min(_FILTER_INTERVAL_MAX_MS, value))


def _format_utc_timestamp(dt: datetime | None = None) -> str:
    """Return an ISO-8601 UTC timestamp accepted by community observers."""
    current = dt.astimezone(UTC) if dt is not None else datetime.now(UTC)
    return current.isoformat().replace("+00:00", "Z")


class CommunityMqttSettings(Protocol):
    """Attributes expected on the settings object for the community MQTT publisher."""

    community_mqtt_enabled: bool
    community_mqtt_broker_host: str
    community_mqtt_broker_port: int
    community_mqtt_transport: str
    community_mqtt_use_tls: bool
    community_mqtt_tls_verify: bool
    community_mqtt_auth_mode: str
    community_mqtt_username: str
    community_mqtt_password: str
    community_mqtt_iata: str
    community_mqtt_email: str
    community_mqtt_token_audience: str
    community_mqtt_websocket_path: str
    community_mqtt_publish_status: bool
    community_mqtt_status_interval_ms: int


def _base64url_encode(data: bytes) -> str:
    """Base64url encode without padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _generate_jwt_token(
    private_key: bytes,
    public_key: bytes,
    *,
    audience: str = _DEFAULT_BROKER,
    email: str = "",
) -> str:
    """Generate a JWT token for community MQTT authentication.

    Creates a token with Ed25519 signature using MeshCore's expanded key format.
    Token format: header_b64.payload_b64.signature_hex

    Optional ``email`` embeds a node-claiming identity so the community
    aggregator can associate this radio with an owner.
    """
    header = {"alg": "Ed25519", "typ": "JWT"}
    now = int(time.time())
    pubkey_hex = public_key.hex().upper()
    payload: dict[str, object] = {
        "publicKey": pubkey_hex,
        "iat": now,
        "exp": now + _TOKEN_LIFETIME,
        "aud": audience,
        "owner": pubkey_hex,
        "client": _get_client_version(),
    }
    if email:
        payload["email"] = email

    header_b64 = _base64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _base64url_encode(json.dumps(payload, separators=(",", ":")).encode())

    signing_input = f"{header_b64}.{payload_b64}".encode()

    scalar = private_key[:32]
    prefix = private_key[32:]
    signature = ed25519_sign_expanded(signing_input, scalar, prefix, public_key)

    return f"{header_b64}.{payload_b64}.{signature.hex()}"


def _decode_packet_fields(raw_bytes: bytes) -> tuple[str, str, str, list[str], int | None]:
    """Decode packet fields used by the community uploader payload format.

    Returns:
        (route_letter, packet_type_str, payload_len_str, path_values, payload_type_int)
    """
    # Reference defaults when decode fails
    route = "U"
    packet_type = "0"
    payload_len = "0"
    path_values: list[str] = []
    payload_type: int | None = None

    try:
        envelope = parse_packet_envelope(raw_bytes)
        if envelope is None or envelope.payload_version != 0:
            return route, packet_type, payload_len, path_values, payload_type

        payload_type = envelope.payload_type
        route = _ROUTE_MAP.get(envelope.route_type, "U")
        packet_type = str(payload_type)
        payload_len = str(len(envelope.payload))
        path_values = split_path_hex(envelope.path.hex(), envelope.hop_count)

        return route, packet_type, payload_len, path_values, payload_type
    except Exception:
        return route, packet_type, payload_len, path_values, payload_type


def _format_raw_packet(data: dict[str, Any], device_name: str, public_key_hex: str) -> dict | None:
    """Convert a RawPacketBroadcast dict to meshcore-packet-capture format.

    Returns ``None`` when the packet cannot be decoded - callers should skip
    publishing rather than forwarding malformed data.
    """
    raw_hex = data.get("data", "")
    raw_bytes = bytes.fromhex(raw_hex) if raw_hex else b""

    route, packet_type, payload_len, path_values, _payload_type = _decode_packet_fields(raw_bytes)

    if route == "U":
        return None

    # Community observers clamp zone-less local timestamps; publish explicit UTC.
    current_time = datetime.now(UTC)
    ts_str = _format_utc_timestamp(current_time)

    # Keep numeric telemetry numeric so downstream analyzers can ingest it.
    # Preserve the existing "Unknown" fallback for missing values.
    snr_val = data.get("snr")
    rssi_val = data.get("rssi")
    snr: float | str = float(snr_val) if snr_val is not None else "Unknown"
    rssi: int | str = int(rssi_val) if rssi_val is not None else "Unknown"

    packet_hash = calculate_packet_hash(raw_bytes)

    packet = {
        "origin": device_name or "MeshCore Device",
        "origin_id": public_key_hex.upper(),
        "timestamp": ts_str,
        "type": "PACKET",
        "direction": "rx",
        "time": current_time.strftime("%H:%M:%S"),
        "date": current_time.strftime("%d/%m/%Y"),
        "len": str(len(raw_bytes)),
        "packet_type": packet_type,
        "route": route,
        "payload_len": payload_len,
        "raw": raw_hex.upper(),
        "SNR": snr,
        "RSSI": rssi,
        "hash": packet_hash,
    }

    if route == "D":
        packet["path"] = ",".join(path_values)

    return packet


# Maps RTFM-EV's internal repeater-telemetry field names (see
# ``radio_sync._collect_repeater_telemetry``) to the observer feed's ``stats``
# key names, so the analyzer can reuse its status extractor keyed on the subject
# node. ``(source_field, transform)`` - transform is applied when not None.
_NODE_TELEMETRY_STATS_MAP: dict[str, tuple[str, Any]] = {
    "battery_mv": ("battery_volts", lambda v: round(v * 1000)),
    "uptime_secs": ("uptime_seconds", None),
    "packets_sent": ("packets_sent", None),
    "packets_received": ("packets_received", None),
    "noise_floor": ("noise_floor_dbm", None),
    "tx_air_secs": ("airtime_seconds", None),
    "rx_air_secs": ("rx_airtime_seconds", None),
    "recv_errors": ("recv_errors", None),
    "queue_len": ("tx_queue_len", None),
}


def _format_node_telemetry(
    data: dict[str, Any], device_name: str, public_key_hex: str
) -> dict | None:
    """Format a forwarded remote-node telemetry snapshot for the observer feed.

    ``data`` is a ``broadcast_telemetry`` payload: the remote node R's telemetry
    plus ``public_key``/``name``/``timestamp``. ``origin_id`` stays the local
    publisher (self, ``public_key_hex``) so the broker's publisher==origin rule
    is satisfied untouched; the heard node R is carried in ``subject_id``.

    Returns ``None`` when the subject node is unknown (nothing to attribute).
    """
    subject_id = data.get("public_key")
    if not subject_id:
        return None

    stats: dict[str, Any] = {}
    for out_key, (src_key, transform) in _NODE_TELEMETRY_STATS_MAP.items():
        if src_key not in data:
            continue
        value = data[src_key]
        if value is None:
            continue
        stats[out_key] = transform(value) if transform is not None else value

    ts = data.get("timestamp")
    dt = datetime.fromtimestamp(ts, UTC) if isinstance(ts, (int, float)) else datetime.now(UTC)

    payload: dict[str, Any] = {
        "origin": device_name or "MeshCore Device",
        "origin_id": public_key_hex.upper(),
        "timestamp": _format_utc_timestamp(dt),
        "type": "TELEMETRY",
        "subject_id": str(subject_id).upper(),
        "subject_name": data.get("name"),
    }
    if stats:
        payload["stats"] = stats
    lpp = data.get("lpp_sensors")
    if lpp:
        payload["lpp"] = lpp
    return payload


def _format_node_neighbors(
    data: dict[str, Any], device_name: str, public_key_hex: str
) -> dict | None:
    """Format a forwarded remote-repeater neighbor table for the observer feed.

    ``data`` is a ``broadcast_neighbor`` payload: repeater R's neighbor entries
    (``NeighborInfo`` shape) plus ``public_key``/``name``/``timestamp``/
    ``reported_count``. As with telemetry, ``origin_id`` is the local publisher
    (self) and the subject repeater R is carried in ``subject_id`` - the analyzer
    edge is R <-> neighbor, never self <-> neighbor.

    Returns ``None`` when the subject repeater is unknown.
    """
    subject_id = data.get("public_key")
    if not subject_id:
        return None

    neighbors = [
        {
            "pubkey": entry.get("pubkey_prefix", ""),
            "name": entry.get("name"),
            "snr": entry.get("snr"),
            "heard_secs_ago": entry.get("last_heard_seconds"),
        }
        for entry in data.get("neighbors", [])
    ]

    ts = data.get("timestamp")
    dt = datetime.fromtimestamp(ts, UTC) if isinstance(ts, (int, float)) else datetime.now(UTC)

    return {
        "origin": device_name or "MeshCore Device",
        "origin_id": public_key_hex.upper(),
        "timestamp": _format_utc_timestamp(dt),
        "type": "NEIGHBORS",
        "subject_id": str(subject_id).upper(),
        "subject_name": data.get("name"),
        "reported_count": data.get("reported_count"),
        "neighbors": neighbors,
    }


def _format_node_regions(
    data: dict[str, Any], device_name: str, public_key_hex: str
) -> dict | None:
    """Format a forwarded remote-repeater region table for the observer feed.

    ``data`` is a ``broadcast_region`` payload: repeater R's region hierarchy
    (``RepeaterRegionEntry`` shape: name/depth/flood_allowed/is_home) plus
    ``public_key``/``name``/``timestamp`` and optional ``source``/``truncated``.
    ``origin_id`` is the local publisher (self); the subject repeater R is in
    ``subject_id``.

    Returns ``None`` when the subject repeater is unknown.
    """
    subject_id = data.get("public_key")
    if not subject_id:
        return None

    regions = [
        {
            "name": entry.get("name"),
            "depth": entry.get("depth"),
            "flood_allowed": entry.get("flood_allowed"),
            "is_home": entry.get("is_home"),
        }
        for entry in data.get("regions", [])
    ]

    ts = data.get("timestamp")
    dt = datetime.fromtimestamp(ts, UTC) if isinstance(ts, (int, float)) else datetime.now(UTC)

    payload: dict[str, Any] = {
        "origin": device_name or "MeshCore Device",
        "origin_id": public_key_hex.upper(),
        "timestamp": _format_utc_timestamp(dt),
        "type": "REGIONS",
        "subject_id": str(subject_id).upper(),
        "subject_name": data.get("name"),
        "regions": regions,
    }
    if "source" in data:
        payload["source"] = data.get("source")
    if "truncated" in data:
        payload["truncated"] = data.get("truncated")
    return payload


def _format_node_config(
    *,
    device_name: str,
    public_key_hex: str,
    self_info: dict[str, Any] | None,
    device_info: dict[str, Any] | None,
    stats: dict[str, Any] | None,
    host_repeater_settings: Any | None,
    host_repeater_state: str | None,
    flood_scope: str | None,
    fanout_config: dict[str, Any],
) -> dict[str, Any]:
    """Build the ``config`` topic payload: this node's non-sensitive configuration.

    Mirrors the DMC observer firmware's ``config`` topic (type 5,
    ``MQTTMessageBuilder::buildConfigMessage`` / ``MyMesh::publishConfigIfDue``)
    for the sections a companion-driven host can fill: identity, ``radio``,
    ``repeat``, ``region_gate``, ``region`` (scope tree) and ``mqtt`` toggles.
    Firmware-only sections (bridge, gps, power, room, timezone, alert, snmp)
    are omitted rather than published empty. ``repeat`` / ``region_gate`` /
    ``region.scopes`` come from the host repeater settings (RTFM-EV's own
    repeater role); ``region.default`` is the app's outbound flood scope. No
    broker host, credentials or keys are ever included.
    """
    payload: dict[str, Any] = {
        "timestamp": _format_utc_timestamp(),
        "origin": device_name or "MeshCore Device",
        "origin_id": public_key_hex.upper(),
        "client_version": _get_client_version(),
        "boot_id": _boot_id(_PROCESS_START),
    }
    if device_info:
        payload["model"] = device_info.get("model", "unknown")
        payload["firmware_version"] = device_info.get("firmware_version", "unknown")
    uptime = (stats or {}).get("uptime_secs")
    if isinstance(uptime, int):
        payload["uptime_secs"] = uptime
    if device_name:
        payload["node_name"] = device_name

    info = self_info or {}
    radio: dict[str, Any] = {}
    for src, dst in (
        ("radio_freq", "freq"),
        ("radio_bw", "bw"),
        ("radio_sf", "sf"),
        ("radio_cr", "cr"),
        ("tx_power", "tx_power"),
        ("max_tx_power", "max_tx_power"),
        ("multi_acks", "multi_acks"),
    ):
        value = info.get(src)
        if isinstance(value, (int, float)):
            radio[dst] = value
    if radio:
        payload["radio"] = radio

    hr = host_repeater_settings
    if hr is not None:
        # The host repeater's timing knobs (fw rx_delay / tx_delay_factor / direct_tx_delay_factor).
        radio = payload.setdefault("radio", {})
        radio["rx_delay"] = hr.rx_delay_base
        radio["tx_delay_factor"] = hr.tx_delay_factor
        radio["direct_tx_delay_factor"] = hr.direct_tx_delay_factor
        armed = host_repeater_state == "armed"
        payload["repeat"] = {
            "disable_fwd": not armed,
            "flood_max": hr.flood_max,
            "flood_max_unscoped": hr.flood_max_unscoped,
            "flood_max_advert": hr.flood_max_advert,
            "loop_detect": hr.loop_detect,
        }
        payload["region_gate"] = {
            "enabled": bool(hr.dc_gate_enabled),
            "threshold": hr.dc_gate_threshold,
            "hysteresis": hr.dc_gate_hysteresis,
        }
        region: dict[str, Any] = {"wildcard_flood": bool(hr.unscoped_flood_allow)}
        if hr.home_region:
            region["home"] = hr.home_region
        scopes = [
            {
                "name": entry.name,
                "flood": not entry.deny_flood,
                "parent": entry.parent or "*",
            }
            for entry in hr.regions
        ]
        region["scopes"] = scopes
        payload["region"] = region
        payload["host_repeater"] = {"state": host_repeater_state or "off"}
    if flood_scope:
        payload.setdefault("region", {})["default"] = flood_scope

    payload["mqtt"] = {
        "status": bool(fanout_config.get("publish_status", True)),
        "packets": bool(fanout_config.get("publish_packets", True)),
        "telemetry": bool(fanout_config.get("publish_telemetry", False)),
        "neighbors": bool(fanout_config.get("publish_neighbors", False)),
        "regions": bool(fanout_config.get("publish_regions", False)),
        "config": True,
        "status_interval": _clamp_status_interval_ms(
            fanout_config.get("status_interval_ms", _STATUS_INTERVAL_DEFAULT_MS)
        ),
        # fw: 0 = the filter topic is off.
        "filter_interval": _clamp_filter_interval_ms(
            fanout_config.get("filter_interval_ms", _FILTER_INTERVAL_DEFAULT_MS)
        )
        if fanout_config.get("publish_filter", False)
        else 0,
        "own_neighbors": bool(fanout_config.get("publish_own_neighbors", False)),
    }
    if hr is not None and hr.neighbor_poll_enabled:
        payload["mqtt"]["neighbors_interval"] = hr.neighbor_poll_interval_hours * 3_600_000
    iata = str(fanout_config.get("iata", "")).upper().strip()
    if iata:
        payload["mqtt"]["iata"] = iata
    return payload


def _type_key(name: str) -> str:
    """Payload type name -> the firmware's two-digit type id (``%02d``)."""
    from app.services.host_repeater_settings import PAYLOAD_TYPE_BY_NAME

    code = PAYLOAD_TYPE_BY_NAME.get(name)
    return f"{code:02d}" if code is not None else name


def _boot_id(since: float) -> int:
    """Per-counter-run id (fw seeds it from the boot clock, ``& 0xFFFF | 1``).

    Our counters start with the host repeater stats, so a stats reset is a new "boot".
    """
    return (int(since) & 0xFFFF) | 1


def _format_filter_stats(
    *,
    device_name: str,
    public_key_hex: str,
    host_repeater_state: str,
    since: float,
    filter_snapshot: dict[str, Any],
    region_gate: dict[str, Any],
    now: float | None = None,
) -> dict[str, Any]:
    """Build the DMC observer ``filter`` topic payload (``MQTTFilterStatsJson::fill``).

    The counters are the host repeater's DMC filter statistics. ``dryrun`` is true
    whenever nothing is really dropped: the filter dry-run setting, or the host
    repeater not being armed (shadow judges but never forwards). ``host_repeater``
    is an RTFM-EV addition that says which.
    """
    wall = now if now is not None else time.time()
    f = filter_snapshot
    armed = host_repeater_state == "armed"
    payload: dict[str, Any] = {
        "timestamp": _format_utc_timestamp(datetime.fromtimestamp(wall, UTC)),
        "origin": device_name or "MeshCore Device",
        "origin_id": public_key_hex.upper(),
        "uptime_secs": max(0, int(wall - since)),
        "boot_id": _boot_id(since),
        "enabled": bool(f.get("enabled")),
        "dryrun": bool(f.get("dryrun")) or not armed,
        "totals": dict(f.get("totals") or {}),
        "air_ms": int(f.get("air_ms") or 0),
        "hops": {_type_key(k): v for k, v in (f.get("hops") or {}).items() if v},
        "rate": {_type_key(k): v for k, v in (f.get("rate") or {}).items() if v},
    }
    hash_info = f.get("hash") or {}
    sizes = dict(hash_info.get("size") or {})
    if not sizes.get("4B"):
        sizes.pop("4B", None)
    hash_out: dict[str, Any] = {"size": sizes}
    top_types = hash_info.get("top_types") or {}
    if top_types:
        hash_out["top_types"] = {_type_key(k): v for k, v in top_types.items()}
    payload["hash"] = hash_out
    payload["malformed"] = dict(f.get("malformed") or {})
    if f.get("channels"):
        payload["channels"] = list(f["channels"])
    if f.get("top_sources"):
        payload["top_sources"] = list(f["top_sources"])
    payload["advert"] = dict(f.get("advert") or {})
    payload["age"] = dict(f.get("age") or {})
    for key in ("paths", "senders", "texts", "watch"):
        if f.get(key):
            payload[key] = list(f[key])
    payload["config"] = {_type_key(k): v for k, v in (f.get("config") or {}).items()}
    duty = region_gate.get("budget_used_percent")
    payload["region_gate"] = {
        "enabled": bool(region_gate.get("enabled")),
        "duty": int(duty) if isinstance(duty, (int, float)) else 0,
        "level": int(region_gate.get("level") or 0),
        "max_level": int(region_gate.get("max_level") or 0),
        "threshold": region_gate.get("threshold"),
        "hysteresis": region_gate.get("hysteresis"),
    }
    payload["host_repeater"] = {"state": host_repeater_state}
    return payload


def _host_repeater_scopes(host_repeater_settings: Any | None) -> str:
    """``getLocalScopes``: flood-allowed names (``exportNamesTo(REGION_DENY_FLOOD)``)."""
    if host_repeater_settings is None:
        return ""
    names = ["*"] if host_repeater_settings.unscoped_flood_allow else []
    names += [r.name for r in host_repeater_settings.regions if not r.deny_flood]
    return ",".join(names)


def _format_own_neighbors(
    *,
    device_name: str,
    public_key_hex: str,
    table: dict[str, Any],
    self_scopes: str,
    default_scope: str | None,
) -> dict[str, Any]:
    """Build the DMC observer ``neighbors`` topic payload for this node's own table.

    Mirrors ``MQTTPayloadBuilder::buildNeighborsMessage`` after a completed poll:
    progress metadata, ``self`` scopes and one entry per neighbour, newest first.
    Unlike the forwarded ``node_neighbors`` kind there is no ``subject_id``: the
    subject is the publisher itself.
    """
    neighbors = table.get("neighbors") or []
    poll = table.get("poll") or {}
    default = (default_scope or "").strip().removeprefix("#") or "*"
    return {
        "timestamp": _format_utc_timestamp(),
        "origin": device_name or "MeshCore Device",
        "origin_id": public_key_hex.upper(),
        "total_neighbors": len(neighbors),
        "queried_neighbors": int(poll.get("queried") or 0),
        "truncated": False,
        "self": {"scopes": self_scopes, "default_scope": default},
        "neighbors": [
            {
                "pubkey": str(entry.get("pubkey", "")).upper(),
                "snr": entry.get("snr"),
                "heard_secs_ago": entry.get("heard_secs_ago"),
                "scopes": entry.get("scopes") or "",
                # fw maps anything not answered or failed to "timeout".
                "status": entry.get("status")
                if entry.get("status") in ("responded", "send_failed")
                else "timeout",
            }
            for entry in neighbors
        ],
    }


def _build_config_topic(settings: CommunityMqttSettings, pubkey_hex: str) -> str:
    """Build the ``meshcore/{IATA}/{PUBKEY}/config`` topic string."""
    iata = settings.community_mqtt_iata.upper().strip()
    return f"meshcore/{iata}/{pubkey_hex}/config"


def _build_status_topic(settings: CommunityMqttSettings, pubkey_hex: str) -> str:
    """Build the ``meshcore/{IATA}/{PUBKEY}/status`` topic string."""
    iata = settings.community_mqtt_iata.upper().strip()
    return f"meshcore/{iata}/{pubkey_hex}/status"


def _build_node_topic(settings: CommunityMqttSettings, pubkey_hex: str, kind: str) -> str:
    """Build ``meshcore/{IATA}/{PUBKEY}/{kind}`` (``filter``, ``neighbors``)."""
    iata = settings.community_mqtt_iata.upper().strip()
    return f"meshcore/{iata}/{pubkey_hex}/{kind}"


def _build_radio_info() -> str:
    """Format the radio parameters string from self_info.

    Matches the reference format: ``"freq,bw,sf,cr"`` (comma-separated raw
    values).  Falls back to ``"0,0,0,0"`` when unavailable.
    """
    from app.services.radio_runtime import radio_runtime as radio_manager

    try:
        if radio_manager.meshcore and radio_manager.meshcore.self_info:
            info = radio_manager.meshcore.self_info
            freq = info.get("radio_freq", 0)
            bw = info.get("radio_bw", 0)
            sf = info.get("radio_sf", 0)
            cr = info.get("radio_cr", 0)
            return f"{freq},{bw},{sf},{cr}"
    except Exception:
        pass
    return "0,0,0,0"


def _get_client_version() -> str:
    """Return the canonical client/version identifier for community MQTT."""
    build = get_app_build_info()
    commit_hash = build.commit_hash or "unknown"
    return f"{_CLIENT_ID}/{build.version}-{commit_hash}"


class CommunityMqttPublisher(BaseMqttPublisher):
    """Manages the community MQTT connection and publishes raw packets."""

    _backoff_max = 3600
    _log_prefix = "Community MQTT"
    _not_configured_timeout: float | None = 30

    def __init__(self) -> None:
        super().__init__()
        self._key_unavailable_warned: bool = False
        self._cached_device_info: dict[str, str] | None = None
        self._cached_stats: dict[str, Any] | None = None
        self._stats_supported: bool | None = None
        self._last_stats_fetch: float = 0.0
        self._last_status_publish: float = 0.0
        self._last_filter_publish: float = 0.0
        self._own_neighbors_published: int | None = None

    async def start(self, settings: object) -> None:
        self._key_unavailable_warned = False
        self._cached_device_info = None
        self._cached_stats = None
        self._stats_supported = None
        self._last_stats_fetch = 0.0
        self._last_status_publish = 0.0
        self._last_filter_publish = 0.0
        self._own_neighbors_published = None
        await super().start(settings)

    def _on_not_configured(self) -> None:
        from app.keystore import get_public_key, has_private_key
        from app.websocket import broadcast_error

        s: CommunityMqttSettings | None = self._settings
        auth_mode = getattr(s, "community_mqtt_auth_mode", "token") if s else "token"
        if (
            s
            and auth_mode == "token"
            and get_public_key() is not None
            and not has_private_key()
            and not self._key_unavailable_warned
        ):
            broadcast_error(
                "Community MQTT unavailable",
                "Radio firmware does not support private key export.",
            )
            self._key_unavailable_warned = True

    def _is_configured(self) -> bool:
        """Check if community MQTT is enabled and keys are available."""
        from app.keystore import get_public_key, has_private_key

        s: CommunityMqttSettings | None = self._settings
        if not s or not s.community_mqtt_enabled:
            return False
        if get_public_key() is None:
            return False
        auth_mode = getattr(s, "community_mqtt_auth_mode", "token")
        if auth_mode == "token":
            return has_private_key()
        return True

    def _build_client_kwargs(self, settings: object) -> dict[str, Any]:
        s: CommunityMqttSettings = settings  # type: ignore[assignment]
        from app.keystore import get_private_key, get_public_key
        from app.services.radio_runtime import radio_runtime as radio_manager

        private_key = get_private_key()
        public_key = get_public_key()
        assert public_key is not None  # guaranteed by _pre_connect

        pubkey_hex = public_key.hex().upper()
        broker_host = s.community_mqtt_broker_host or _DEFAULT_BROKER
        broker_port = s.community_mqtt_broker_port or _DEFAULT_PORT
        transport = s.community_mqtt_transport or "websockets"
        use_tls = bool(s.community_mqtt_use_tls)
        tls_verify = bool(s.community_mqtt_tls_verify)
        auth_mode = s.community_mqtt_auth_mode or "token"
        secure_connection = use_tls and tls_verify

        tls_context: ssl.SSLContext | None = None
        if use_tls:
            tls_context = ssl.create_default_context()
            if not tls_verify:
                tls_context.check_hostname = False
                tls_context.verify_mode = ssl.CERT_NONE

        device_name = ""
        if radio_manager.meshcore and radio_manager.meshcore.self_info:
            device_name = radio_manager.meshcore.self_info.get("name", "")

        status_topic = _build_status_topic(s, pubkey_hex)
        offline_payload = json.dumps(
            {
                "status": "offline",
                "timestamp": _format_utc_timestamp(),
                "origin": device_name or "MeshCore Device",
                "origin_id": pubkey_hex,
            }
        )

        kwargs: dict[str, Any] = {
            "hostname": broker_host,
            "port": broker_port,
            "transport": transport,
            "tls_context": tls_context,
            "will": aiomqtt.Will(status_topic, offline_payload, retain=True),
        }
        if auth_mode == "token":
            assert private_key is not None
            token_audience = (s.community_mqtt_token_audience or "").strip() or broker_host
            jwt_token = _generate_jwt_token(
                private_key,
                public_key,
                audience=token_audience,
                email=(s.community_mqtt_email or "") if secure_connection else "",
            )
            kwargs["username"] = f"v1_{pubkey_hex}"
            kwargs["password"] = jwt_token
        elif auth_mode == "password":
            username = s.community_mqtt_username or None
            if username == "{pubkey}":
                # MeshCore presets (e.g. mesh-chaun14) use the radio public key
                # hex as the MQTT username; firmware sends its _device_id here.
                username = public_key.hex()
            kwargs["username"] = username
            kwargs["password"] = s.community_mqtt_password or None
        if transport == "websockets":
            kwargs["websocket_path"] = (s.community_mqtt_websocket_path or "").strip() or "/"
        return kwargs

    def _on_connected(self, settings: object) -> tuple[str, str]:
        s: CommunityMqttSettings = settings  # type: ignore[assignment]
        broker_host = s.community_mqtt_broker_host or _DEFAULT_BROKER
        broker_port = s.community_mqtt_broker_port or _DEFAULT_PORT
        return ("Community MQTT connected", f"{broker_host}:{broker_port}")

    async def _fetch_device_info(self) -> dict[str, str]:
        """Fetch firmware model/version from the radio (cached for the connection)."""
        if self._cached_device_info is not None:
            return self._cached_device_info

        from app.radio import RadioDisconnectedError, RadioOperationBusyError
        from app.services.radio_runtime import radio_runtime as radio_manager

        fallback = {"model": "unknown", "firmware_version": "unknown"}
        try:
            async with radio_manager.radio_operation(
                "community_stats_device_info", blocking=False
            ) as mc:
                event = await mc.commands.send_device_query()
                from meshcore.events import EventType

                if event.type == EventType.DEVICE_INFO:
                    fw_ver = event.payload.get("fw ver", 0)
                    if fw_ver >= 3:
                        model = event.payload.get("model", "unknown") or "unknown"
                        ver = event.payload.get("ver", "unknown") or "unknown"
                        fw_build = event.payload.get("fw_build", "") or ""
                        fw_str = f"v{ver} (Build: {fw_build})" if fw_build else f"v{ver}"
                        self._cached_device_info = {
                            "model": model,
                            "firmware_version": fw_str,
                        }
                    else:
                        # Old firmware - cache what we can
                        self._cached_device_info = {
                            "model": "unknown",
                            "firmware_version": f"v{fw_ver}" if fw_ver else "unknown",
                        }
                    return self._cached_device_info
        except (RadioOperationBusyError, RadioDisconnectedError):
            pass
        except Exception as e:
            logger.debug("Community MQTT: device info fetch failed: %s", e)

        # Don't cache transient failures - allow retry on next status publish
        return fallback

    async def _fetch_stats(self) -> dict[str, Any] | None:
        """Fetch core + radio stats from the radio (best-effort, cached)."""
        if self._stats_supported is False:
            return self._cached_stats

        now = time.monotonic()
        if (
            now - self._last_stats_fetch
        ) < _STATS_MIN_CACHE_SECS and self._cached_stats is not None:
            return self._cached_stats

        from app.radio import RadioDisconnectedError, RadioOperationBusyError
        from app.services.radio_runtime import radio_runtime as radio_manager

        try:
            async with radio_manager.radio_operation("community_stats_fetch", blocking=False) as mc:
                from meshcore.events import EventType

                result: dict[str, Any] = {}

                core_event = await mc.commands.get_stats_core()
                if core_event.type == EventType.ERROR:
                    logger.info("Community MQTT: firmware does not support stats commands")
                    self._stats_supported = False
                    return self._cached_stats
                if core_event.type == EventType.STATS_CORE:
                    result.update(core_event.payload)

                radio_event = await mc.commands.get_stats_radio()
                if radio_event.type == EventType.ERROR:
                    logger.info("Community MQTT: firmware does not support stats commands")
                    self._stats_supported = False
                    return self._cached_stats
                if radio_event.type == EventType.STATS_RADIO:
                    result.update(radio_event.payload)

                if result:
                    self._cached_stats = result
                    self._last_stats_fetch = now
                    return self._cached_stats

        except (RadioOperationBusyError, RadioDisconnectedError):
            pass
        except Exception as e:
            logger.debug("Community MQTT: stats fetch failed: %s", e)

        return self._cached_stats

    async def _publish_status(
        self, settings: CommunityMqttSettings, *, refresh_stats: bool = True
    ) -> None:
        """Build and publish the enriched retained status message."""
        if not getattr(settings, "community_mqtt_publish_status", True):
            return

        from app.keystore import get_public_key
        from app.services.radio_runtime import radio_runtime as radio_manager

        public_key = get_public_key()
        if public_key is None:
            return

        pubkey_hex = public_key.hex().upper()

        device_name = ""
        if radio_manager.meshcore and radio_manager.meshcore.self_info:
            device_name = radio_manager.meshcore.self_info.get("name", "")

        # Prefer the always-fresh radio_manager fields (populated on every reconnect by
        # radio_lifecycle) over the per-module _cached_device_info, which was only
        # cleared on module restart and therefore served stale firmware versions after
        # a radio firmware update.  Fall back to _fetch_device_info() for older firmware
        # where device_info_loaded is False.
        if radio_manager.device_info_loaded:
            raw_ver = radio_manager.firmware_version or "unknown"
            fw_build = radio_manager.firmware_build or ""
            fw_str = f"{raw_ver} (Build: {fw_build})" if fw_build else f"{raw_ver}"
            device_info = {
                "model": radio_manager.device_model or "unknown",
                "firmware_version": fw_str,
            }
        else:
            device_info = await self._fetch_device_info()
        stats = await self._fetch_stats() if refresh_stats else self._cached_stats

        status_topic = _build_status_topic(settings, pubkey_hex)
        payload: dict[str, Any] = {
            "status": "online",
            "timestamp": _format_utc_timestamp(),
            "origin": device_name or "MeshCore Device",
            "origin_id": pubkey_hex,
            "model": device_info.get("model", "unknown"),
            "firmware_version": device_info.get("firmware_version", "unknown"),
            "radio": _build_radio_info(),
            "client_version": _get_client_version(),
        }
        if stats:
            payload["stats"] = stats

        await self.publish(status_topic, payload, retain=True)
        self._last_status_publish = time.monotonic()

    async def _publish_config(self, settings: CommunityMqttSettings) -> None:
        """Publish the retained node ``config`` snapshot (opt-in, DMC ``config`` topic)."""
        if not getattr(settings, "community_mqtt_publish_config", False):
            return

        from app.keystore import get_public_key
        from app.services.radio_runtime import radio_runtime as radio_manager

        public_key = get_public_key()
        if public_key is None:
            return
        pubkey_hex = public_key.hex().upper()

        self_info: dict[str, Any] | None = None
        device_name = ""
        if radio_manager.meshcore and radio_manager.meshcore.self_info:
            self_info = dict(radio_manager.meshcore.self_info)
            device_name = self_info.get("name", "")

        device_info: dict[str, Any] | None = None
        if radio_manager.device_info_loaded:
            raw_ver = radio_manager.firmware_version or "unknown"
            fw_build = radio_manager.firmware_build or ""
            device_info = {
                "model": radio_manager.device_model or "unknown",
                "firmware_version": f"{raw_ver} (Build: {fw_build})" if fw_build else raw_ver,
            }
        elif self._cached_device_info:
            device_info = self._cached_device_info

        host_settings: Any | None = None
        host_state: str | None = None
        try:
            from app.services.host_repeater import host_repeater

            host_settings = host_repeater.settings
            host_state = host_repeater.state
        except Exception:
            logger.debug("Community MQTT: host repeater settings unavailable", exc_info=True)

        flood_scope: str | None = None
        try:
            from app.repository import AppSettingsRepository

            flood_scope = (await AppSettingsRepository.get()).flood_scope or None
        except Exception:
            logger.debug("Community MQTT: app settings unavailable for config", exc_info=True)

        payload = _format_node_config(
            device_name=device_name,
            public_key_hex=pubkey_hex,
            self_info=self_info,
            device_info=device_info,
            stats=self._cached_stats,
            host_repeater_settings=host_settings,
            host_repeater_state=host_state,
            flood_scope=flood_scope,
            fanout_config=getattr(settings, "community_mqtt_fanout_config", None) or {},
        )
        await self.publish(_build_config_topic(settings, pubkey_hex), payload, retain=True)

    def _self_identity(self) -> tuple[str, str] | None:
        """(device name, upper-case public key hex) of the local radio, or None."""
        from app.keystore import get_public_key
        from app.services.radio_runtime import radio_runtime as radio_manager

        public_key = get_public_key()
        if public_key is None:
            return None
        name = ""
        if radio_manager.meshcore and radio_manager.meshcore.self_info:
            name = radio_manager.meshcore.self_info.get("name", "") or ""
        return name, public_key.hex().upper()

    async def _publish_filter(self, settings: CommunityMqttSettings) -> bool:
        """Publish the DMC ``filter`` topic (opt-in; only while the host repeater is active)."""
        if not getattr(settings, "community_mqtt_publish_filter", False):
            return False
        from app.services.host_repeater import host_repeater

        state = host_repeater.state
        if state not in _HOST_REPEATER_ACTIVE:
            return False
        identity = self._self_identity()
        if identity is None:
            return False
        device_name, pubkey_hex = identity
        wall = time.time()
        payload = _format_filter_stats(
            device_name=device_name,
            public_key_hex=pubkey_hex,
            host_repeater_state=state,
            since=host_repeater.stats.since,
            filter_snapshot=host_repeater.engine.filter_snapshot(wall),
            region_gate=host_repeater.engine.gate_snapshot(time.monotonic()),
            now=wall,
        )
        await self.publish(_build_node_topic(settings, pubkey_hex, "filter"), payload)
        self._last_filter_publish = time.monotonic()
        return True

    async def _publish_own_neighbors(self, settings: CommunityMqttSettings) -> bool:
        """Publish this node's ``neighbors`` topic once per completed neighbour poll."""
        if not getattr(settings, "community_mqtt_publish_own_neighbors", False):
            return False
        from app.services.host_repeater import host_repeater

        if host_repeater.state not in _HOST_REPEATER_ACTIVE:
            return False
        table = host_repeater.neighbors
        if table.poll.last_finished is None or table.version == self._own_neighbors_published:
            return False
        identity = self._self_identity()
        if identity is None:
            return False
        device_name, pubkey_hex = identity
        default_scope: str | None = None
        try:
            from app.repository import AppSettingsRepository

            default_scope = (await AppSettingsRepository.get()).flood_scope or None
        except Exception:
            logger.debug("Community MQTT: app settings unavailable for neighbors", exc_info=True)
        payload = _format_own_neighbors(
            device_name=device_name,
            public_key_hex=pubkey_hex,
            table=table.snapshot(),
            self_scopes=_host_repeater_scopes(host_repeater.settings),
            default_scope=default_scope,
        )
        await self.publish(_build_node_topic(settings, pubkey_hex, "neighbors"), payload)
        self._own_neighbors_published = table.version
        return True

    async def _on_connected_async(self, settings: object) -> None:
        """Publish the retained online status (and, opt-in, config / filter) after connecting."""
        await self._publish_status(settings)  # type: ignore[arg-type]
        await self._publish_config(settings)  # type: ignore[arg-type]
        await self._publish_filter(settings)  # type: ignore[arg-type]
        await self._publish_own_neighbors(settings)  # type: ignore[arg-type]

    async def _on_periodic_wake(self, elapsed: float) -> None:
        if not self._settings:
            return
        interval_ms = _clamp_status_interval_ms(
            getattr(
                self._settings, "community_mqtt_status_interval_ms", _STATUS_INTERVAL_DEFAULT_MS
            )
        )
        now = time.monotonic()
        if (now - self._last_status_publish) >= (interval_ms / 1000.0):
            await self._publish_status(self._settings, refresh_stats=True)
            # Config changes rarely; the firmware reuses its filter interval,
            # we reuse the status cadence.
            await self._publish_config(self._settings)
        filter_ms = _clamp_filter_interval_ms(
            getattr(self._settings, "community_mqtt_filter_interval_ms", None)
        )
        if now - self._last_filter_publish >= filter_ms / 1000.0 - _WAKE_SLACK_SECONDS:
            await self._publish_filter(self._settings)
        await self._publish_own_neighbors(self._settings)

    def _on_error(self) -> tuple[str, str]:
        return (
            "Community MQTT connection failure",
            "Check your internet connection or try again later.",
        )

    def _should_break_wait(self, elapsed: float) -> bool:
        if not self.connected:
            logger.info("Community MQTT publish failure detected, reconnecting")
            return True
        s: CommunityMqttSettings | None = self._settings
        auth_mode = getattr(s, "community_mqtt_auth_mode", "token") if s else "token"
        if auth_mode == "token" and elapsed >= _TOKEN_RENEWAL_THRESHOLD:
            logger.info("Community MQTT JWT nearing expiry, reconnecting")
            return True
        return False

    async def _pre_connect(self, settings: object) -> bool:
        from app.keystore import get_private_key, get_public_key

        s: CommunityMqttSettings = settings  # type: ignore[assignment]
        auth_mode = s.community_mqtt_auth_mode or "token"
        private_key = get_private_key()
        public_key = get_public_key()
        if public_key is None or (auth_mode == "token" and private_key is None):
            # Keys not available yet, wait for settings change or key export
            self.connected = False
            self._version_event.clear()
            try:
                await asyncio.wait_for(self._version_event.wait(), timeout=30)
            except TimeoutError:
                pass
            return False
        return True
