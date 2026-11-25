"""Message bookmarks (migration _173): one row per bookmarked message, optional note."""

import time
from typing import Any

from app.database import db
from app.models import BookmarkEntry
from app.repository.messages import MessageRepository


def _clean_note(note: str | None) -> str | None:
    """Strip the note; empty or whitespace-only means no note."""
    if note is None:
        return None
    stripped = note.strip()
    return stripped or None


_SELECT = (
    f"SELECT {MessageRepository._message_select('m')}, "
    "b.created_at AS bookmark_created_at, "
    "COALESCE(channels.name, contacts.name) AS conversation_name "
    "FROM message_bookmarks b "
    "JOIN messages m ON m.id = b.message_id "
    "LEFT JOIN contacts ON m.type = 'PRIV' AND m.conversation_key = contacts.public_key "
    "LEFT JOIN channels ON m.type = 'CHAN' AND m.conversation_key = channels.key"
)


def _row_to_entry(row: Any) -> BookmarkEntry:
    message = MessageRepository._row_to_message(row)
    return BookmarkEntry(
        message=message,
        note=message.bookmark_note,
        created_at=row["bookmark_created_at"],
        conversation_name=row["conversation_name"],
    )


class BookmarkRepository:
    @staticmethod
    async def set(message_id: int, note: str | None) -> BookmarkEntry | None:
        """Bookmark ``message_id`` or update its note. None when the message does not exist.

        Re-bookmarking keeps the original ``created_at``.
        """
        clean = _clean_note(note)
        async with db.tx() as conn:
            async with conn.execute("SELECT 1 FROM messages WHERE id = ?", (message_id,)) as cur:
                if await cur.fetchone() is None:
                    return None
            async with conn.execute(
                "INSERT INTO message_bookmarks (message_id, note, created_at) VALUES (?, ?, ?) "
                "ON CONFLICT(message_id) DO UPDATE SET note = excluded.note",
                (message_id, clean, int(time.time())),
            ):
                pass
        return await BookmarkRepository.get(message_id)

    @staticmethod
    async def remove(message_id: int) -> bool:
        """Remove the bookmark on ``message_id``. True when one was removed."""
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM message_bookmarks WHERE message_id = ?", (message_id,)
            ) as cursor:
                return cursor.rowcount > 0

    @staticmethod
    async def get(message_id: int) -> BookmarkEntry | None:
        async with db.readonly() as conn:
            async with conn.execute(f"{_SELECT} WHERE b.message_id = ?", (message_id,)) as cur:
                row = await cur.fetchone()
        return _row_to_entry(row) if row else None

    @staticmethod
    async def list(
        *,
        limit: int = 50,
        before: int | None = None,
        before_id: int | None = None,
        conversation_key: str | None = None,
    ) -> list[BookmarkEntry]:
        """Bookmarks, newest bookmark first.

        ``before``/``before_id`` page backwards on ``(created_at, message_id)``;
        ``conversation_key`` limits the list to one conversation.
        """
        query = f"{_SELECT} WHERE 1=1"
        params: list[Any] = []
        if conversation_key is not None:
            query += " AND m.conversation_key = ?"
            params.append(conversation_key)
        if before is not None:
            if before_id is not None:
                query += " AND (b.created_at < ? OR (b.created_at = ? AND b.message_id < ?))"
                params.extend([before, before, before_id])
            else:
                query += " AND b.created_at < ?"
                params.append(before)
        query += " ORDER BY b.created_at DESC, b.message_id DESC"
        if limit > 0:
            query += " LIMIT ?"
            params.append(limit)
        async with db.readonly() as conn:
            async with conn.execute(query, params) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_entry(row) for row in rows]
