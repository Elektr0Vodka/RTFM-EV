"""Decoders for TAK-MESHCORE and MeshCore SAR payloads.

Fixtures are built by hand with ``struct`` from the formats documented in the
module, not with the decoders themselves.
"""

import base64
import gzip
import os
import struct

from app.atak_payloads import (
    EnvelopeChunk,
    decode_ax25,
    decode_chat,
    decode_cot,
    decode_cot_fragment,
    decode_gps,
    decode_sar_fast_gps,
    decode_tlv,
    looks_encrypted,
    parse_envelope,
)


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _addr(callsign: str, ssid: int, last: bool) -> bytes:
    padded = (callsign + "      ")[:6].encode("ascii")
    return bytes(b << 1 for b in padded) + bytes([0x60 | (ssid << 1) | (1 if last else 0)])


def _frame(dest: str, src: str, info: bytes, src_ssid: int = 0) -> bytes:
    return _addr(dest, 0, False) + _addr(src, src_ssid, True) + b"\x03\xf0" + info


def _gps_body(
    lat: float, lon: float, alt: int, speed_cm: int, course_cd: int, flags: int, battery: int
) -> bytes:
    return b"JSTR25" + struct.pack(
        ">iihHHBB", round(lat * 1e7), round(lon * 1e7), alt, speed_cm, course_cd, flags, battery
    )


class TestEnvelope:
    def test_parse_envelope_roundtrip(self):
        assert parse_envelope("UVAX1|42|1|2|" + _b64(b"abc")) == EnvelopeChunk("42", 1, 2, b"abc")

    def test_prefix_inside_text(self):
        chunk = parse_envelope("x UVAX1|7|1|1|" + _b64(b"\x01\x02"))
        assert chunk == EnvelopeChunk("7", 1, 1, b"\x01\x02")

    def test_seq_above_total_rejected(self):
        assert parse_envelope("UVAX1|1|3|2|" + _b64(b"abc")) is None

    def test_bad_base64_rejected(self):
        assert parse_envelope("UVAX1|1|1|1|!!!not-base64") is None

    def test_plain_text_is_not_envelope(self):
        assert parse_envelope("hello there") is None


class TestAx25:
    def test_decode_ax25_openrl(self):
        frame = decode_ax25(_frame("OPENRL", "JSTR25", b"\x03\x00\x00", src_ssid=3))
        assert frame is not None
        assert frame.dest == "OPENRL"
        assert frame.dest_ssid == 0
        assert frame.src == "JSTR25"
        assert frame.src_ssid == 3
        assert frame.info == b"\x03\x00\x00"

    def test_short_callsign_trimmed(self):
        frame = decode_ax25(_frame("OPENRL", "AB", b"x"))
        assert frame is not None
        assert frame.src == "AB"

    def test_not_ui_frame_rejected(self):
        raw = bytearray(_frame("OPENRL", "JSTR25", b"x"))
        raw[14] = 0x13  # control byte
        assert decode_ax25(bytes(raw)) is None

    def test_too_short_rejected(self):
        assert decode_ax25(b"\x00" * 10) is None


class TestTlv:
    def test_decode_tlv(self):
        tlv = decode_tlv(b"\x02\x00\x03abc")
        assert tlv is not None
        assert (tlv.type, tlv.value) == (2, b"abc")

    def test_decode_tlv_exact_length(self):
        assert decode_tlv(b"\x02\x00\x05abc") is None
        assert decode_tlv(b"\x02\x00\x01abc") is None

    def test_encrypted_info_flagged(self):
        info = b"\x03" + os.urandom(60)
        assert looks_encrypted(info) is True
        assert decode_tlv(info) is None

    def test_plain_gps_tlv_not_encrypted(self):
        body = _gps_body(52.0, 5.0, 0, 0, 0, 0x01, 0)
        info = b"\x03" + struct.pack(">H", len(body)) + body
        assert looks_encrypted(info) is False


class TestGps:
    def test_decode_gps_full(self):
        body = _gps_body(52.3702, 4.8952, 12, 150, 27000, 0x05, 80) + b"|JESTER_25\x00Cyan"
        gps = decode_gps(body)
        assert gps is not None
        assert gps.callsign == "JSTR25"
        assert gps.full_callsign == "JESTER_25"
        assert gps.team == "Cyan"
        assert abs(gps.lat - 52.3702) < 1e-6
        assert abs(gps.lon - 4.8952) < 1e-6
        assert gps.alt_m == 12
        assert gps.speed_mps == 1.5
        assert gps.course_deg == 270.0
        assert gps.battery_pct == 80

    def test_full_callsign_without_team(self):
        gps = decode_gps(_gps_body(52.0, 5.0, 0, 0, 0, 0x01, 0) + b"|JESTER_25")
        assert gps is not None
        assert gps.full_callsign == "JESTER_25"
        assert gps.team is None

    def test_decode_gps_no_battery_flag(self):
        gps = decode_gps(_gps_body(52.0, 5.0, 0, 0, 0, 0x01, 77))
        assert gps is not None
        assert gps.battery_pct is None
        assert gps.full_callsign is None

    def test_negative_coordinates(self):
        gps = decode_gps(_gps_body(-33.8688, -151.2093, -5, 0, 0, 0x01, 0))
        assert gps is not None
        assert abs(gps.lat + 33.8688) < 1e-6
        assert abs(gps.lon + 151.2093) < 1e-6
        assert gps.alt_m == -5

    def test_decode_gps_rejects_zero_and_range(self):
        assert decode_gps(_gps_body(0.0, 0.0, 0, 0, 0, 0x01, 0)) is None
        assert decode_gps(_gps_body(91.0, 5.0, 0, 0, 0, 0x01, 0)) is None

    def test_short_body_rejected(self):
        assert decode_gps(b"\x00" * 21) is None


