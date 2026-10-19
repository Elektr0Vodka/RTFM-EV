"""Decode ATAK-over-MeshCore and MeshCore SAR tracker payloads.

Pure functions, no I/O. Two sources, formats read from their source code
(main branches, 2026-10-19), not from captured air traffic:

- TAK-MESHCORE (github.com/atakmaps/TAK-MESHCORE), an ATAK plugin. It sends
  GRP_DATA datagrams (data type 0xFF01) on a channel named ``ATAK_DATA``. Each
  datagram is UTF-8 text ``UVAX1|<msgId>|<seq>|<total>|<base64>``; the joined
  base64 parts are an AX.25 UI frame addressed to ``OPENRL`` whose info field
  is ``type(1) | len(2, BE) | value`` (position, chat, gzip CoT, ...). The info
  field can also be AES-GCM encrypted with a passphrase shared by the ATAK
  users; we can only recognise that, not read it.
- MeshCore SAR (github.com/dz0ny/meshcore-sar). Its fast position beacon is a
  16-byte GRP_DATA blob with data type 0xFFFF (MeshCore's ``DATA_TYPE_DEV``).
"""

import base64
import binascii
import struct
import xml.etree.ElementTree as ET
import zlib
from dataclasses import dataclass
from datetime import datetime

ATAK_CHANNEL_NAME = "ATAK_DATA"
# Published in the plugin source (BtConnectionManager.ATAK_CHANNEL_SECRET).
ATAK_CHANNEL_KEY_HEX = "A3741E6A529CCF31D04B89FE1763B82D"
DATA_TYPE_ATAK_AX25 = 0xFF01
DATA_TYPE_ATAK_RAW = 0xFF02
DATA_TYPE_DEV = 0xFFFF
ENVELOPE_PREFIX = "UVAX1|"
ATAK_DEST_CALLSIGN = "OPENRL"

TLV_COT = 0x01
TLV_CHAT = 0x02
TLV_GPS = 0x03
TLV_PING = 0x04
TLV_CHAT_ACK = 0x05
TLV_COT_FRAGMENT = 0x06
TLV_NET_CONFIG = 0x07
TLV_COT_ACK = 0x08

MAX_ENVELOPE_PARTS = 64
MAX_COT_XML_BYTES = 65536

_AX25_ADDR_LEN = 7
_AX25_CONTROL_UI = 0x03
_AX25_PID_NONE = 0xF0
_GPS_BODY_LEN = 22
_GPS_FLAG_BATTERY = 0x04
_CHAT_HEADER_LEN = 16
_ENCRYPTED_MIN_LEN = 1 + 16 + 12 + 16  # version, salt, nonce, GCM tag
_SAR_FAST_GPS_LEN = 16
_SAR_FAST_GPS_MAGIC = 0x47  # 'G'


@dataclass(frozen=True)
class EnvelopeChunk:
    msg_id: str
    seq: int
    total: int
    data: bytes


@dataclass(frozen=True)
class Ax25Frame:
    dest: str
    dest_ssid: int
    src: str
    src_ssid: int
    info: bytes


@dataclass(frozen=True)
class Tlv:
    type: int
    value: bytes


@dataclass(frozen=True)
class AtakGps:
    callsign: str
    full_callsign: str | None
    team: str | None
    lat: float
    lon: float
    alt_m: int
    speed_mps: float
    course_deg: float
    battery_pct: int | None


@dataclass(frozen=True)
class AtakChat:
    sender: str
    room: str
    msg_id: int
    text: str


@dataclass(frozen=True)
class CotFragment:
    frag_id: int
    seq: int
    total: int
    data: bytes


@dataclass(frozen=True)
class CotEvent:
    uid: str
    type: str
    lat: float | None
    lon: float | None
    callsign: str | None
    team: str | None
    remarks: str | None
    stale_at: int | None
    speed_mps: float | None
    course_deg: float | None


@dataclass(frozen=True)
class SarFastGps:
    sender_prefix: str
    lat: float
    lon: float
    speed_kmh: int


def _valid(lat: float, lon: float) -> bool:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    return not (lat == 0 and lon == 0)


def _ascii_field(raw: bytes) -> str:
    return raw.decode("ascii", errors="replace").replace("\x00", "").strip()


