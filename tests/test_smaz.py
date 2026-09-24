"""SMAZ "s:<base64>" message bodies, ported from meshcore-open lib/helpers/smaz.dart.

meshcore-open ships no SMAZ test fixtures, so the vectors below are derived by
hand from the Dart source: 254 codebook entries, byte 254 = one verbatim byte,
byte 255 = verbatim run whose length is the next byte plus one.
"""

import base64

import pytest

from app import smaz


def _prefixed(raw: bytes) -> str:
    return "s:" + base64.b64encode(raw).decode("ascii")


# 11 x code 1 ("the"): 33 bytes of text, 18 bytes as "s:<base64>".
THE_X11 = "the" * 11
THE_X11_B64 = "AQEBAQEBAQEBAQE="


class TestDecompress:
    def test_codebook_has_254_entries(self):
        assert len(smaz.CODEBOOK) == 254

    def test_codebook_entry(self):
        assert smaz.decompress(bytes([1])) == b"the"
        assert smaz.decompress(bytes([0, 253])) == b" .com"

    def test_verbatim_single_byte(self):
        assert smaz.decompress(bytes([254, 0x48])) == b"H"

    def test_verbatim_run_length_is_next_byte_plus_one(self):
        assert smaz.decompress(bytes([255, 2, 0x41, 0x42, 0x43])) == b"ABC"
        assert smaz.decompress(bytes([255, 0, 0x41])) == b"A"

    def test_verbatim_run_of_256(self):
        run = bytes(range(256))
        assert smaz.decompress(bytes([255, 255]) + run) == run

    @pytest.mark.parametrize(
        "raw",
        [
            bytes([254]),
            bytes([255]),
            bytes([255, 2, 0x41, 0x42]),
            bytes([1, 255, 5, 0x41]),
        ],
    )
    def test_truncated_stream_raises(self, raw):
        with pytest.raises(ValueError):
            smaz.decompress(raw)


class TestCompress:
    @pytest.mark.parametrize(
        "text",
        [
            "the",
            "Hello world!",
            "Meet at the tower at 18:00, bring the radio",
            "Grüße aus Utrecht 👋",
            "x" * 700,
            "http://example.com/",
        ],
    )
    def test_round_trip(self, text):
        raw = text.encode("utf-8")
        assert smaz.decompress(smaz.compress(raw)) == raw

    def test_long_verbatim_input_splits_runs_at_256(self):
        raw = "é".encode() * 200  # 400 bytes, no codebook matches
        packed = smaz.compress(raw)
        assert packed[0] == 255 and packed[1] == 255
        assert smaz.decompress(packed) == raw

    def test_greedy_longest_match(self):
        # "the " -> "the" (1) then " " (0); "he " (19) is never reached.
        assert smaz.compress(b"the ") == bytes([1, 0])
        # " th" (13) beats " t" (14) and " " (0).
        assert smaz.compress(b" th") == bytes([13])

    def test_single_unmatched_byte_uses_verbatim_single(self):
        assert smaz.compress(b"H") == bytes([254, 0x48])


class TestTryDecodePrefixed:
    def test_decodes_standard_base64(self):
        assert smaz.try_decode_prefixed("s:" + THE_X11_B64) == THE_X11

    def test_decodes_real_message(self):
        text = "Meet at the tower at 18:00, bring the radio"
        assert smaz.try_decode_prefixed(_prefixed(smaz.compress(text.encode()))) == text

    def test_decodes_utf8_verbatim_bytes(self):
        text = "Meet at the tower 👋 at the station with the others"
        assert smaz.try_decode_prefixed(_prefixed(smaz.compress(text.encode()))) == text

    def test_decodes_base64url_without_padding(self):
        assert smaz.try_decode_prefixed("s:" + THE_X11_B64.rstrip("=")) == THE_X11
        text = "the weather in the north is 👋 fine, and the radio is on"
        packed = smaz.compress(text.encode())
        encoded = base64.urlsafe_b64encode(packed).decode().rstrip("=")
        assert "-" in encoded or "_" in encoded
        assert smaz.try_decode_prefixed("s:" + encoded) == text

    def test_leading_whitespace_is_ignored(self):
        assert smaz.try_decode_prefixed("  s:" + THE_X11_B64) == THE_X11

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "hello",
            "s:",
            "s:   ",
            "S:" + THE_X11_B64,
            "s:!!!!",
            "s:A",
            "see s:" + THE_X11_B64 + " later",
        ],
    )
    def test_non_smaz_text_returns_none(self, text):
        assert smaz.try_decode_prefixed(text) is None

    def test_truncated_stream_returns_none(self):
        assert smaz.try_decode_prefixed(_prefixed(bytes([255, 5, 0x41]))) is None

    def test_invalid_utf8_returns_none(self):
        assert smaz.try_decode_prefixed(_prefixed(bytes([254, 0xFF]))) is None

    def test_body_not_shorter_than_its_text_is_left_alone(self):
        # "s:AQ==" expands to "the": 6 bytes to send 3, which the encoder never does.
        assert smaz.try_decode_prefixed("s:AQ==") is None

    def test_plain_word_that_happens_to_be_base64_is_left_alone(self):
        # "s:test" is valid base64 and a canonical stream ("e seem"), but it is
        # not shorter than the text it expands to, so meshcore-open would never
        # have sent it compressed. Keep the literal text.
        assert smaz.try_decode_prefixed("s:test") is None
        assert smaz.try_decode_prefixed("s:done") is None
        # Short compressed bodies that do not save bytes are also left alone.
        text = "Grüße 👋 aus Utrecht"
        assert smaz.try_decode_prefixed(_prefixed(smaz.compress(text.encode()))) is None

    def test_non_canonical_stream_is_left_alone(self):
        # Two single verbatim bytes; the encoder would have emitted one run.
        packed = bytes([254, ord("Q"), 254, ord("Z")]) + bytes([1]) * 12
        assert smaz.decompress(packed) == b"QZ" + b"the" * 12
        assert smaz.try_decode_prefixed(_prefixed(packed)) is None


class TestDecodeMessageText:
    def test_decodes_smaz_body(self):
        assert smaz.decode_message_text("s:" + THE_X11_B64) == THE_X11

    def test_keeps_plain_text(self):
        assert smaz.decode_message_text("s:test") == "s:test"
        assert smaz.decode_message_text("hello") == "hello"
