"""Tests for DB-computed Raw Packet Feed breakdowns (helper + endpoint)."""

import pytest

from app.decoder import parse_packet
from app.services.packet_decoded_fields import decoded_stat_fields
from app.services.raw_feed_stats import (
    hop_byte_width_label,
    hop_profile_bucket,
    payload_label,
)


def test_payload_label_mapping():
    assert payload_label("GROUP_TEXT") == "GroupText"
    assert payload_label("TEXT_MESSAGE") == "TextMessage"
    assert payload_label("ADVERT") == "Advert"
    assert payload_label("OTHER_VERSION") == "OtherVersion"
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


ADVERT_KEY = bytes(range(32))
FAR_KEY = bytes(range(50, 82))
ANON_KEY = bytes(range(100, 132))


def _packet(payload_type: int, payload: bytes) -> bytes:
    """A flood packet without a path: header, path byte 0, payload."""
    return bytes([0x01 | (payload_type << 2), 0x00]) + payload


async def _insert_parsed(conn, **kw):
    """Insert with the route and path columns ingest stores for these bytes."""
    fields = decoded_stat_fields(parse_packet(kw["data"]))
    await _insert(conn, **kw, **fields)


async def _message(conn, kind: str, conversation_key: str, *, sender_key=None, sender_name=None):
    cursor = await conn.execute(
        "INSERT INTO messages (type, conversation_key, text, received_at, sender_key, sender_name) "
        "VALUES (?, ?, ?, 1000, ?, ?)",
        (kind, conversation_key, f"hi from {sender_name}", sender_key, sender_name),
    )
    return cursor.lastrowid


class TestRawFeedStatsSourcesAndTimeline:
    """The cards the live windows build from decoded packets, now from the database."""

    @pytest.mark.asyncio
    async def test_sources_neighbors_median_and_timeline(self, test_db, client):
        conn = test_db.conn
        chan_id = await _message(conn, "CHAN", "CD" * 16, sender_key="ab" * 32, sender_name="Sue")
        named_id = await _message(conn, "CHAN", "CD" * 16, sender_name="Bob")
        advert = _packet(0x04, ADVERT_KEY + bytes(69))
        # Transport flood: four transport code bytes, then two hops of two bytes.
        path_byte = (1 << 6) | 2  # two byte hashes, two hops
        far_advert = bytes([0x04 << 2]) + bytes(4) + bytes([path_byte]) + bytes(4) + FAR_KEY
        far_advert += bytes(69)
        rows = [
            # Two adverts from one node: one source, best RSSI -55.
            {"ts": 1000, "data": advert, "payload_type": "ADVERT", "rssi": -70},
            {"ts": 1100, "data": advert + b"\x01", "payload_type": "ADVERT", "rssi": -55},
            # A channel message with a sender key, and one with only a name.
            {
                "ts": 1200,
                "data": b"\x10",
                "payload_type": "GROUP_TEXT",
                "rssi": -90,
                "message_id": chan_id,
            },
            {"ts": 1300, "data": b"\x11", "payload_type": "GROUP_TEXT", "message_id": named_id},
            # A direct message nobody decrypted: its source hash byte.
            {
                "ts": 1400,
                "data": _packet(0x02, b"\x12\x9a" + bytes(4)),
                "payload_type": "TEXT_MESSAGE",
            },
            {"ts": 1500, "data": _packet(0x07, b"\x12" + ANON_KEY), "payload_type": "ANON_REQUEST"},
            # The payload of a transport route with a path starts further on.
            {"ts": 1600, "data": far_advert, "payload_type": "ADVERT"},
            # No source at all.
            {"ts": 1900, "data": _packet(0x03, bytes(4)), "payload_type": "ACK", "rssi": -80},
        ]
        for row in rows:
            await _insert_parsed(conn, **row)
        await conn.commit()

        resp = await client.get("/api/packets/raw-feed-stats?start_ts=1000&end_ts=2000")
        body = resp.json()

        assert body["median_rssi"] == -75
        assert body["unique_sources"] == 6

        most = body["most_active_neighbors"]
        assert most[0] == {
            "key": ADVERT_KEY.hex().upper(),
            "label": ADVERT_KEY.hex().upper()[:12],
            "count": 2,
            "best_rssi": -55,
            "last_seen": 1100,
        }
        listed = most + body["strongest_neighbors"] + body["newest_neighbors"]
        labels = {item["key"]: item["label"] for item in listed}
        assert labels[("ab" * 32).upper()] == "Sue"
        assert labels["name:bob"] == "Bob"
        assert labels["hash1:9A"] == "9A"
        assert len(most) == 5

        strongest = body["strongest_neighbors"]
        assert [item["best_rssi"] for item in strongest] == [-55, -90]
        newest = body["newest_neighbors"]
        assert [item["key"] for item in newest[:2]] == [
            FAR_KEY.hex().upper(),
            ANON_KEY.hex().upper(),
        ]

        timeline = body["timeline"]
        assert len(timeline) == 10
        assert [b["start_ts"] for b in timeline[:2]] == [1000, 1100]
        assert timeline[0]["counts_by_type"] == {"Advert": 1}
        assert timeline[9]["counts_by_type"] == {"Ack": 1}
        assert sum(b["total"] for b in timeline) == 8

    @pytest.mark.asyncio
    async def test_empty_range_has_ten_empty_bins(self, test_db, client):
        body = (await client.get("/api/packets/raw-feed-stats?start_ts=0&end_ts=100")).json()
        assert body["median_rssi"] is None
        assert body["unique_sources"] == 0
        assert body["most_active_neighbors"] == []
        assert [b["total"] for b in body["timeline"]] == [0] * 10