class TestChat:
    def test_decode_chat(self):
        chat = decode_chat(b"JSTR25ALL   " + struct.pack(">i", 1234567) + b"hello")
        assert chat is not None
        assert chat.sender == "JSTR25"
        assert chat.room == "ALL"
        assert chat.msg_id == 1234567
        assert chat.text == "hello"

    def test_empty_text_rejected(self):
        assert decode_chat(b"JSTR25ALL   " + struct.pack(">i", 1)) is None


class TestCot:
    MARKER = (
        '<event version="2.0" uid="u-1" type="a-h-G" stale="2026-10-19T12:15:00Z">'
        '<point lat="52.1" lon="5.1" hae="0" ce="9999999" le="9999999"/>'
        '<detail><contact callsign="OP-1"/><__group name="Cyan" role="Team Member"/>'
        '<track speed="2.5" course="90"/><remarks>hi</remarks></detail></event>'
    )

    def test_cot_marker(self):
        event = decode_cot(gzip.compress(self.MARKER.encode()))
        assert event is not None
        assert event.uid == "u-1"
        assert event.type == "a-h-G"
        assert event.lat == 52.1
        assert event.lon == 5.1
        assert event.callsign == "OP-1"
        assert event.team == "Cyan"
        assert event.remarks == "hi"
        assert event.speed_mps == 2.5
        assert event.course_deg == 90.0
        assert event.stale_at == 1792412100

    def test_cot_without_point(self):
        xml = '<event version="2.0" uid="u-2" type="b-t-f"><detail><remarks>x</remarks></detail></event>'
        event = decode_cot(gzip.compress(xml.encode()))
        assert event is not None
        assert event.lat is None
        assert event.lon is None
        assert event.remarks == "x"

    def test_cot_rejects_doctype(self):
        xml = '<!DOCTYPE e [<!ENTITY x "y">]>' + self.MARKER
        assert decode_cot(gzip.compress(xml.encode())) is None

    def test_cot_rejects_oversize_inflate(self):
        xml = self.MARKER.replace("<remarks>hi", "<remarks>" + " " * 70000)
        assert decode_cot(gzip.compress(xml.encode())) is None

    def test_cot_rejects_not_gzip(self):
        assert decode_cot(self.MARKER.encode()) is None

    def test_cot_rejects_non_event_root(self):
        assert decode_cot(gzip.compress(b"<foo/>")) is None

    def test_decode_cot_fragment(self):
        frag = decode_cot_fragment(struct.pack(">HBB", 513, 2, 3) + b"data")
        assert frag is not None
        assert (frag.frag_id, frag.seq, frag.total, frag.data) == (513, 2, 3, b"data")

    def test_fragment_seq_above_total_rejected(self):
        assert decode_cot_fragment(struct.pack(">HBB", 1, 4, 3) + b"data") is None


class TestSarFastGps:
    @staticmethod
    def _blob(lat: float, lon: float, speed: int, magic: int = 0x47) -> bytes:
        return (
            bytes([magic])
            + bytes.fromhex("a1b2c3d4e5f6")
            + struct.pack("<ii", round(lat * 1e6), round(lon * 1e6))
            + bytes([speed])
        )

    def test_sar_fast_gps(self):
        fix = decode_sar_fast_gps(self._blob(52.0, 5.0, 37))
        assert fix is not None
        assert fix.sender_prefix == "a1b2c3d4e5f6"
        assert fix.lat == 52.0
        assert fix.lon == 5.0
        assert fix.speed_kmh == 37

    def test_wrong_length_rejected(self):
        assert decode_sar_fast_gps(self._blob(52.0, 5.0, 1)[:15]) is None

    def test_wrong_magic_rejected(self):
        assert decode_sar_fast_gps(self._blob(52.0, 5.0, 1, magic=0x48)) is None

    def test_out_of_range_rejected(self):
        assert decode_sar_fast_gps(self._blob(95.0, 5.0, 1)) is None
