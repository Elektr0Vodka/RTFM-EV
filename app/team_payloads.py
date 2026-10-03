"""Recognize MeshCore TEAM payloads sent as ordinary channel text.

MeshCore TEAM (github.com/tmacinc/MeshCore-TEAM) and signalk-meshcore
(github.com/Banzarykey/signalk-meshcore) put tracking data on a channel as
prefixed text. Mirrored for the chat cards in
``frontend/src/utils/teamPayloads.ts``. Parsing covers every format below;
the only one built here for sending is ``#TEL:`` (``encode_telemetry``, used
by ``app/services/team_beacon_sender.py``). Formats, whole body each:

- ``#TEL:`` + Base64 of 11 bytes: lat and lon (int32 BE, degrees x 1e7), radio
  battery, phone battery, forwarding status. TEAM sends it unpadded,
  signalk-meshcore padded.
- ``#T:`` + Base64 of the same first 10 bytes, then a node count and a
  neighbour bitmap of ``ceil(count / 8)`` bytes. The bitmap indexes TEAM's own
  sorted peer list, so only the number of set bits is reported.
- ``#WAY:meshId|name|lat|lon|description|type|routeCoords[|n/N]`` (and the
  older ``#WAY:name|lat|lon|description|type``). A ``@C:AARRGGBB`` prefix on the
  description is the route colour. Route coordinates are ``lat,lon`` joined by
  ``~``; a long route continues in ``#WRC:meshId|routeCoords|n/N`` messages.
- ``#CAP:1:<flags>`` / ``#CAP:2:<flags>:<keyPrefix>:<appId>:<alias>`` capability
  adverts and ``#CAP:R:<keyPrefix>:<radioName>`` advert requests.

Battery bytes: 0 and 1 mean unknown, 2-254 are ``2750 + (b - 2) * 6`` mV. A
phone byte of 0xFF marks an autonomous radio (no phone attached).

signalk-meshcore reads the phone byte as a percentage and always sends
forwarding status 0. TEAM's encoder adds 1 to that byte, so it never sends 0;
a ``#TEL:`` with forwarding status 0 is therefore treated as signalk-meshcore.
"""

import base64
import binascii
import re
import struct
from dataclasses import dataclass
from typing import Literal

BeaconKind = Literal["tel", "topology"]
BeaconSource = Literal["team", "signalk"]

TEL_PREFIX = "#TEL:"
TOPOLOGY_PREFIX = "#T:"
WAYPOINT_PREFIX = "#WAY:"
ROUTE_PART_PREFIX = "#WRC:"
CAPABILITY_PREFIX = "#CAP:"
CAPABILITY_REQUEST_PREFIX = "#CAP:R:"

# Prefixes that can put something on the map (the beacons endpoint pre-filters on these).
MAP_PREFIXES = (TEL_PREFIX, TOPOLOGY_PREFIX, WAYPOINT_PREFIX, ROUTE_PART_PREFIX)

_TEL_SIZE = 11
_TOPOLOGY_HEADER_SIZE = 11
_BATTERY_MIN_MV = 2750
_BATTERY_STEP_MV = 6
_AUTONOMOUS = 0xFF
_MAX_ALIAS_BYTES = 24

_NUMBER = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")
_PART_INFO = re.compile(r"^(\d+)/(\d+)$")
_COLOR_PREFIX = re.compile(r"^@C:([0-9A-Fa-f]{8})")
_KEY_PREFIX = re.compile(r"^[0-9a-f]{12}$")
_APP_ID = re.compile(r"^[0-9a-f]{16}$")
_HEX = re.compile(r"^[0-9A-Fa-f]+$")
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(frozen=True)
class TeamBeacon:
    """A ``#TEL:`` or ``#T:`` position beacon. ``lat``/``lon`` are None without a usable fix."""

    kind: BeaconKind
    source: BeaconSource
    lat: float | None
    lon: float | None
    radio_battery_mv: int | None
    phone_battery_mv: int | None
    phone_battery_pct: int | None  # signalk-meshcore only
    autonomous: bool
    needs_forwarding: bool | None = None  # TEAM #TEL: only
    max_path_observed: int | None = None  # TEAM #TEL: only
    node_count: int | None = None  # #T: only
    neighbor_count: int | None = None  # #T: only


@dataclass(frozen=True)
class TeamWaypoint:
    """A ``#WAY:`` waypoint or route. ``route_chunk`` holds this message's route coordinates."""

    mesh_id: str | None
    name: str
    lat: float
    lon: float
    description: str
    waypoint_type: str
    color: str | None  # "#rrggbb"
    route_chunk: str = ""
    part_num: int | None = None
    total_parts: int | None = None


@dataclass(frozen=True)
class TeamRoutePart:
    """A ``#WRC:`` continuation of a multi-part route."""

    mesh_id: str
    route_chunk: str
    part_num: int
    total_parts: int


