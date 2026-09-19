"""GET /api/packets/history: cursor paging + server-side filters."""

import pytest

from app.repository import RawPacketRepository


async def _seed_sequential(n: int) -> None:
    # ids ascending, timestamps 100..100+n-1, distinct hex payloads.
    for i in range(n):
        await RawPacketRepository.create(bytes([0xA0 + i]), 100 + i)


class TestHistoryPaging:
    @pytest.mark.asyncio
    async def test_window_and_cursor(self, test_db, client):
        await _seed_sequential(10)

        r = await client.get("/api/packets/history", params={"limit": 4})
        body = r.json()
        assert r.status_code == 200
        assert len(body["packets"]) == 4
        # newest-first page; cursor is the smallest id in the page.
        assert body["next_cursor"] == body["packets"][-1]["id"]

        r2 = await client.get(
            "/api/packets/history", params={"limit": 4, "before_id": body["next_cursor"]}
        )
        assert all(p["id"] < body["next_cursor"] for p in r2.json()["packets"])

    @pytest.mark.asyncio
    async def test_null_cursor_at_end(self, test_db, client):
        await _seed_sequential(3)
        r = await client.get("/api/packets/history", params={"limit": 1000})
        assert r.json()["next_cursor"] is None

    @pytest.mark.asyncio
    async def test_time_window(self, test_db, client):
        await _seed_sequential(10)  # ts 100..109
        r = await client.get("/api/packets/history", params={"after_ts": 105, "before_ts": 107})
        ts = [p["timestamp"] for p in r.json()["packets"]]
        assert set(ts) == {105, 106, 107}


class TestHistoryFilters:
    @pytest.mark.asyncio
    async def test_payload_type_filter_maps_bucket_to_enum(self, test_db, client):
        await RawPacketRepository.create(b"\x01", 100, payload_type="ADVERT")
        await RawPacketRepository.create(b"\x02", 101, payload_type="TEXT_MESSAGE")

        r = await client.get("/api/packets/history", params=[("payload_types", "Advert")])
        assert {p["payload_type"] for p in r.json()["packets"]} == {"ADVERT"}

    @pytest.mark.asyncio
    async def test_payload_type_unknown_bucket_is_complement(self, test_db, client):
        await RawPacketRepository.create(b"\x01", 100, payload_type="ADVERT")
        await RawPacketRepository.create(b"\x02", 101, payload_type="GROUP_DATA")

        r = await client.get("/api/packets/history", params=[("payload_types", "Unknown")])
        types = {p["payload_type"] for p in r.json()["packets"]}
        assert "GROUP_DATA" in types
        assert "ADVERT" not in types

    @pytest.mark.asyncio
    async def test_hex_substring_filter(self, test_db, client):
        await RawPacketRepository.create(bytes.fromhex("abcd12"), 100)
        await RawPacketRepository.create(bytes.fromhex("00ff00"), 101)

        r = await client.get("/api/packets/history", params={"hex": "cd12"})
        data = [p["data"] for p in r.json()["packets"]]
        assert data == ["abcd12"]

    @pytest.mark.asyncio
    async def test_invalid_hex_returns_422(self, test_db, client):
        r = await client.get("/api/packets/history", params={"hex": "xyz"})
        assert r.status_code == 422
