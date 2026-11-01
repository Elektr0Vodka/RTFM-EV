"""Raw packet dedup follows the firmware's packet identity."""

import pytest

from app.path_utils import calculate_packet_hash, packet_identity_digest
from app.repository import RawPacketRepository


def _packet(payload_type: int, payload: bytes, path: bytes = b"", route_type: int = 1) -> bytes:
    """Header (type << 2 | route), path byte (1-byte hashes), path, payload."""
    return bytes([(payload_type << 2) | route_type, len(path)]) + path + payload


def test_digest_matches_the_firmware_hash():
    raw = _packet(4, b"\x11" * 20, path=b"\xaa")
    digest = packet_identity_digest(raw)
    assert digest is not None
    assert digest.hex()[:16].upper() == calculate_packet_hash(raw)


def test_route_path_is_not_part_of_the_identity():
    payload = b"\x22" * 12
    assert packet_identity_digest(_packet(5, payload)) == packet_identity_digest(
        _packet(5, payload, path=b"\x01\x02")
    )


@pytest.mark.asyncio
async def test_same_payload_with_another_type_is_stored_separately(test_db):
    payload = b"\x33" * 16
    first_id, first_new = await RawPacketRepository.create(_packet(2, payload), 100)
    second_id, second_new = await RawPacketRepository.create(_packet(3, payload), 101)
    assert first_new and second_new
    assert first_id != second_id


@pytest.mark.asyncio
async def test_same_packet_over_another_route_is_a_duplicate(test_db):
    payload = b"\x44" * 16
    first_id, _ = await RawPacketRepository.create(_packet(5, payload), 100)
    second_id, second_new = await RawPacketRepository.create(_packet(5, payload, b"\x09"), 101)
    assert not second_new
    assert second_id == first_id