@dataclass(frozen=True)
class TeamCapability:
    """A ``#CAP:`` capability advert."""

    version: int
    flags: int
    radio_key_prefix: str | None = None
    app_id: str | None = None
    alias: str | None = None  # None for v1; "" means no alias set

    @property
    def custom_firmware(self) -> bool:
        return bool(self.flags & 0x01)

    @property
    def forwarding_capable(self) -> bool:
        return bool(self.flags & 0x02)

    @property
    def autonomous_capable(self) -> bool:
        return bool(self.flags & 0x04)

    @property
    def autonomous_enabled(self) -> bool:
        return bool(self.flags & 0x08)

    @property
    def smart_forwarding_active(self) -> bool:
        return bool(self.flags & 0x10)


@dataclass(frozen=True)
class TeamCapabilityRequest:
    """A ``#CAP:R:`` request for one node to advertise itself."""

    target_key_prefix: str | None
    target_radio_name: str


TeamPayload = TeamBeacon | TeamWaypoint | TeamRoutePart | TeamCapability | TeamCapabilityRequest


def _valid(lat: float, lon: float) -> bool:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    return not (lat == 0 and lon == 0)


def _decode_base64(payload: str) -> bytes | None:
    if not payload:
        return None
    padded = payload + "=" * (-len(payload) % 4)
    try:
        return base64.b64decode(padded, validate=True)
    except (binascii.Error, ValueError):
        return None


def _battery_mv(encoded: int) -> int | None:
    # 0xFF is outside TEAM's range (its encoder stops at 254); signalk-meshcore
    # clamps to it, so the real voltage is unknown.
    if encoded <= 1 or encoded == 0xFF:
        return None
    return _BATTERY_MIN_MV + (encoded - 2) * _BATTERY_STEP_MV


def _position(raw: bytes) -> tuple[float | None, float | None]:
    lat_int, lon_int = struct.unpack(">ii", raw[:8])
    lat, lon = lat_int / 1e7, lon_int / 1e7
    return (lat, lon) if _valid(lat, lon) else (None, None)


def _parse_telemetry(payload: str) -> TeamBeacon | None:
    raw = _decode_base64(payload)
    if raw is None or len(raw) != _TEL_SIZE:
        return None
    lat, lon = _position(raw)
    radio, phone, forwarding = raw[8], raw[9], raw[10]
    if forwarding == 0:
        return TeamBeacon(
            kind="tel",
            source="signalk",
            lat=lat,
            lon=lon,
            radio_battery_mv=_battery_mv(radio),
            phone_battery_mv=None,
            phone_battery_pct=phone if phone <= 100 else None,
            autonomous=False,
        )
    autonomous = phone == _AUTONOMOUS
    status = forwarding - 1
    return TeamBeacon(
        kind="tel",
        source="team",
        lat=lat,
        lon=lon,
        radio_battery_mv=_battery_mv(radio),
        phone_battery_mv=None if autonomous else _battery_mv(phone),
        phone_battery_pct=None,
        autonomous=autonomous,
        needs_forwarding=bool(status & 0x01),
        max_path_observed=(status >> 1) & 0x7F,
    )


