"""Tests for recognising MeshCoreNG payload types 0x0C (Atlas) and 0x0D (Location)."""

import pytest

from app.meshcoreng import detect_meshcoreng

LOCATION_FLOOD = 0x35  # version 0, type 0x0D, route FLOOD
ATLAS_DIRECT = 0x32  # version 0, type 0x0C, route DIRECT


def mcl1(name: bytes = b"", version: int = 1, magic: bytes = b"MCL1") -> bytes:
    """MeshCoreNG compact tracker report (docs/payloads.md), big-endian fields."""
    return (
        magic
        + bytes([version, 0])
        + bytes.fromhex("1a2b3c4d")
        + (52_370_000).to_bytes(4, "big", signed=True)
        + (4_890_000).to_bytes(4, "big", signed=True)
        + (12).to_bytes(2, "big", signed=True)
        + (150).to_bytes(2, "big")
        + (9000).to_bytes(2, "big")
        + bytes([7])
        + (3900).to_bytes(2, "big")
        + (1_790_000_000).to_bytes(4, "big")
        + bytes([len(name)])
        + name
    )


def _raw(payload: bytes, header: int, path: bytes = b"\x00") -> bytes:
    return bytes([header]) + path + payload


def test_location_without_name():
    assert detect_meshcoreng(_raw(mcl1(), LOCATION_FLOOD)) == "location"


def test_location_with_name_and_hops():
    assert detect_meshcoreng(_raw(mcl1(b"Tracker"), LOCATION_FLOOD, b"\x01\xaa")) == "location"


@pytest.mark.parametrize(
    "payload",
    [
        mcl1(magic=b"MCL2"),
        mcl1(version=2),
        mcl1(b"Tracker")[:-1],
        mcl1(b"Tracker") + b"x",
        mcl1(b"x" * 25),
    ],
    ids=["magic", "version", "short-name", "long", "name-over-24"],
)
def test_location_rejects(payload):
    assert detect_meshcoreng(_raw(payload, LOCATION_FLOOD)) is None


def test_location_rejects_other_header_version():
    assert detect_meshcoreng(_raw(mcl1(), LOCATION_FLOOD | 0x40)) is None


def _atlas_position(flags: int) -> bytes:
    extra = 2 * bin(flags & 0x07).count("1")
    return bytes([1, flags]) + bytes(12) + bytes(extra)


def test_atlas_position():
    assert detect_meshcoreng(_raw(_atlas_position(0x07), ATLAS_DIRECT)) == "atlas"
    assert detect_meshcoreng(_raw(_atlas_position(0x00), ATLAS_DIRECT)) == "atlas"


def test_atlas_neighbours_path_sample_and_stats():
    neighbours = bytes([2, 2]) + bytes(20)
    path_sample = bytes([3]) + bytes(8) + bytes([3]) + bytes(3) + bytes([1]) + bytes(4)
    stats = bytes([4]) + bytes(32)
    for payload in (neighbours, path_sample, stats):
        assert detect_meshcoreng(_raw(payload, ATLAS_DIRECT)) == "atlas"


@pytest.mark.parametrize(
    ("payload", "header", "path"),
    [
        (_atlas_position(0x07)[:-1], ATLAS_DIRECT, b"\x00"),
        (bytes([5]) + bytes(20), ATLAS_DIRECT, b"\x00"),
        (bytes([2, 13]) + bytes(130), ATLAS_DIRECT, b"\x00"),
        (_atlas_position(0x00), 0x31, b"\x00"),  # FLOOD
        (_atlas_position(0x00), ATLAS_DIRECT, b"\x01\xaa"),  # one hop
    ],
    ids=["short", "subtype", "neighbours-over-12", "flood", "hop"],
)
def test_atlas_rejects(payload, header, path):
    assert detect_meshcoreng(_raw(payload, header, path)) is None


def test_other_payload_types_are_not_meshcoreng():
    assert detect_meshcoreng(_raw(mcl1(), 0x11)) is None  # ADVERT
