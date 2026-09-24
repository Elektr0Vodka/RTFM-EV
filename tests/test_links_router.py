"""Tests for the /api/links/{a}/{b} endpoints."""

import pytest

from app.models import ContactUpsert
from app.repository import ContactRepository

A = "aa" + "0" * 62
B = "bb" + "0" * 62


async def _edge(dbi, pid, ts, ptype="GROUP_TEXT", width=1, conf="unique", snr=None, rssi=None):
    async with dbi.tx() as conn:
        await conn.execute(
            "INSERT INTO link_edge_events (raw_packet_id, ts, a_pubkey, b_pubkey, hop_width, "
            "payload_type, route_type, confidence, snr, rssi) "
            "VALUES (?, ?, ?, ?, ?, ?, 'Flood', ?, ?, ?)",
            (pid, ts, A, B, width, ptype, conf, snr, rssi),
        )


@pytest.fixture
async def seeded(test_db):
    await ContactRepository.upsert(ContactUpsert(public_key=A, name="Alpha", lat=52.0, lon=5.0))
    await ContactRepository.upsert(ContactUpsert(public_key=B, name="Bravo", lat=52.1, lon=5.0))
    await _edge(test_db, 1, 3600, conf="nearest", snr=5.0, rssi=-90)
    await _edge(test_db, 2, 3700, ptype="ADVERT", width=2, snr=7.0, rssi=-80)
    await _edge(test_db, 3, 90000)
    return test_db


@pytest.mark.asyncio
async def test_summary_either_order(seeded, client):
    for path in (f"/api/links/{A}/{B}/summary", f"/api/links/{B.upper()}/{A}/summary"):
        s = (await client.get(path)).json()
        assert s["a"]["pubkey"] == A and s["a"]["name"] == "Alpha"
        assert s["b"]["name"] == "Bravo"
        assert s["total_packets"] == 3
        assert (s["first_seen"], s["last_seen"]) == (3600, 90000)
        assert s["by_hop_width"] == {"1": 2, "2": 1}
        assert s["by_confidence"] == {"nearest": 1, "unique": 2}
        assert s["by_payload_type"] == {"ADVERT": 1, "GROUP_TEXT": 2}
        assert s["involves_self"] is False
        assert 11.0 < s["distance_km"] < 11.3


@pytest.mark.asyncio
async def test_summary_window(seeded, client):
    s = (await client.get(f"/api/links/{A}/{B}/summary?since=3650")).json()
    assert s["total_packets"] == 2


@pytest.mark.asyncio
async def test_timeseries_hour_buckets(seeded, client):
    ts = (await client.get(f"/api/links/{A}/{B}/timeseries?bucket=hour")).json()
    assert ts["bucket_seconds"] == 3600
    assert {(p["bucket"], p["payload_type"], p["count"]) for p in ts["traffic"]} == {
        (3600, "GROUP_TEXT", 1),
        (3600, "ADVERT", 1),
        (90000, "GROUP_TEXT", 1),
    }
    [sig] = ts["signal"]
    assert (sig["bucket"], sig["samples"], sig["snr_avg"], sig["rssi_min"]) == (3600, 2, 6.0, -90)


@pytest.mark.asyncio
async def test_packets_newest_first_with_cursor(seeded, client):
    rows = (await client.get(f"/api/links/{A}/{B}/packets?limit=2")).json()
    assert [r["raw_packet_id"] for r in rows] == [3, 2]
    older = (await client.get(f"/api/links/{A}/{B}/packets?limit=2&before=3700")).json()
    assert [r["raw_packet_id"] for r in older] == [1]


@pytest.mark.asyncio
async def test_rejects_bad_keys(test_db, client):
    r = await client.get("/api/links/zz/aa/summary")
    assert r.status_code == 422
