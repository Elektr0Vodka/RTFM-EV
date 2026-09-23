"""Tests for recording link edges at packet ingest."""

from unittest.mock import AsyncMock, patch

import pytest

from app.decoder import PacketInfo, PayloadType, RouteType
from app.models import ContactUpsert
from app.repository import ContactRepository
from app.services import link_edges as svc
from app.services.traffic_links import KnownNode

SELF = KnownNode("ff" + "0" * 62, 52.0, 5.0)


def pk(prefix: str) -> str:
    return prefix + "0" * (64 - len(prefix))


@pytest.fixture(autouse=True)
def _fresh_context():
    svc.reset_context()
    yield
    svc.reset_context()


def flood_info(path_hex: str) -> PacketInfo:
    path = bytes.fromhex(path_hex)
    return PacketInfo(
        route_type=RouteType.FLOOD,
        payload_type=PayloadType.GROUP_TEXT,
        payload_version=0,
        path_length=len(path),
        path=path,
        payload=b"",
        path_hash_size=1,
    )


async def _rows(dbi):
    async with dbi.readonly() as conn:
        async with conn.execute(
            "SELECT raw_packet_id, a_pubkey, b_pubkey, payload_type, route_type, snr "
            "FROM link_edge_events ORDER BY a_pubkey"
        ) as cur:
            return [tuple(r) for r in await cur.fetchall()]


@pytest.mark.asyncio
async def test_records_edges_for_flood_packet(test_db):
    await ContactRepository.upsert(ContactUpsert(public_key=pk("aa"), name="A", lat=52.1, lon=5.0))
    await svc.record_packet_edges(7, 1000, flood_info("aa"), 4.0, -95, self_node=SELF)
    assert await _rows(test_db) == [(7, pk("aa"), SELF.pubkey, "GROUP_TEXT", "Flood", 4.0)]


@pytest.mark.asyncio
async def test_no_self_identity_records_nothing(test_db):
    await ContactRepository.upsert(ContactUpsert(public_key=pk("aa"), name="A", lat=52.1, lon=5.0))
    with patch.object(svc, "current_self_node", return_value=None):
        await svc.record_packet_edges(7, 1000, flood_info("aa"), None, None)
    assert await _rows(test_db) == []


@pytest.mark.asyncio
async def test_failures_are_swallowed(test_db):
    with patch.object(
        svc.LinkEdgesRepository, "known_nodes", AsyncMock(side_effect=RuntimeError("boom"))
    ):
        await svc.record_packet_edges(7, 1000, flood_info("aa"), None, None, self_node=SELF)


@pytest.mark.asyncio
async def test_process_raw_packet_calls_recorder(test_db, captured_broadcasts):
    from app.packet_processor import process_raw_packet

    _, mock_broadcast = captured_broadcasts
    raw = bytes([0x15, 0x01, 0xAA]) + b"\x11" * 10  # FLOOD GROUP_TEXT, 1 hop "aa"
    recorder = AsyncMock()
    with (
        patch("app.packet_processor.broadcast_event", mock_broadcast),
        patch("app.packet_processor.record_packet_edges", recorder),
    ):
        result = await process_raw_packet(raw, timestamp=1000, snr=3.0, rssi=-100)
    recorder.assert_awaited_once()
    args = recorder.await_args.args
    assert args[0] == result["packet_id"] and args[1] == 1000
    assert args[3:] == (3.0, -100)
