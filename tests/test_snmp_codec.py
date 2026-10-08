"""SNMPv2c codec (app/snmp): BER primitives and message framing.

Byte strings here were worked out by hand from X.690 / RFC 3416, not produced
by the code under test.
"""

import pytest

from app.snmp import ber
from app.snmp.ber import BerError, SnmpValue
from app.snmp.message import (
    PDU_GET,
    PDU_GETBULK,
    PDU_RESPONSE,
    SnmpMessage,
    decode_message,
    encode_message,
)

SYS_DESCR = (1, 3, 6, 1, 2, 1, 1, 1, 0)
MESHCORE_UPTIME = (1, 3, 6, 1, 4, 1, 99999, 1, 1, 0)

# GetRequest, v2c, community "public", request-id 1, sysDescr.0 = NULL
GET_SYS_DESCR = bytes.fromhex(
    "3026020101"  # SEQUENCE(38), version INTEGER 1 (v2c)
    "04067075626c6963"  # OCTET STRING "public"
    "a019"  # GetRequest-PDU(25)
    "020101020100020100"  # request-id 1, error-status 0, error-index 0
    "300e300c"  # varbind list(14), varbind(12)
    "06082b06010201010100"  # OID 1.3.6.1.2.1.1.1.0
    "0500"  # NULL
)


class TestInteger:
    @pytest.mark.parametrize(
        ("value", "hexstr"),
        [
            (0, "020100"),
            (1, "020101"),
            (127, "02017f"),
            (128, "02020080"),
            (255, "020200ff"),
            (-1, "0201ff"),
            (-96, "0201a0"),
            (-128, "020180"),
            (-129, "0202ff7f"),
            (199612, "0203030bbc"),
            (2147483647, "02047fffffff"),
            (-2147483648, "020480000000"),
        ],
    )
    def test_round_trip(self, value, hexstr):
        encoded = ber.encode_value(SnmpValue(ber.TAG_INTEGER, value))
        assert encoded.hex() == hexstr
        tag, content, end = ber.decode_tlv(encoded, 0)
        assert end == len(encoded)
        assert ber.decode_value(tag, content) == SnmpValue(ber.TAG_INTEGER, value)

    def test_empty_integer_is_rejected(self):
        with pytest.raises(BerError):
            ber.decode_value(ber.TAG_INTEGER, b"")


class TestUnsigned:
    @pytest.mark.parametrize(
        ("tag", "value", "hexstr"),
        [
            (ber.TAG_COUNTER32, 0, "410100"),
            (ber.TAG_GAUGE32, 255, "420200ff"),
            (ber.TAG_TIMETICKS, 4294967295, "430500ffffffff"),
            (ber.TAG_COUNTER64, 2**64 - 1, "460900ffffffffffffffff"),
        ],
    )
    def test_round_trip(self, tag, value, hexstr):
        encoded = ber.encode_value(SnmpValue(tag, value))
        assert encoded.hex() == hexstr
        t, content, _ = ber.decode_tlv(encoded, 0)
        assert ber.decode_value(t, content) == SnmpValue(tag, value)

    def test_negative_is_rejected(self):
        with pytest.raises(BerError):
            ber.encode_value(SnmpValue(ber.TAG_GAUGE32, -1))


class TestOid:
    @pytest.mark.parametrize(
        ("oid", "hexstr"),
        [
            (SYS_DESCR, "06082b06010201010100"),
            # 99999 = 6*128^2 + 13*128 + 31 -> 86 8d 1f
            (MESHCORE_UPTIME, "060b2b06010401868d1f010100"),
            ((1, 3), "06012b"),
            ((2, 100, 3), "0603813403"),  # first sub-id 2*40+100 = 180 -> 81 34
            ((1, 3, 4294967295), "06062b8fffffff7f"),
        ],
    )
    def test_round_trip(self, oid, hexstr):
        encoded = ber.encode_value(SnmpValue(ber.TAG_OID, oid))
        assert encoded.hex() == hexstr
        t, content, _ = ber.decode_tlv(encoded, 0)
        assert ber.decode_value(t, content) == SnmpValue(ber.TAG_OID, oid)

    @pytest.mark.parametrize("oid", [(), (1,), (3, 1), (1, 40), (1, 3, -1), (1, 3, 2**32)])
    def test_invalid_oid_is_not_encoded(self, oid):
        with pytest.raises(BerError):
            ber.encode_oid(oid)

    @pytest.mark.parametrize("hexstr", ["", "2b86", "2b8001"])
    def test_malformed_oid_is_rejected(self, hexstr):
        # empty, truncated sub-id, non-minimal sub-id (leading 0x80)
        with pytest.raises(BerError):
            ber.decode_oid(bytes.fromhex(hexstr))


