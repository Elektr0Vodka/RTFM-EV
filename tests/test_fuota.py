"""Tests for recognising meshcore_fuota firmware-update packets (payload type 0x0E)."""

import pytest

from app.fuota import detect_fuota

OFFER = bytes.fromhex("01abdeadbeefc4000038000001000000050000001122334455667788047f")
REQUEST = bytes.fromhex("02cddeadbeef0300ff00ab01")


def _raw(payload: bytes, header: int = 0x3A, path_byte: int = 0x00) -> bytes:
    """Header 0x3A = version 0, payload type 0x0E, route DIRECT."""
    return bytes([header, path_byte]) + payload


def test_offer_decodes():
    msg = detect_fuota(_raw(OFFER))

    assert msg is not None
    assert msg.kind == "offer"
    assert msg.sender == "ab"
    assert msg.campaign == "deadbeef"
    assert msg.manifest_len == 0x00C4
    assert msg.patch_size == 0x3800
    assert msg.target == 1
    assert msg.build == 5
    assert msg.source_prefix == "1122334455667788"
    assert msg.tail == "047f"
    assert msg.payload_len == 30


def test_request_decodes():
    msg = detect_fuota(_raw(REQUEST))

    assert msg is not None
    assert msg.kind == "request"
    assert msg.sender == "cd"
    assert msg.campaign == "deadbeef"
    assert msg.block == 3
    assert msg.missing_mask == 0x00FF
    assert msg.tail == "ab01"


def test_data_decodes_short_fragment():
    msg = detect_fuota(_raw(bytes.fromhex("03abdeadbeef5200") + bytes(range(40))))

    assert msg is not None
    assert msg.kind == "data"
    assert msg.campaign == "deadbeef"
    assert msg.fragment == 0x52
    assert msg.data_len == 40


def test_retract_decodes():
    msg = detect_fuota(_raw(bytes.fromhex("04ab") + bytes(80)))

    assert msg is not None
    assert msg.kind == "retract"
    assert msg.sender == "ab"
    assert msg.campaign is None
    assert msg.payload_len == 82


@pytest.mark.parametrize(
    "payload",
    [
        OFFER[:29],
        OFFER + b"\x00",
        REQUEST[:11],
        bytes.fromhex("03abdeadbeef5200"),
        bytes.fromhex("03abdeadbeef5200") + bytes(177),
        bytes.fromhex("04ab") + bytes(79),
    ],
    ids=["offer-29", "offer-31", "request-11", "data-8", "data-185", "retract-81"],
)
def test_rejects_wrong_lengths(payload):
    assert detect_fuota(_raw(payload)) is None


@pytest.mark.parametrize("kind", [0, 5])
def test_rejects_unknown_kind(kind):
    assert detect_fuota(_raw(bytes([kind]) + OFFER[1:])) is None


def test_rejects_flood_route():
    assert detect_fuota(_raw(OFFER, header=0x39)) is None


def test_rejects_non_zero_path():
    assert detect_fuota(bytes([0x3A, 0x01, 0xAA]) + OFFER) is None


def test_rejects_nonzero_version():
    assert detect_fuota(_raw(OFFER, header=0x7A)) is None


def test_rejects_other_payload_types():
    assert detect_fuota(_raw(OFFER, header=0x3E)) is None