def parse_envelope(text: str) -> EnvelopeChunk | None:
    """The ``UVAX1|`` chunk ``text`` consists of, or None.

    The text must start with the prefix (surrounding whitespace aside), so a
    chat line that only quotes plugin output stays chat.
    """
    text = text.strip()
    if not text.startswith(ENVELOPE_PREFIX):
        return None
    parts = text[len(ENVELOPE_PREFIX) :].split("|", 3)
    if len(parts) != 4:
        return None
    msg_id, seq_text, total_text, encoded = parts
    if not msg_id or not seq_text.isdigit() or not total_text.isdigit():
        return None
    seq, total = int(seq_text), int(total_text)
    if not (1 <= seq <= total <= MAX_ENVELOPE_PARTS):
        return None
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return None
    if not data:
        return None
    return EnvelopeChunk(msg_id=msg_id, seq=seq, total=total, data=data)


# MeshCore node names are at most 32 bytes.
_MAX_SENDER_NAME = 32


def envelope_body(text: str) -> str | None:
    """The ``UVAX1|`` envelope a channel line carries, or None.

    Either the whole line is the envelope, or a ``Sender: `` prefix the decoder
    could not split off (names with ``[``, ``]`` or ``:``) comes first. A longer
    lead-in is someone quoting plugin output, which stays chat.
    """
    stripped = text.strip()
    if stripped.startswith(ENVELOPE_PREFIX):
        return stripped
    head, sep, rest = stripped.partition(": ")
    if sep and 0 < len(head) <= _MAX_SENDER_NAME and rest.startswith(ENVELOPE_PREFIX):
        return rest
    return None


def _ax25_address(raw: bytes) -> tuple[str, int]:
    callsign = bytes(b >> 1 for b in raw[:6]).decode("ascii", errors="replace").strip()
    return callsign, (raw[6] >> 1) & 0x0F


def decode_ax25(raw: bytes) -> Ax25Frame | None:
    """Decode an AX.25 UI frame (no flags, no FCS), or None."""
    offset = 0
    addresses: list[tuple[str, int]] = []
    while True:
        if offset + _AX25_ADDR_LEN > len(raw):
            return None
        chunk = raw[offset : offset + _AX25_ADDR_LEN]
        addresses.append(_ax25_address(chunk))
        offset += _AX25_ADDR_LEN
        if chunk[6] & 0x01:
            break
    if len(addresses) < 2 or offset + 2 > len(raw):
        return None
    if raw[offset] != _AX25_CONTROL_UI or raw[offset + 1] != _AX25_PID_NONE:
        return None
    (dest, dest_ssid), (src, src_ssid) = addresses[0], addresses[1]
    return Ax25Frame(
        dest=dest, dest_ssid=dest_ssid, src=src, src_ssid=src_ssid, info=bytes(raw[offset + 2 :])
    )


def decode_tlv(info: bytes) -> Tlv | None:
    """``type(1) | len(2, BE) | value``; the length must cover the rest exactly."""
    if len(info) < 3:
        return None
    length = struct.unpack_from(">H", info, 1)[0]
    if len(info) != 3 + length:
        return None
    return Tlv(type=info[0], value=bytes(info[3:]))


def looks_encrypted(info: bytes) -> bool:
    """True for the plugin's AES-GCM envelope (version byte 0x03, not a valid TLV)."""
    return len(info) >= _ENCRYPTED_MIN_LEN and info[0] == 0x03 and decode_tlv(info) is None


def decode_gps(value: bytes) -> AtakGps | None:
    """The 22-byte position body plus the optional ``|full[\\0team]`` tail."""
    if len(value) < _GPS_BODY_LEN:
        return None
    lat_e7, lon_e7, alt, speed_cm, course_cd, flags, battery = struct.unpack_from(
        ">iihHHBB", value, 6
    )
    lat, lon = lat_e7 / 1e7, lon_e7 / 1e7
    if not _valid(lat, lon):
        return None
    full_callsign: str | None = None
    team: str | None = None
    tail = value[_GPS_BODY_LEN:]
    if tail.startswith(b"|"):
        name, _, team_raw = tail[1:].decode("utf-8", errors="replace").partition("\x00")
        full_callsign = name.strip() or None
        team = team_raw.strip() or None
    return AtakGps(
        callsign=_ascii_field(value[:6]),
        full_callsign=full_callsign,
        team=team,
        lat=lat,
        lon=lon,
        alt_m=alt,
        speed_mps=speed_cm / 100,
        course_deg=course_cd / 100,
        battery_pct=battery if flags & _GPS_FLAG_BATTERY else None,
    )