class TestOtherValues:
    def test_octet_string_and_null(self):
        assert ber.encode_value(SnmpValue(ber.TAG_OCTET_STRING, b"v1.14.1")).hex() == (
            "040776312e31342e31"
        )
        assert ber.encode_value(SnmpValue(ber.TAG_NULL)).hex() == "0500"

    @pytest.mark.parametrize(
        "tag", [ber.TAG_NO_SUCH_OBJECT, ber.TAG_NO_SUCH_INSTANCE, ber.TAG_END_OF_MIB_VIEW]
    )
    def test_exception_values(self, tag):
        encoded = ber.encode_value(SnmpValue(tag))
        assert encoded == bytes([tag, 0])
        t, content, _ = ber.decode_tlv(encoded, 0)
        assert ber.decode_value(t, content) == SnmpValue(tag)

    def test_unknown_tag_is_kept_as_bytes(self):
        assert ber.decode_value(0x47, b"\x01\x02") == SnmpValue(0x47, b"\x01\x02")


class TestLength:
    def test_long_form_length(self):
        payload = b"x" * 200
        encoded = ber.encode_value(SnmpValue(ber.TAG_OCTET_STRING, payload))
        assert encoded[:3].hex() == "0481c8"
        tag, content, end = ber.decode_tlv(encoded, 0)
        assert (tag, content, end) == (ber.TAG_OCTET_STRING, payload, 203)

    @pytest.mark.parametrize(
        "hexstr",
        [
            "",  # nothing
            "02",  # tag only
            "0205ff",  # length runs past the end
            "0280",  # indefinite length
            "0285ffffffffff",  # length of length too large
            "1f0100",  # multi-byte tag
            "0481",  # truncated long-form length
        ],
    )
    def test_malformed_tlv_is_rejected(self, hexstr):
        with pytest.raises(BerError):
            ber.decode_tlv(bytes.fromhex(hexstr), 0)


class TestMessage:
    def test_encode_get_request_matches_reference_bytes(self):
        msg = SnmpMessage(
            community=b"public",
            pdu_type=PDU_GET,
            request_id=1,
            varbinds=[(SYS_DESCR, SnmpValue(ber.TAG_NULL))],
        )
        assert encode_message(msg) == GET_SYS_DESCR

    def test_decode_get_request(self):
        msg = decode_message(GET_SYS_DESCR)
        assert msg.version == 1
        assert msg.community == b"public"
        assert msg.pdu_type == PDU_GET
        assert msg.request_id == 1
        assert msg.error_status == 0
        assert msg.error_index == 0
        assert msg.varbinds == [(SYS_DESCR, SnmpValue(ber.TAG_NULL))]

    def test_response_round_trip_with_mixed_values(self):
        msg = SnmpMessage(
            community=b"secret",
            pdu_type=PDU_RESPONSE,
            request_id=0x7FFFFFFF,
            varbinds=[
                (MESHCORE_UPTIME, SnmpValue(ber.TAG_INTEGER, 18)),
                ((1, 3, 6, 1, 4, 1, 99999, 1, 2, 0), SnmpValue(ber.TAG_OCTET_STRING, b"v1.14.1")),
                ((1, 3, 6, 1, 4, 1, 99999, 2, 4, 0), SnmpValue(ber.TAG_INTEGER, -96)),
                ((1, 3, 6, 1, 4, 1, 99999, 9, 9, 0), SnmpValue(ber.TAG_NO_SUCH_OBJECT)),
            ],
        )
        assert decode_message(encode_message(msg)) == msg

    def test_getbulk_carries_non_repeaters_and_max_repetitions(self):
        msg = SnmpMessage(
            community=b"public",
            pdu_type=PDU_GETBULK,
            request_id=7,
            error_status=0,
            error_index=10,
            varbinds=[((1, 3, 6, 1, 4, 1, 99999), SnmpValue(ber.TAG_NULL))],
        )
        decoded = decode_message(encode_message(msg))
        assert (decoded.error_status, decoded.error_index) == (0, 10)

    @pytest.mark.parametrize(
        "data",
        [
            b"",
            b"\x00" * 20,
            GET_SYS_DESCR[:-1],  # truncated
            GET_SYS_DESCR + b"\x00",  # trailing garbage
            bytes.fromhex("3003020100"),  # version only
            GET_SYS_DESCR.replace(bytes.fromhex("0500"), bytes.fromhex("0501")),  # bad inner length
        ],
    )
    def test_malformed_message_is_rejected(self, data):
        with pytest.raises(BerError):
            decode_message(data)

    def test_non_v2c_version_is_rejected(self):
        v1 = bytearray(GET_SYS_DESCR)
        v1[4] = 0  # version 0 = SNMPv1
        with pytest.raises(BerError):
            decode_message(bytes(v1))

    def test_too_many_varbinds_is_rejected(self):
        msg = SnmpMessage(
            community=b"public",
            pdu_type=PDU_GET,
            request_id=1,
            varbinds=[((1, 3, 6, 1, i), SnmpValue(ber.TAG_NULL)) for i in range(300)],
        )
        with pytest.raises(BerError):
            decode_message(encode_message(msg))
