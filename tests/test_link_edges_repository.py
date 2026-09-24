"""Tests for LinkEdgesRepository write side, known nodes and backfill state."""

import pytest

from app.models import ContactUpsert, ExternalMapNode
from app.repository import ContactRepository
from app.repository.external_map import ExternalMapRepository
from app.repository.link_edges import LinkEdgesRepository
from app.services.traffic_links import EdgeObservation


def pk(prefix: str) -> str:
    return prefix + "0" * (64 - len(prefix))


async def _count(dbi) -> int:
    async with dbi.readonly() as conn:
        async with conn.execute("SELECT COUNT(*) AS n FROM link_edge_events") as cur:
            return (await cur.fetchone())["n"]


class TestKnownNodes:
    @pytest.mark.asyncio
    async def test_contacts_only_including_unlocated(self, test_db):
        await ContactRepository.upsert(
            ContactUpsert(public_key=pk("aa"), name="A", lat=52.0, lon=5.0)
        )
        await ContactRepository.upsert(ContactUpsert(public_key=pk("bb"), name="NoGps"))
        # Prefix-only placeholder contact: not a full identity, never a link end.
        await ContactRepository.upsert(ContactUpsert(public_key="dd11223344", name="Partial"))
        # Analyzer-only node: never a link candidate.
        await ExternalMapRepository.replace_all(
            [
                ExternalMapNode(
                    pubkey=pk("cc"),
                    name="Ext",
                    role="Repeater",
                    lat=52.1,
                    lon=5.1,
                    last_seen=1,
                    advert_count=1,
                    mobile=False,
                )
            ],
            source="test",
            synced_at=1,
        )
        nodes = {n.pubkey: n for n in await LinkEdgesRepository.known_nodes()}
        assert set(nodes) == {pk("aa"), pk("bb")}
        assert (nodes[pk("aa")].lat, nodes[pk("aa")].lon) == (52.0, 5.0)
        assert (nodes[pk("bb")].lat, nodes[pk("bb")].lon) == (None, None)

    @pytest.mark.asyncio
    async def test_zero_zero_is_unlocated(self, test_db):
        await ContactRepository.upsert(
            ContactUpsert(public_key=pk("aa"), name="Z", lat=0.0, lon=0.0)
        )
        nodes = {n.pubkey: n for n in await LinkEdgesRepository.known_nodes()}
        assert nodes[pk("aa")].lat is None


class TestInsertEdges:
    @pytest.mark.asyncio
    async def test_insert_is_idempotent_and_signal_only_on_measured(self, test_db):
        edges = [
            EdgeObservation(pk("aa"), pk("bb"), 1, "unique", False),
            EdgeObservation(pk("bb"), pk("ff"), 1, "nearest", True),
        ]
        for _ in range(2):
            await LinkEdgesRepository.insert_edges(
                raw_packet_id=10,
                ts=1000,
                payload_type="GROUP_TEXT",
                route_type="Flood",
                edges=edges,
                snr=6.5,
                rssi=-90,
            )
        assert await _count(test_db) == 2
        async with test_db.readonly() as conn:
            async with conn.execute(
                "SELECT a_pubkey, snr, rssi, confidence FROM link_edge_events ORDER BY a_pubkey"
            ) as cur:
                rows = [tuple(r) for r in await cur.fetchall()]
        assert rows == [(pk("aa"), None, None, "unique"), (pk("bb"), 6.5, -90, "nearest")]


class TestBackfillState:
    @pytest.mark.asyncio
    async def test_state_and_batches(self, test_db):
        async with test_db.tx() as conn:
            await conn.execute("UPDATE link_edge_backfill_state SET next_id = 1, end_id = 3")
            for i in (1, 2, 3, 4):
                await conn.execute(
                    "INSERT INTO raw_packets (id, timestamp, data, snr, rssi) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (i, 100 + i, bytes([i]), 1.0, -80),
                )
        assert await LinkEdgesRepository.backfill_state() == (1, 3)
        batch = await LinkEdgesRepository.raw_packets_batch(start_id=1, end_id=3, limit=2)
        assert [r.id for r in batch] == [1, 2]
        assert batch[0].timestamp == 101 and batch[0].data == bytes([1])
        await LinkEdgesRepository.set_backfill_next(3)
        assert await LinkEdgesRepository.backfill_state() == (3, 3)
