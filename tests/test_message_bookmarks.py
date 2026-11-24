"""Message bookmarks: repository, retention skip, delete cascade, router, export."""

import base64
import csv
import io
import time
from unittest.mock import patch

import pytest

from app.models import BookmarkEntry, Message
from app.repository import MessageRepository
from app.repository.bookmarks import BookmarkRepository
from app.repository.channels import ChannelRepository
from app.repository.raw_packets import RawPacketRepository
from app.repository.retention import RetentionRepository
from app.routers.bookmarks import bookmarks_to_csv, bookmarks_to_markdown

DAY = 86400
CHAN_KEY = "AB" * 16


async def _msg(text: str = "hello", received_at: int | None = None, key: str = CHAN_KEY) -> int:
    msg_id = await MessageRepository.create(
        msg_type="CHAN",
        text=text,
        received_at=received_at or int(time.time()),
        conversation_key=key,
        sender_name="Alice",
    )
    assert msg_id is not None
    return msg_id


class TestRepository:
    @pytest.mark.asyncio
    async def test_set_update_remove(self, test_db):
        msg_id = await _msg()
        entry = await BookmarkRepository.set(msg_id, "  first  ")
        assert entry is not None
        assert entry.note == "first"
        assert entry.message.bookmarked is True
        created = entry.created_at

        updated = await BookmarkRepository.set(msg_id, "   ")
        assert updated is not None
        assert updated.note is None
        assert updated.created_at == created

        assert await BookmarkRepository.remove(msg_id) is True
        assert await BookmarkRepository.remove(msg_id) is False
        assert await BookmarkRepository.get(msg_id) is None

    @pytest.mark.asyncio
    async def test_set_on_missing_message_returns_none(self, test_db):
        assert await BookmarkRepository.set(999_999, None) is None
        assert await BookmarkRepository.list() == []

    @pytest.mark.asyncio
    async def test_message_responses_carry_bookmark_fields(self, test_db):
        marked = await _msg("marked")
        plain = await _msg("plain")
        await BookmarkRepository.set(marked, "why")
        by_id = {m.id: m for m in await MessageRepository.get_all(conversation_key=CHAN_KEY)}
        assert by_id[marked].bookmarked is True
        assert by_id[marked].bookmark_note == "why"
        assert by_id[plain].bookmarked is False
        assert by_id[plain].bookmark_note is None

    @pytest.mark.asyncio
    async def test_delete_message_cascades_to_bookmark(self, test_db):
        msg_id = await _msg()
        await BookmarkRepository.set(msg_id, None)
        await MessageRepository.delete_with_raw_packets([msg_id])
        assert await BookmarkRepository.list() == []

    @pytest.mark.asyncio
    async def test_retention_keeps_bookmarked_message_and_its_packet(self, test_db):
        now = int(time.time())
        old = now - 40 * DAY
        kept = await _msg("kept", old)
        pruned = await _msg("pruned", old)
        kept_raw, _ = await RawPacketRepository.create(b"\x20kept", old)
        pruned_raw, _ = await RawPacketRepository.create(b"\x21pruned", old)
        await RawPacketRepository.mark_decrypted(kept_raw, kept)
        await RawPacketRepository.mark_decrypted(pruned_raw, pruned)
        await BookmarkRepository.set(kept, "keep me")

        assert await RetentionRepository.count_messages_older_than(now - 30 * DAY) == 1
        assert await RetentionRepository.prune_messages_older_than(now - 30 * DAY) == (1, 1)
        assert await MessageRepository.get_by_id(kept) is not None
        assert await MessageRepository.get_by_id(pruned) is None
        assert await RawPacketRepository.get_by_id(kept_raw) is not None
        assert await RawPacketRepository.get_by_id(pruned_raw) is None

    @pytest.mark.asyncio
    async def test_list_order_paging_and_conversation_filter(self, test_db):
        other_key = "CD" * 16
        await ChannelRepository.upsert(key=CHAN_KEY, name="#test")
        ids = [await _msg(f"m{i}") for i in range(3)]
        other = await _msg("other", key=other_key)
        for msg_id, created in zip([*ids, other], [100, 200, 200, 300], strict=True):
            await BookmarkRepository.set(msg_id, None)
            async with test_db.tx() as conn:
                async with conn.execute(
                    "UPDATE message_bookmarks SET created_at = ? WHERE message_id = ?",
                    (created, msg_id),
                ):
                    pass

        listed = await BookmarkRepository.list()
        assert [e.message.id for e in listed] == [other, ids[2], ids[1], ids[0]]
        assert listed[1].conversation_name == "#test"

        page = await BookmarkRepository.list(limit=2)
        rest = await BookmarkRepository.list(
            before=page[-1].created_at, before_id=page[-1].message.id
        )
        assert [e.message.id for e in page + rest] == [e.message.id for e in listed]

        scoped = await BookmarkRepository.list(conversation_key=other_key)
        assert [e.message.id for e in scoped] == [other]


