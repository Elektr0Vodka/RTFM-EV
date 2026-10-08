"""BER encode/decode for the value types SNMPv2c uses (X.690 subset, RFC 3416).

Only definite lengths and single-byte tags are supported, which is all SNMP
uses. Decoding is strict: anything malformed raises ``BerError`` so a bad
datagram is dropped instead of half-read.
"""

from __future__ import annotations

from dataclasses import dataclass

TAG_INTEGER = 0x02
TAG_OCTET_STRING = 0x04
TAG_NULL = 0x05
TAG_OID = 0x06
TAG_SEQUENCE = 0x30
TAG_IPADDRESS = 0x40
TAG_COUNTER32 = 0x41
TAG_GAUGE32 = 0x42
TAG_TIMETICKS = 0x43
TAG_OPAQUE = 0x44
TAG_COUNTER64 = 0x46
# Varbind exception values (RFC 3416 section 3); encoded with zero length.
TAG_NO_SUCH_OBJECT = 0x80
TAG_NO_SUCH_INSTANCE = 0x81
TAG_END_OF_MIB_VIEW = 0x82

UNSIGNED_TAGS = frozenset({TAG_COUNTER32, TAG_GAUGE32, TAG_TIMETICKS, TAG_COUNTER64})
EXCEPTION_TAGS = frozenset({TAG_NO_SUCH_OBJECT, TAG_NO_SUCH_INSTANCE, TAG_END_OF_MIB_VIEW})

_MAX_SUB_ID = 0xFFFFFFFF
_MAX_INTEGER_BYTES = 8
_MAX_UNSIGNED_BYTES = 9  # 64-bit value plus a leading zero byte

Oid = tuple[int, ...]


class BerError(ValueError):
    """Malformed BER data, or a value that cannot be encoded."""


@dataclass(frozen=True)
class SnmpValue:
    """One SNMP value: the BER tag plus its decoded content.

    ``value`` is an int for INTEGER and the unsigned types, an ``Oid`` tuple
    for OBJECT IDENTIFIER, None for NULL and the exception values, and raw
    bytes for everything else.
    """

    tag: int
    value: int | bytes | Oid | None = None


def encode_length(length: int) -> bytes:
    if length < 0x80:
        return bytes([length])
    body = length.to_bytes((length.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(body)]) + body


def encode_tlv(tag: int, content: bytes) -> bytes:
    return bytes([tag]) + encode_length(len(content)) + content


def decode_tlv(data: bytes, offset: int) -> tuple[int, bytes, int]:
    """Read one TLV at ``offset``. Returns ``(tag, content, next_offset)``."""
    if offset + 2 > len(data):
        raise BerError("truncated TLV header")
    tag = data[offset]
    if tag & 0x1F == 0x1F:
        raise BerError("multi-byte tags are not supported")
    first = data[offset + 1]
    pos = offset + 2
    if first < 0x80:
        length = first
    else:
        count = first & 0x7F
        if count == 0:
            raise BerError("indefinite length is not allowed")
        if count > 4:
            raise BerError("length field too large")
        if pos + count > len(data):
            raise BerError("truncated length field")
        length = int.from_bytes(data[pos : pos + count], "big")
        pos += count
    end = pos + length
    if end > len(data):
        raise BerError("TLV content runs past the end of the data")
    return tag, data[pos:end], end


def encode_integer(value: int) -> bytes:
    """Two's complement, shortest form."""
    magnitude = value if value >= 0 else value + 1
    return value.to_bytes((magnitude.bit_length() + 8) // 8, "big", signed=True)


def _encode_unsigned(value: int) -> bytes:
    if value < 0:
        raise BerError("unsigned SNMP value cannot be negative")
    return value.to_bytes((value.bit_length() + 8) // 8, "big")


def _encode_sub_id(sub_id: int) -> bytes:
    out = [sub_id & 0x7F]
    sub_id >>= 7
    while sub_id:
        out.append(0x80 | (sub_id & 0x7F))
        sub_id >>= 7
    return bytes(reversed(out))


def encode_oid(oid: Oid) -> bytes:
    if len(oid) < 2:
        raise BerError("an OID needs at least two sub-identifiers")
    first, second = oid[0], oid[1]
    if first not in (0, 1, 2) or second < 0 or (first < 2 and second > 39):
        raise BerError("invalid first two OID sub-identifiers")
    if second > _MAX_SUB_ID or any(not 0 <= sub_id <= _MAX_SUB_ID for sub_id in oid[2:]):
        raise BerError("OID sub-identifier out of range")
    # The first two sub-identifiers share one encoded value (X.690 8.19.4).
    out = bytearray(_encode_sub_id(first * 40 + second))
    for sub_id in oid[2:]:
        out += _encode_sub_id(sub_id)
    return bytes(out)


def decode_oid(content: bytes) -> Oid:
    if not content:
        raise BerError("empty OID")
    sub_ids: list[int] = []
    current = 0
    in_sub_id = False
    for byte in content:
        if not in_sub_id and byte == 0x80:
            raise BerError("OID sub-identifier is not in shortest form")
        current = (current << 7) | (byte & 0x7F)
        if current > _MAX_SUB_ID + 80:
            raise BerError("OID sub-identifier out of range")
        in_sub_id = bool(byte & 0x80)
        if not in_sub_id:
            sub_ids.append(current)
            current = 0
    if in_sub_id:
        raise BerError("truncated OID sub-identifier")
    if any(sub_id > _MAX_SUB_ID for sub_id in sub_ids[1:]):
        raise BerError("OID sub-identifier out of range")
    first = min(sub_ids[0] // 40, 2)
    return (first, sub_ids[0] - first * 40, *sub_ids[1:])


def encode_value(value: SnmpValue) -> bytes:
    tag, raw = value.tag, value.value
    if tag == TAG_INTEGER:
        if not isinstance(raw, int) or isinstance(raw, bool):
            raise BerError("INTEGER needs an int")
        return encode_tlv(tag, encode_integer(raw))
    if tag in UNSIGNED_TAGS:
        if not isinstance(raw, int) or isinstance(raw, bool):
            raise BerError("unsigned SNMP value needs an int")
        return encode_tlv(tag, _encode_unsigned(raw))
    if tag == TAG_OID:
        if not isinstance(raw, tuple):
            raise BerError("OBJECT IDENTIFIER needs a tuple")
        return encode_tlv(tag, encode_oid(raw))
    if tag == TAG_NULL or tag in EXCEPTION_TAGS:
        return encode_tlv(tag, b"")
    if not isinstance(raw, bytes | bytearray):
        raise BerError(f"tag 0x{tag:02x} needs bytes")
    return encode_tlv(tag, bytes(raw))


def decode_value(tag: int, content: bytes) -> SnmpValue:
    if tag == TAG_INTEGER:
        if not content or len(content) > _MAX_INTEGER_BYTES:
            raise BerError("bad INTEGER length")
        return SnmpValue(tag, int.from_bytes(content, "big", signed=True))
    if tag in UNSIGNED_TAGS:
        if not content or len(content) > _MAX_UNSIGNED_BYTES:
            raise BerError("bad unsigned length")
        return SnmpValue(tag, int.from_bytes(content, "big"))
    if tag == TAG_OID:
        return SnmpValue(tag, decode_oid(content))
    if tag == TAG_NULL or tag in EXCEPTION_TAGS:
        if content:
            raise BerError("NULL and exception values carry no content")
        return SnmpValue(tag)
    return SnmpValue(tag, bytes(content))
