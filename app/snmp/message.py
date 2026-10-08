"""SNMPv2c message framing (RFC 3416 PDUs inside an RFC 1901 message).

    Message ::= SEQUENCE { version INTEGER (1 = v2c), community OCTET STRING, PDU }
    PDU     ::= [tag] { request-id, error-status, error-index, VarBindList }

GetBulkRequest reuses the two error fields as non-repeaters and
max-repetitions; ``SnmpMessage`` keeps the PDU field names for both.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.snmp import ber
from app.snmp.ber import BerError, Oid, SnmpValue

VERSION_2C = 1

PDU_GET = 0xA0
PDU_GETNEXT = 0xA1
PDU_RESPONSE = 0xA2
PDU_SET = 0xA3
PDU_GETBULK = 0xA5

ERROR_NO_ERROR = 0
ERROR_TOO_BIG = 1
ERROR_GEN_ERR = 5

MAX_MESSAGE_BYTES = 65507  # largest UDP payload
MAX_VARBINDS = 256

_KNOWN_PDUS = frozenset({PDU_GET, PDU_GETNEXT, PDU_RESPONSE, PDU_SET, PDU_GETBULK})

VarBind = tuple[Oid, SnmpValue]


@dataclass
class SnmpMessage:
    community: bytes
    pdu_type: int
    request_id: int
    error_status: int = 0  # non-repeaters in a GetBulkRequest
    error_index: int = 0  # max-repetitions in a GetBulkRequest
    varbinds: list[VarBind] = field(default_factory=list)
    version: int = VERSION_2C


def _integer(value: int) -> bytes:
    return ber.encode_tlv(ber.TAG_INTEGER, ber.encode_integer(value))


def encode_message(message: SnmpMessage) -> bytes:
    varbinds = b"".join(
        ber.encode_tlv(
            ber.TAG_SEQUENCE,
            ber.encode_tlv(ber.TAG_OID, ber.encode_oid(oid)) + ber.encode_value(value),
        )
        for oid, value in message.varbinds
    )
    pdu = ber.encode_tlv(
        message.pdu_type,
        _integer(message.request_id)
        + _integer(message.error_status)
        + _integer(message.error_index)
        + ber.encode_tlv(ber.TAG_SEQUENCE, varbinds),
    )
    return ber.encode_tlv(
        ber.TAG_SEQUENCE,
        _integer(message.version) + ber.encode_tlv(ber.TAG_OCTET_STRING, message.community) + pdu,
    )


def _expect(data: bytes, offset: int, tag: int, what: str) -> tuple[bytes, int]:
    got, content, end = ber.decode_tlv(data, offset)
    if got != tag:
        raise BerError(f"expected {what}")
    return content, end


def _expect_integer(data: bytes, offset: int, what: str) -> tuple[int, int]:
    content, end = _expect(data, offset, ber.TAG_INTEGER, what)
    value = ber.decode_value(ber.TAG_INTEGER, content).value
    assert isinstance(value, int)
    return value, end


def decode_message(data: bytes) -> SnmpMessage:
    """Parse one SNMPv2c datagram. Raises ``BerError`` on anything malformed."""
    if len(data) > MAX_MESSAGE_BYTES:
        raise BerError("message too large")
    body, end = _expect(data, 0, ber.TAG_SEQUENCE, "message SEQUENCE")
    if end != len(data):
        raise BerError("trailing bytes after the message")

    version, pos = _expect_integer(body, 0, "version")
    if version != VERSION_2C:
        raise BerError("only SNMPv2c is supported")
    community, pos = _expect(body, pos, ber.TAG_OCTET_STRING, "community")

    pdu_type, pdu, end = ber.decode_tlv(body, pos)
    if pdu_type not in _KNOWN_PDUS:
        raise BerError("unsupported PDU type")
    if end != len(body):
        raise BerError("trailing bytes after the PDU")

    request_id, pos = _expect_integer(pdu, 0, "request-id")
    error_status, pos = _expect_integer(pdu, pos, "error-status")
    error_index, pos = _expect_integer(pdu, pos, "error-index")
    varbind_list, end = _expect(pdu, pos, ber.TAG_SEQUENCE, "varbind list")
    if end != len(pdu):
        raise BerError("trailing bytes after the varbind list")

    varbinds: list[VarBind] = []
    pos = 0
    while pos < len(varbind_list):
        if len(varbinds) >= MAX_VARBINDS:
            raise BerError("too many varbinds")
        varbind, pos = _expect(varbind_list, pos, ber.TAG_SEQUENCE, "varbind")
        oid_bytes, value_pos = _expect(varbind, 0, ber.TAG_OID, "varbind name")
        tag, content, value_end = ber.decode_tlv(varbind, value_pos)
        if value_end != len(varbind):
            raise BerError("trailing bytes after the varbind value")
        varbinds.append((ber.decode_oid(oid_bytes), ber.decode_value(tag, content)))

    return SnmpMessage(
        community=bytes(community),
        pdu_type=pdu_type,
        request_id=request_id,
        error_status=error_status,
        error_index=error_index,
        varbinds=varbinds,
        version=version,
    )