def _parse_topology(payload: str) -> TeamBeacon | None:
    raw = _decode_base64(payload)
    if raw is None or len(raw) < _TOPOLOGY_HEADER_SIZE:
        return None
    node_count = raw[10]
    bitmap = raw[_TOPOLOGY_HEADER_SIZE : _TOPOLOGY_HEADER_SIZE + (node_count + 7) // 8]
    if len(bitmap) < (node_count + 7) // 8:
        return None
    lat, lon = _position(raw)
    phone = raw[9]
    autonomous = phone == _AUTONOMOUS
    neighbors = sum(1 for i in range(node_count) if bitmap[i // 8] & (1 << (i % 8)))
    return TeamBeacon(
        kind="topology",
        source="team",
        lat=lat,
        lon=lon,
        radio_battery_mv=_battery_mv(raw[8]),
        phone_battery_mv=None if autonomous else _battery_mv(phone),
        phone_battery_pct=None,
        autonomous=autonomous,
        node_count=node_count,
        neighbor_count=neighbors,
    )


def _coordinate(text: str) -> float | None:
    text = text.strip()
    return float(text) if _NUMBER.match(text) else None


def _split_color(description: str) -> tuple[str, str | None]:
    match = _COLOR_PREFIX.match(description)
    if match is None:
        return description, None
    return description[match.end() :], f"#{match.group(1)[2:].lower()}"


def _parse_waypoint(data: str) -> TeamWaypoint | None:
    parts = data.split("|")
    if len(parts) >= 6:
        mesh_id, name, lat_text, lon_text, raw_description, waypoint_type = parts[:6]
        route_chunk = parts[6] if len(parts) >= 7 else ""
        part_info = _PART_INFO.match(parts[7]) if len(parts) >= 8 else None
    elif len(parts) == 5:
        mesh_id, route_chunk, part_info = "", "", None
        name, lat_text, lon_text, raw_description, waypoint_type = parts
    else:
        return None
    lat, lon = _coordinate(lat_text), _coordinate(lon_text)
    if lat is None or lon is None or not _valid(lat, lon):
        return None
    description, color = _split_color(raw_description)
    return TeamWaypoint(
        mesh_id=mesh_id or None,
        name=name,
        lat=lat,
        lon=lon,
        description=description,
        waypoint_type=waypoint_type,
        color=color,
        route_chunk=route_chunk,
        part_num=int(part_info.group(1)) if part_info else None,
        total_parts=int(part_info.group(2)) if part_info else None,
    )


def _parse_route_part(data: str) -> TeamRoutePart | None:
    parts = data.split("|")
    if len(parts) < 3:
        return None
    part_info = _PART_INFO.match(parts[2])
    if part_info is None:
        return None
    return TeamRoutePart(
        mesh_id=parts[0],
        route_chunk=parts[1],
        part_num=int(part_info.group(1)),
        total_parts=int(part_info.group(2)),
    )


def _sanitize_alias(alias: str) -> str:
    cleaned = _CONTROL_CHARS.sub("", alias).strip()
    encoded = cleaned.encode("utf-8")
    if len(encoded) <= _MAX_ALIAS_BYTES:
        return cleaned
    return encoded[:_MAX_ALIAS_BYTES].decode("utf-8", errors="ignore").strip()


def _parse_capability_request(data: str) -> TeamCapabilityRequest | None:
    key_field, separator, name = data.partition(":")
    name = name.strip()
    if not separator or not name:
        return None
    key_field = key_field.lower()
    return TeamCapabilityRequest(
        target_key_prefix=key_field if _KEY_PREFIX.match(key_field) else None,
        target_radio_name=name,
    )


def _parse_capability(data: str) -> TeamCapability | None:
    parts = data.split(":")
    if len(parts) < 2 or not parts[0].isdigit() or not _HEX.match(parts[1]):
        return None
    version = int(parts[0])
    if version < 1:
        return None
    flags = int(parts[1], 16) & 0xFF
    if len(parts) == 2:
        return TeamCapability(version=version, flags=flags)
    key_field = parts[2].lower()
    # The alias is last and may contain ":". An early v2 sender put it straight
    # after the key prefix, without an app id.
    app_id: str | None = None
    alias_start = 3
    if len(parts) >= 5:
        app_field = parts[3].lower()
        if app_field == "-" or _APP_ID.match(app_field):
            app_id = None if app_field == "-" else app_field
            alias_start = 4
    return TeamCapability(
        version=version,
        flags=flags,
        radio_key_prefix=key_field if _KEY_PREFIX.match(key_field) else None,
        app_id=app_id,
        alias=_sanitize_alias(":".join(parts[alias_start:])),
    )


def parse_team_payload(body: str) -> TeamPayload | None:
    """The TEAM payload a message body is, or None. ``body`` excludes the channel sender prefix."""
    text = body.strip()
    if text.startswith(TEL_PREFIX):
        return _parse_telemetry(text[len(TEL_PREFIX) :])
    if text.startswith(TOPOLOGY_PREFIX):
        return _parse_topology(text[len(TOPOLOGY_PREFIX) :])
    if text.startswith(WAYPOINT_PREFIX):
        return _parse_waypoint(text[len(WAYPOINT_PREFIX) :])
    if text.startswith(ROUTE_PART_PREFIX):
        return _parse_route_part(text[len(ROUTE_PART_PREFIX) :])
    if text.startswith(CAPABILITY_REQUEST_PREFIX):
        return _parse_capability_request(text[len(CAPABILITY_REQUEST_PREFIX) :])
    if text.startswith(CAPABILITY_PREFIX):
        return _parse_capability(text[len(CAPABILITY_PREFIX) :])
    return None


def decode_route(encoded: str) -> list[tuple[float, float]]:
    """``lat,lon~lat,lon`` route coordinates as (lat, lon) points; bad entries are skipped."""
    points: list[tuple[float, float]] = []
    for chunk in encoded.split("~"):
        pair = chunk.split(",")
        if len(pair) != 2:
            continue
        lat, lon = _coordinate(pair[0]), _coordinate(pair[1])
        if lat is not None and lon is not None and _valid(lat, lon):
            points.append((lat, lon))
    return points


def _encode_battery(millivolts: int | None) -> int:
    """TEAM's battery byte: 1 for unknown, else 2-254 (clamped to its range)."""
    if not millivolts:
        return 1
    return max(2, min(254, (millivolts - _BATTERY_MIN_MV) // _BATTERY_STEP_MV + 2))


def encode_telemetry(lat: float, lon: float, radio_battery_mv: int | None = None) -> str:
    """A TEAM ``#TEL:`` beacon for a radio with no phone attached.

    Unpadded Base64, as TEAM sends it. The phone battery is "unknown" (1) and
    the forwarding status is 1: no forwarding needed, no path observed.
    """
    raw = struct.pack(">ii", round(lat * 1e7), round(lon * 1e7))
    raw += bytes([_encode_battery(radio_battery_mv), 1, 1])
    return TEL_PREFIX + base64.b64encode(raw).decode("ascii").rstrip("=")
