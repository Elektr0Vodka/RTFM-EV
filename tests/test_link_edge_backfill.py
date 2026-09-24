"""Tests for the one-time link edge backfill."""

import pytest

from app.models import ContactUpsert
from app.repository import ContactRepository
from app.repository.link_edges import LinkEdgesRepository
from app.services import link_edges as ingest
from app.services.link_edge_backfill import run_backfill_batch
from app.services.traffic_links import KnownNode

SELF = KnownNode("ff" + "0" * 62, 52.0, 5.0)


def pk(prefix: str) -> str:
    return prefix + "0" * (64 - len(prefix))


@pytest.fixture(autouse=True)
def _fresh_context():
    ingest.reset_context()
    yield
    ingest.reset_context()


@pytest.mark.asyncio
async def test_backfill_resolves_old_packets_and_advances_cursor(test_db):
    await ContactRepository.upsert(ContactUpsert(public_key=pk("aa"), name="A", lat=52.1, lon=5.0))
    raw = bytes([0x15, 0x01, 0xAA]) + b"\x11" * 10  # FLOOD GROUP_TEXT via "aa"
    async with test_db.tx() as conn:
        for i in (1, 2, 3):
            await conn.execute(
                "INSERT INTO raw_packets (id, timestamp, data, snr, rssi) VALUES (?, ?, ?, ?, ?)",
                (i, 100 + i, raw + bytes([i]), 5.0, -70),
            )
        await conn.execute("UPDATE link_edge_backfill_state SET next_id = 1, end_id = 3")

    done = await run_backfill_batch(SELF, batch_size=2)
    assert done is False
    assert await LinkEdgesRepository.backfill_state() == (3, 3)

    done = await run_backfill_batch(SELF, batch_size=2)
    assert done is True
    assert await LinkEdgesRepository.backfill_state() == (4, 3)

    async with test_db.readonly() as conn:
        async with conn.execute(
            "SELECT raw_packet_id, ts, snr FROM link_edge_events ORDER BY raw_packet_id"
        ) as cur:
            rows = [tuple(r) for r in await cur.fetchall()]
    assert rows == [(1, 101, 5.0), (2, 102, 5.0), (3, 103, 5.0)]

    # Re-running a finished backfill is a no-op.
    assert await run_backfill_batch(SELF, batch_size=2) is True
