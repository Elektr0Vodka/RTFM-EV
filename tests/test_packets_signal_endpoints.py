"""Tests for the signal-storage read endpoints: /recent, /timeseries, /historical-stats."""

import pytest

from app.repository import ChannelRepository, MessageRepository
from app.repository.contacts import ContactAdvertPathRepository
from app.repository.raw_packets import RawPacketRepository


async def _seed(ts: int, data: bytes, rssi=None, snr=None, payload_type=None) -> int:
    packet_id, _ = await RawPacketRepository.create(
        data, ts, rssi=rssi, snr=snr, payload_type=payload_type
    )
    return packet_id


class TestRecent:
    @pytest.mark.asyncio
    async def test_returns_recent_packets_oldest_first_with_signal(self, test_db, client):
        await _seed(1700000000, b"\x01\x01", rssi=-80, snr=4.0, payload_type="ADVERT")
        await _seed(1700000001, b"\x02\x02", rssi=-70, snr=6.0, payload_type="GROUP_TEXT")
        await _seed(1700000002, b"\x03\x03", rssi=-60, snr=8.0, payload_type="ADVERT")

        response = await client.get("/api/packets/recent?limit=2")
        assert response.status_code == 200
        body = response.json()

        assert [p["timestamp"] for p in body] == [1700000001, 1700000002]
        last = body[-1]
        assert last["data"] == "0303"
        assert last["rssi"] == -60
        assert last["snr"] == 8.0
        assert last["payload_type"] == "ADVERT"
        assert last["decrypted"] is False

    @pytest.mark.asyncio
    async def test_after_ts_filters(self, test_db, client):
        await _seed(1700000000, b"\x01\x01")
        await _seed(1700000100, b"\x02\x02")

        response = await client.get("/api/packets/recent?after_ts=1700000050")
        assert response.status_code == 200
        body = response.json()
        assert [p["timestamp"] for p in body] == [1700000100]

    @pytest.mark.asyncio
    async def test_empty_db_returns_empty_list(self, test_db, client):
        response = await client.get("/api/packets/recent")
        assert response.status_code == 200
        assert response.json() == []


class TestTimeseries:
    @pytest.mark.asyncio
    async def test_bins_counts_bytes_signal_and_types(self, test_db, client):
        await _seed(1700000000, b"\xaa\xbb", rssi=-80, snr=4.0, payload_type="ADVERT")
        await _seed(1700000100, b"\xaa\xbb\xcc", rssi=-60, snr=8.0, payload_type="GROUP_TEXT")
        await _seed(1700000200, b"\xaa\xbb\xcc\xdd", rssi=-70, snr=6.0, payload_type="ADVERT")

        response = await client.get(
            "/api/packets/timeseries?start_ts=1700000000&end_ts=1700000300&bin_count=3"
        )
        assert response.status_code == 200
        body = response.json()

        assert body["total_packets"] == 3
        assert body["total_bytes"] == 9
        assert body["bin_seconds"] == 100
        assert body["has_signal_data"] is True
        assert body["has_type_data"] is True
        assert len(body["bins"]) == 3
        assert body["bins"][0]["avg_rssi"] == -80.0
        assert body["bins"][0]["type_counts"] == {"ADVERT": 1}

    @pytest.mark.asyncio
    async def test_rejects_bad_range(self, test_db, client):
        response = await client.get("/api/packets/timeseries?start_ts=1700000300&end_ts=1700000000")
        assert response.status_code == 400


class TestHistoricalStats:
    @pytest.mark.asyncio
    async def test_aggregates_signal_neighbors_and_channels(self, test_db, client):
        start, end = 1700000000, 1700001000

        await _seed(start + 10, b"\xaa\xbb", rssi=-80, snr=4.0, payload_type="ADVERT")
        await _seed(start + 20, b"\xaa\xbb\xcc\xdd", rssi=-60, snr=8.0, payload_type="GROUP_TEXT")

        # A contact heard in-window, with a signal-bearing advert path.
        pubkey = "cc" * 32
        await test_db.conn.execute(
            "INSERT INTO contacts (public_key, name, type, lat, lon, last_seen) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (pubkey, "NodeCC", 2, 47.6, -122.3, start + 30),
        )
        await test_db.conn.commit()
        await ContactAdvertPathRepository.record_observation(
            public_key=pubkey, path_hex="", timestamp=start + 30, rssi=-55, snr=9.0
        )

        # A busy channel in-window.
        chan_key = "DEADBEEF" * 4
        await ChannelRepository.upsert(key=chan_key, name="testchan", is_hashtag=True)
        await MessageRepository.create(
            msg_type="CHAN",
            text="hello",
            received_at=start + 40,
            conversation_key=chan_key,
        )

        response = await client.get(f"/api/packets/historical-stats?start_ts={start}&end_ts={end}")
        assert response.status_code == 200
        body = response.json()

        assert body["total_packets"] == 2
        assert body["total_bytes"] == 6
        assert body["has_signal_data"] is True
        assert body["has_type_data"] is True
        assert body["best_rssi"] == -60.0  # strongest raw-packet rssi
        assert body["avg_rssi"] == -70.0
        assert body["type_counts"] == {"ADVERT": 1, "GROUP_TEXT": 1}

        by_count = {n["public_key"]: n for n in body["neighbors_by_count"]}
        assert pubkey in by_count
        assert by_count[pubkey]["heard_count"] >= 1
        assert by_count[pubkey]["best_rssi"] == -55.0

        by_signal = {n["public_key"]: n for n in body["neighbors_by_signal"]}
        assert pubkey in by_signal
        assert by_signal[pubkey]["best_rssi"] == -55.0

        channels = {c["channel_key"]: c for c in body["busiest_channels"]}
        assert channels[chan_key]["message_count"] == 1
        assert channels[chan_key]["channel_name"] == "testchan"

    @pytest.mark.asyncio
    async def test_rejects_bad_range(self, test_db, client):
        response = await client.get(
            "/api/packets/historical-stats?start_ts=1700001000&end_ts=1700000000"
        )
        assert response.status_code == 400
