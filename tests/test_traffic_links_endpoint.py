"""Tests for GET /api/packets/traffic-links."""

import pytest

from app.models import ContactUpsert
from app.repository import ContactRepository


def pk(prefix: str) -> str:
    return prefix + "0" * (64 - len(prefix))


async def _edge(dbi, pid, ts, a, b, width=1, confidence="unique"):
    lo, hi = sorted((a, b))
    async with dbi.tx() as conn:
        await conn.execute(
            "INSERT INTO link_edge_events (raw_packet_id, ts, a_pubkey, b_pubkey, hop_width, "
            "payload_type, route_type, confidence) "
            "VALUES (?, ?, ?, ?, ?, 'GROUP_TEXT', 'Flood', ?)",
            (pid, ts, lo, hi, width, confidence),
        )


@pytest.mark.asyncio
async def test_aggregates_window_and_drops_unlocated(test_db, client):
    await ContactRepository.upsert(ContactUpsert(public_key=pk("aa"), name="A", lat=52.0, lon=5.0))
    await ContactRepository.upsert(ContactUpsert(public_key=pk("bb"), name="B", lat=52.1, lon=5.0))
    await _edge(test_db, 1, 100, pk("aa"), pk("bb"), confidence="nearest")
    await _edge(test_db, 2, 200, pk("aa"), pk("bb"), confidence="nearest")
    await _edge(test_db, 3, 300, pk("aa"), pk("bb"), confidence="unique")
    await _edge(test_db, 4, 300, pk("aa"), pk("cc"))  # cc unknown: dropped

    r = await client.get("/api/packets/traffic-links")
    assert r.status_code == 200
    [e] = r.json()
    assert (e["count"], e["first_seen"], e["last_seen"], e["ambiguous"]) == (3, 100, 300, False)

    r = await client.get("/api/packets/traffic-links?since=150&until=250")
    [e] = r.json()
    assert (e["count"], e["first_seen"], e["last_seen"], e["ambiguous"]) == (1, 200, 200, True)


@pytest.mark.asyncio
async def test_max_km_filters(test_db, client):
    await ContactRepository.upsert(ContactUpsert(public_key=pk("aa"), name="A", lat=52.0, lon=5.0))
    await ContactRepository.upsert(ContactUpsert(public_key=pk("bb"), name="B", lat=53.0, lon=5.0))
    await _edge(test_db, 1, 100, pk("aa"), pk("bb"))
    assert len((await client.get("/api/packets/traffic-links?max_km=200")).json()) == 1
    assert (await client.get("/api/packets/traffic-links?max_km=50")).json() == []
