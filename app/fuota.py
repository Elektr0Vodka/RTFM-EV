"""Recognise meshcore_fuota firmware-update packets.

Protocol source: https://marcelverdult.github.io/meshcore_fuota/ (draft dated
2026-10-18; the source code is not published yet). FUOTA uses MeshCore payload
type 0x0E (unassigned upstream), route DIRECT, no path. Payload byte 0 is the
message kind, byte 1 the sender's 1-byte public key prefix, bytes 2-5 the
campaign ID (first 4 bytes of SHA-256 of the manifest) for Offer, Request and
Data.

The page states no byte order. Multi-byte fields are read little-endian, which
is an assumption (nRF52 and MeshCore's memcpy convention). The split of the last
two bytes of Offer (pages + nonce) and Request (target + nonce) is unpublished,
so those stay raw in ``tail``. Detection is strict on lengths because the
protocol has no version field.
"""

from dataclasses import dataclass
from typing import Literal

from app.path_utils import parse_packet_envelope

FUOTA_PAYLOAD_TYPE = 0x0E
# Stored raw_packets.payload_type for recognised FUOTA packets.
FUOTA_PAYLOAD_TYPE_NAME = "FUOTA"
_ROUTE_DIRECT = 0x02

FuotaKind = Literal["offer", "request", "data", "retract"]

_OFFER_LEN = 30
_REQUEST_LEN = 12
_DATA_HEADER_LEN = 8
_DATA_MAX_LEN = 184
_RETRACT_LEN = 82


@dataclass(frozen=True)
class FuotaMessage:
    kind: FuotaKind
    sender: str
    campaign: str | None
    payload_len: int
    manifest_len: int | None = None
    patch_size: int | None = None
    target: int | None = None
    build: int | None = None
    source_prefix: str | None = None
    tail: str | None = None
    block: int | None = None
    missing_mask: int | None = None
    fragment: int | None = None
    data_len: int | None = None


def _u16(b: bytes) -> int:
    return int.from_bytes(b, "little")


def _u32(b: bytes) -> int:
    return int.from_bytes(b, "little")


def detect_fuota(raw: bytes) -> FuotaMessage | None:
    """Return the decoded FUOTA message, or None when the packet is not FUOTA."""
    envelope = parse_packet_envelope(raw)
    if (
        envelope is None
        or envelope.payload_version != 0
        or envelope.payload_type != FUOTA_PAYLOAD_TYPE
        or envelope.route_type != _ROUTE_DIRECT
        or envelope.hop_count != 0
    ):
        return None

    p = envelope.payload
    n = len(p)
    if n < 2:
        return None
    kind, sender = p[0], format(p[1], "02x")

    if kind == 1 and n == _OFFER_LEN:
        return FuotaMessage(
            kind="offer",
            sender=sender,
            campaign=p[2:6].hex(),
            payload_len=n,
            manifest_len=_u16(p[6:8]),
            patch_size=_u32(p[8:12]),
            target=_u32(p[12:16]),
            build=_u32(p[16:20]),
            source_prefix=p[20:28].hex(),
            tail=p[28:30].hex(),
        )
    if kind == 2 and n == _REQUEST_LEN:
        return FuotaMessage(
            kind="request",
            sender=sender,
            campaign=p[2:6].hex(),
            payload_len=n,
            block=_u16(p[6:8]),
            missing_mask=_u16(p[8:10]),
            tail=p[10:12].hex(),
        )
    if kind == 3 and _DATA_HEADER_LEN < n <= _DATA_MAX_LEN:
        return FuotaMessage(
            kind="data",
            sender=sender,
            campaign=p[2:6].hex(),
            payload_len=n,
            fragment=_u16(p[6:8]),
            data_len=n - _DATA_HEADER_LEN,
        )
    if kind == 4 and n == _RETRACT_LEN:
        return FuotaMessage(kind="retract", sender=sender, campaign=None, payload_len=n)
    return None