def _entry(text: str, note: str | None) -> BookmarkEntry:
    return BookmarkEntry(
        message=Message(
            id=7,
            type="CHAN",
            conversation_key=CHAN_KEY,
            text=text,
            received_at=0,
            sender_name="Bob",
        ),
        note=note,
        created_at=60,
        conversation_name="#test",
    )


class TestExport:
    def test_csv_quotes_commas_quotes_and_newlines(self):
        text = 'a, "b"\nc'
        rows = list(csv.reader(io.StringIO(bookmarks_to_csv([_entry(text, "n,1")]))))
        assert rows[0][:3] == ["bookmarked_at", "received_at", "conversation_type"]
        assert rows[1][2:8] == ["Channel", "#test", "Bob", text, "n,1", "7"]
        assert rows[1][0] == "1970-01-01 00:01:00 UTC"

    def test_markdown_quotes_text_and_shows_note(self):
        md = bookmarks_to_markdown([_entry("line1\nline2", "remember")], now=0)
        assert "# RTFM-EV bookmarks" in md
        assert "1 bookmark(s)" in md
        assert "## Channel: #test" in md
        assert "> line1\n> line2" in md
        assert "Note: remember" in md


class TestRouter:
    @pytest.mark.asyncio
    async def test_put_list_delete_and_broadcast(self, test_db, client, captured_broadcasts):
        broadcasts, mock_broadcast = captured_broadcasts
        msg_id = await _msg()
        with patch("app.routers.bookmarks.broadcast_event", mock_broadcast):
            resp = await client.put(f"/api/messages/{msg_id}/bookmark", json={"note": "x"})
            assert resp.status_code == 200
            assert resp.json()["note"] == "x"
            assert resp.json()["message"]["bookmarked"] is True

            listed = (await client.get("/api/bookmarks")).json()
            assert [e["message"]["id"] for e in listed] == [msg_id]

            resp = await client.delete(f"/api/messages/{msg_id}/bookmark")
            assert resp.json() == {"status": "ok", "removed": True}

        assert [b["type"] for b in broadcasts] == ["message_bookmark", "message_bookmark"]
        assert broadcasts[0]["data"] == {
            "message_id": msg_id,
            "type": "CHAN",
            "conversation_key": CHAN_KEY,
            "bookmarked": True,
            "note": "x",
        }
        assert broadcasts[1]["data"]["bookmarked"] is False

    @pytest.mark.asyncio
    async def test_missing_message_and_long_note(self, test_db, client):
        assert (await client.put("/api/messages/424242/bookmark", json={})).status_code == 404
        assert (await client.delete("/api/messages/424242/bookmark")).status_code == 404
        msg_id = await _msg()
        resp = await client.put(f"/api/messages/{msg_id}/bookmark", json={"note": "n" * 501})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_export_downloads(self, test_db, client):
        msg_id = await _msg("exported text")
        await BookmarkRepository.set(msg_id, None)
        resp = await client.get("/api/bookmarks/export?format=csv")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        assert 'filename="rtfm-ev-bookmarks.csv"' in resp.headers["content-disposition"]
        assert "exported text" in resp.text
        resp = await client.get("/api/bookmarks/export?format=md")
        assert "exported text" in resp.text
        assert (await client.get("/api/bookmarks/export?format=pdf")).status_code == 422


class TestPictureMessages:
    @pytest.mark.asyncio
    async def test_bookmarked_mcoimg_datagram_keeps_its_picture(
        self, test_db, client, captured_broadcasts
    ):
        from app.packet_processor import process_raw_packet
        from tests.test_mcoimg_ingest import (
            CHANNEL_KEY_HEX,
            QUADTREE,
            _envelope,
            _messages,
            _packet,
        )

        await ChannelRepository.upsert(key=CHANNEL_KEY_HEX, name="#six77", is_hashtag=True)
        _, mock_broadcast = captured_broadcasts
        payload = base64.b64decode(QUADTREE["appPayloadBase64"])
        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            await process_raw_packet(_packet(_envelope("Zoe", payload)), timestamp=1700000000)
        (msg,) = await _messages()

        resp = await client.put(f"/api/messages/{msg.id}/bookmark", json={"note": "pic"})
        assert resp.status_code == 200
        assert resp.json()["message"]["mcoimg"]["ok"] is True

        (listed,) = (await client.get("/api/bookmarks")).json()
        assert listed["message"]["mcoimg"]["ok"] is True
        assert listed["message"]["bookmarked"] is True
        assert "app_payload" not in listed["message"]
        (again,) = await _messages()
        assert again.mcoimg is not None and again.mcoimg.ok and again.bookmarked
