"""GET /api/packets/history: cursor paging + server-side filters."""

import pytest

from app.repository import RawPacketRepository
from app.repository.channels import ChannelRepository
from app.repository.messages import MessageRepository


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


async def _seed_linked_message(
    data: bytes,
    ts: int,
    *,
    text: str,
    conversation_key: str,
    sender_name: str | None = None,
) -> int:
    """Store a raw packet linked to a decrypted message; return the packet id."""
    packet_id, _ = await RawPacketRepository.create(data, ts)
    message_id = await MessageRepository.create(
        msg_type="CHAN",
        text=text,
        received_at=ts,
        conversation_key=conversation_key,
        sender_name=sender_name,
    )
    assert message_id is not None
    await RawPacketRepository.mark_decrypted(packet_id, message_id)
    return packet_id


class TestHistorySearch:
    @pytest.mark.asyncio
    async def test_matches_message_text(self, test_db, client):
        hit = await _seed_linked_message(
            bytes.fromhex("aa01"), 100, text="meet at the tower", conversation_key="k1"
        )
        await _seed_linked_message(
            bytes.fromhex("aa02"), 101, text="totally unrelated", conversation_key="k1"
        )
        r = await client.get("/api/packets/history", params={"search": "tower"})
        ids = [p["id"] for p in r.json()["packets"]]
        assert ids == [hit]

    @pytest.mark.asyncio
    async def test_matches_sender_name_case_insensitive(self, test_db, client):
        # Distinct text per message so the null-safe message dedup index does not
        # collapse the two rows (both would share conversation_key + NULL ts).
        hit = await _seed_linked_message(
            bytes.fromhex("bb01"),
            100,
            text="alpha",
            conversation_key="k1",
            sender_name="Alice",
        )
        await _seed_linked_message(
            bytes.fromhex("bb02"), 101, text="beta", conversation_key="k1", sender_name="Bob"
        )
        r = await client.get("/api/packets/history", params={"search": "ALICE"})
        ids = [p["id"] for p in r.json()["packets"]]
        assert ids == [hit]

    @pytest.mark.asyncio
    async def test_matches_channel_name(self, test_db, client):
        # Channel keys are stored uppercase (ChannelRepository.upsert), and CHAN
        # messages carry the same-cased key as conversation_key (mirrors the
        # app's own `channels ON m.conversation_key = c.key` joins).
        await ChannelRepository.upsert("CHANKEY", "SecretChannel")
        hit = await _seed_linked_message(
            bytes.fromhex("cc01"), 100, text="one", conversation_key="CHANKEY"
        )
        await _seed_linked_message(
            bytes.fromhex("cc02"), 101, text="two", conversation_key="OTHERKEY"
        )
        r = await client.get("/api/packets/history", params={"search": "secretchannel"})
        ids = [p["id"] for p in r.json()["packets"]]
        assert ids == [hit]

    @pytest.mark.asyncio
    async def test_excludes_packets_without_linked_message(self, test_db, client):
        await RawPacketRepository.create(bytes.fromhex("dd01"), 100)  # no message
        await _seed_linked_message(bytes.fromhex("dd02"), 101, text="findme", conversation_key="k1")
        r = await client.get("/api/packets/history", params={"search": "findme"})
        assert len(r.json()["packets"]) == 1

    @pytest.mark.asyncio
    async def test_empty_search_is_noop(self, test_db, client):
        await _seed_linked_message(bytes.fromhex("ee01"), 100, text="hi", conversation_key="k1")
        await RawPacketRepository.create(bytes.fromhex("ee02"), 101)
        r = await client.get("/api/packets/history", params={"search": "  "})
        assert len(r.json()["packets"]) == 2

    @pytest.mark.asyncio
    async def test_search_coexists_with_hex_filter(self, test_db, client):
        hit = await _seed_linked_message(
            bytes.fromhex("ff0abc"), 100, text="findme one", conversation_key="k1"
        )
        # Matches search but not hex.
        await _seed_linked_message(
            bytes.fromhex("ff0def"), 101, text="findme two", conversation_key="k1"
        )
        r = await client.get("/api/packets/history", params={"search": "findme", "hex": "abc"})
        ids = [p["id"] for p in r.json()["packets"]]
        assert ids == [hit]
