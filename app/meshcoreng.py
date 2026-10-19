"""Recognise MeshCoreNG's own payload types (github.com/MichTronics/MeshCoreNG).

MeshCoreNG defines two payload types upstream MeshCore does not:

- 0x0D LOCATION (``src/Packet.h``): the ``MCL1`` compact tracker report
  (``docs/payloads.md``), big-endian fields, 32 bytes plus a name of at most 24
  bytes. Legacy: current NG tracker builds send the same body as GRP_DATA
  ``data_type 0x0200``, but NG repeaters still forward 0x0D up to 2 hops.
- 0x0C ATLAS (``src/helpers/Atlas.cpp``): position / neighbours / path sample /
  stats, DIRECT zero hop. The encoders exist but nothing sends them yet
  (checked 2026-10-19), so this mostly guards against mislabelling.

Detection is strict on magic and lengths: both types are otherwise unassigned,
and corrupt RF captures land in them (see ``path_utils.bucket_region_scope``).
"""

from dataclasses import dataclass
from typing import Literal

from app.path_utils import ParsedPacketEnvelope, parse_packet_envelope

MESHCORENG_PAYLOAD_TYPE_NAME = "MESHCORENG"
# GRP_DATA data_type of MeshCoreNG tracker reports (src/helpers/TxtDataHelpers.h).
DATA_TYPE_MESHCORENG_TRACKER = 0x0200
ATLAS_PAYLOAD_TYPE = 0x0C
LOCATION_PAYLOAD_TYPE = 0x0D
_ROUTE_DIRECT = 0x02

MeshCoreNgKind = Literal["location", "atlas"]

_MCL1_MAGIC = b"MCL1"
_MCL1_HEADER_LEN = 32
_MCL1_MAX_NAME = 24
_ATLAS_MAX_NEIGHBOURS = 12
_ATLAS_MAX_PATH_HOPS = 24


def _is_mcl1(p: bytes) -> bool:
    if len(p) < _MCL1_HEADER_LEN or p[:4] != _MCL1_MAGIC or p[4] != 1:
        return False
    name_len = p[31]
    return name_len <= _MCL1_MAX_NAME and len(p) == _MCL1_HEADER_LEN + name_len


@dataclass(frozen=True)
class Mcl1Report:
    """One MeshCoreNG compact tracker report."""

    node_id: str  # first 4 bytes of the sender's public key, hex
    lat: float
    lon: float
    alt_m: int
    speed_cms: int
    heading_cdeg: int
    satellites: int
    battery_mv: int
    timestamp: int
    name: str


def decode_mcl1(p: bytes) -> Mcl1Report | None:
    """Decode an MCL1 body (0x0D payload or GRP_DATA 0x0200 blob); None if malformed."""
    if not _is_mcl1(p):
        return None
    return Mcl1Report(
        node_id=p[6:10].hex(),
        lat=int.from_bytes(p[10:14], "big", signed=True) / 1e6,
        lon=int.from_bytes(p[14:18], "big", signed=True) / 1e6,
        alt_m=int.from_bytes(p[18:20], "big", signed=True),
        speed_cms=int.from_bytes(p[20:22], "big"),
        heading_cdeg=int.from_bytes(p[22:24], "big"),
        satellites=p[24],
        battery_mv=int.from_bytes(p[25:27], "big"),
        timestamp=int.from_bytes(p[27:31], "big"),
        name=p[32:].decode("utf-8", errors="replace"),
    )


def _is_atlas(p: bytes) -> bool:
    if not p:
        return False
    sub, n = p[0], len(p)
    if sub == 1 and n >= 2:  # position: type, flags, lat, lon, ts, optional alt/speed/heading
        return n == 14 + 2 * bin(p[1] & 0x07).count("1")
    if sub == 2 and n >= 2:  # neighbours: type, count, count x 10 bytes
        return p[1] <= _ATLAS_MAX_NEIGHBOURS and n == 2 + 10 * p[1]
    if sub == 3 and n >= 10:  # path sample: type, src 4, dst 4, hops, hop bytes, has_latency, [4]
        hops = p[9]
        if hops > _ATLAS_MAX_PATH_HOPS or n < 11 + hops:
            return False
        has_latency = p[10 + hops]
        return has_latency in (0, 1) and n == 11 + hops + 4 * has_latency
    if sub == 4:  # dense stats: type + 8 x uint32
        return n == 33
    return False


def meshcoreng_kind(envelope: ParsedPacketEnvelope) -> MeshCoreNgKind | None:
    """Classify an already parsed envelope; None when it is not MeshCoreNG."""
    if envelope.payload_version != 0:
        return None
    if envelope.payload_type == LOCATION_PAYLOAD_TYPE and _is_mcl1(envelope.payload):
        return "location"
    if (
        envelope.payload_type == ATLAS_PAYLOAD_TYPE
        and envelope.route_type == _ROUTE_DIRECT
        and envelope.hop_count == 0
        and _is_atlas(envelope.payload)
    ):
        return "atlas"
    return None


def detect_meshcoreng(raw: bytes) -> MeshCoreNgKind | None:
    envelope = parse_packet_envelope(raw)
    return meshcoreng_kind(envelope) if envelope is not None else None
