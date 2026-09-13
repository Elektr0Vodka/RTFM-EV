"""Tests for DB-computed Raw Packet Feed breakdowns (helper + endpoint)."""

import pytest

from app.services.raw_feed_stats import (
    hop_byte_width_label,
    hop_profile_bucket,
    payload_label,
)


def test_payload_label_mapping():
    assert payload_label("GROUP_TEXT") == "GroupText"
    assert payload_label("TEXT_MESSAGE") == "TextMessage"
    assert payload_label("ADVERT") == "Advert"
    assert payload_label(None) == "Unknown"
    assert payload_label("SOMETHING_ELSE") == "Unknown"


def test_hop_profile_bucket():
    assert hop_profile_bucket(0) == "0"
    assert hop_profile_bucket(1) == "1"
    assert hop_profile_bucket(4) == "2-5"
    assert hop_profile_bucket(10) == "6-10"
    assert hop_profile_bucket(40) == "32+"


def test_hop_byte_width_label():
    assert hop_byte_width_label(0) == "No path"
    assert hop_byte_width_label(1) == "1 byte / hop"
    assert hop_byte_width_label(2) == "2 bytes / hop"
    assert hop_byte_width_label(3) == "3 bytes / hop"
    assert hop_byte_width_label(None) == "Unknown width"
    assert hop_byte_width_label(9) == "Unknown width"


async def _insert(conn, **kw):
    await conn.execute(
        "INSERT INTO raw_packets "
        "(timestamp, data, payload_hash, rssi, snr, payload_type, message_id, "
        "route_type, hop_count, hop_byte_width, path_signature) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            kw["ts"],
            kw["data"],
            kw["data"],  # unique payload_hash stand-in
            kw.get("rssi"),
            kw.get("snr"),
            kw.get("payload_type"),
            kw.get("message_id"),
            kw.get("route_type"),
            kw.get("hop_count"),
            kw.get("hop_byte_width"),
            kw.get("path_signature"),
        ),
    )


class TestRawFeedStatsEndpoint:
    @pytest.mark.asyncio
    async def test_breakdowns(self, test_db, client):
        conn = test_db.conn
        await conn.execute("PRAGMA foreign_keys=OFF")
        await _insert(
            conn,
            ts=1000,
            data=b"\x01",
            payload_type="GROUP_TEXT",
            route_type="Flood",
            hop_count=0,
            hop_byte_width=0,
            path_signature=None,
            rssi=-60,
        )
        await _insert(
            conn,
            ts=1010,
            data=b"\x02",
            payload_type="TEXT_MESSAGE",
            route_type="Direct",
            hop_count=3,
            hop_byte_width=1,
            path_signature="aabbcc",
            rssi=-80,
            message_id=9999,
        )
        await _insert(
            conn,
            ts=1020,
            data=b"\x03",
            payload_type="ADVERT",
            route_type="Flood",
            hop_count=1,
            hop_byte_width=1,
            path_signature="dd",
            rssi=-90,
        )
        # Outside the queried range -> excluded.
        await _insert(
            conn,
            ts=5000,
            data=b"\x04",
            payload_type="ADVERT",
            route_type="Flood",
            hop_count=0,
            hop_byte_width=0,
            rssi=-50,
        )
        await conn.commit()

        resp = await client.get("/api/packets/raw-feed-stats?start_ts=900&end_ts=2000")
        assert resp.status_code == 200
        body = resp.json()

        assert body["packet_count"] == 3
        assert body["decrypted_count"] == 1
        assert body["undecrypted_count"] == 2
        assert body["path_bearing_count"] == 2
        assert body["distinct_paths"] == 2
        assert body["best_rssi"] == -60

        route = {r["label"]: r["count"] for r in body["route_breakdown"]}
        assert route == {"Flood": 2, "Direct": 1}

        payload = {r["label"]: r["count"] for r in body["payload_breakdown"]}
        assert payload == {"GroupText": 1, "TextMessage": 1, "Advert": 1}

        hop = {r["label"]: r["count"] for r in body["hop_profile"]}
        assert hop["0"] == 1 and hop["1"] == 1 and hop["2-5"] == 1

        width = {r["label"]: r["count"] for r in body["hop_byte_width_profile"]}
        assert width["No path"] == 1
        assert width["1 byte / hop"] == 2

        rssi = {r["label"]: r["count"] for r in body["rssi_buckets"]}
        assert rssi["Strong (>-70 dBm)"] == 1
        assert rssi["Okay (-70 to -85 dBm)"] == 1
        assert rssi["Weak (<-85 dBm)"] == 1

    @pytest.mark.asyncio
    async def test_empty_range(self, test_db, client):
        resp = await client.get("/api/packets/raw-feed-stats?start_ts=0&end_ts=100")
        assert resp.status_code == 200
        body = resp.json()
        assert body["packet_count"] == 0
        assert body["payload_breakdown"] == []

    @pytest.mark.asyncio
    async def test_bad_range(self, test_db, client):
        resp = await client.get("/api/packets/raw-feed-stats?start_ts=100&end_ts=100")
        assert resp.status_code == 400