def decode_chat(value: bytes) -> AtakChat | None:
    """``sender(6) | room(6) | msgId(int32 BE) | UTF-8 text``."""
    if len(value) <= _CHAT_HEADER_LEN:
        return None
    text = value[_CHAT_HEADER_LEN:].decode("utf-8", errors="replace").strip()
    if not text:
        return None
    return AtakChat(
        sender=_ascii_field(value[:6]),
        room=_ascii_field(value[6:12]),
        msg_id=struct.unpack_from(">i", value, 12)[0],
        text=text,
    )


def decode_cot_fragment(value: bytes) -> CotFragment | None:
    """``fragId(u16 BE) | seq(u8) | total(u8) | data``."""
    if len(value) <= 4:
        return None
    frag_id, seq, total = struct.unpack_from(">HBB", value, 0)
    if not (1 <= seq <= total):
        return None
    return CotFragment(frag_id=frag_id, seq=seq, total=total, data=bytes(value[4:]))


def _gunzip_capped(data: bytes, limit: int) -> bytes | None:
    inflater = zlib.decompressobj(wbits=31)
    try:
        out = inflater.decompress(data, limit + 1)
    except zlib.error:
        return None
    if len(out) > limit or inflater.unconsumed_tail or not inflater.eof:
        return None
    return out


def _float_attr(element: ET.Element | None, name: str) -> float | None:
    if element is None:
        return None
    try:
        return float(element.get(name, ""))
    except ValueError:
        return None


def _epoch(stamp: str | None) -> int | None:
    if not stamp:
        return None
    try:
        return int(datetime.fromisoformat(stamp).timestamp())
    except ValueError:
        return None


def decode_cot(gz: bytes) -> CotEvent | None:
    """A gzip CoT ``<event>``; None when it is too big, hostile or malformed."""
    raw = _gunzip_capped(gz, MAX_COT_XML_BYTES)
    if raw is None:
        return None
    text = raw.decode("utf-8", errors="replace")
    upper = text.upper()
    if "<!DOCTYPE" in upper or "<!ENTITY" in upper:
        return None
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return None
    uid, cot_type = root.get("uid"), root.get("type")
    if root.tag != "event" or not uid or not cot_type:
        return None
    point = root.find("point")
    lat, lon = _float_attr(point, "lat"), _float_attr(point, "lon")
    if lat is None or lon is None or not _valid(lat, lon):
        lat = lon = None
    detail = root.find("detail")
    contact = detail.find("contact") if detail is not None else None
    group = detail.find("__group") if detail is not None else None
    remarks = detail.find("remarks") if detail is not None else None
    track = detail.find("track") if detail is not None else None
    return CotEvent(
        uid=uid,
        type=cot_type,
        lat=lat,
        lon=lon,
        callsign=(contact.get("callsign") or None) if contact is not None else None,
        team=(group.get("name") or None) if group is not None else None,
        remarks=(remarks.text or "").strip() or None if remarks is not None else None,
        stale_at=_epoch(root.get("stale")),
        speed_mps=_float_attr(track, "speed"),
        course_deg=_float_attr(track, "course"),
    )


def decode_sar_fast_gps(blob: bytes) -> SarFastGps | None:
    """``'G' | key prefix(6) | lat(int32 LE, 1e-6 deg) | lon(int32 LE) | km/h(u8)``."""
    if len(blob) != _SAR_FAST_GPS_LEN or blob[0] != _SAR_FAST_GPS_MAGIC:
        return None
    lat_u, lon_u = struct.unpack_from("<ii", blob, 7)
    lat, lon = lat_u / 1e6, lon_u / 1e6
    if not _valid(lat, lon):
        return None
    return SarFastGps(sender_prefix=blob[1:7].hex(), lat=lat, lon=lon, speed_kmh=blob[15])
