import time

from app.database import db
from app.models import Channel


class ChannelRepository:
    @staticmethod
    async def upsert(key: str, name: str, is_hashtag: bool = False, on_radio: bool = False) -> None:
        """Upsert a channel. Key is 32-char hex string."""
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT INTO channels (key, name, is_hashtag, on_radio, flood_scope_override)
                VALUES (?, ?, ?, ?, NULL)
                ON CONFLICT(key) DO UPDATE SET
                    name = excluded.name,
                    is_hashtag = excluded.is_hashtag,
                    on_radio = excluded.on_radio
                """,
                (key.upper(), name, is_hashtag, on_radio),
            ):
                pass

    @staticmethod
    async def get_by_key(key: str) -> Channel | None:
        """Get a channel by its key (32-char hex string)."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT key, name, is_hashtag, on_radio, flood_scope_override, path_hash_mode_override, last_read_at, favorite, muted
                FROM channels
                WHERE key = ?
                """,
                (key.upper(),),
            ) as cursor:
                row = await cursor.fetchone()
        if row:
            return Channel(
                key=row["key"],
                name=row["name"],
                is_hashtag=bool(row["is_hashtag"]),
                on_radio=bool(row["on_radio"]),
                flood_scope_override=row["flood_scope_override"],
                path_hash_mode_override=row["path_hash_mode_override"],
                last_read_at=row["last_read_at"],
                favorite=bool(row["favorite"]),
                muted=bool(row["muted"]),
            )
        return None

    @staticmethod
    async def get_all() -> list[Channel]:
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT key, name, is_hashtag, on_radio, flood_scope_override, path_hash_mode_override, last_read_at, favorite, muted
                FROM channels
                ORDER BY name
                """
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            Channel(
                key=row["key"],
                name=row["name"],
                is_hashtag=bool(row["is_hashtag"]),
                on_radio=bool(row["on_radio"]),
                flood_scope_override=row["flood_scope_override"],
                path_hash_mode_override=row["path_hash_mode_override"],
                last_read_at=row["last_read_at"],
                favorite=bool(row["favorite"]),
                muted=bool(row["muted"]),
            )
            for row in rows
        ]

    @staticmethod
    async def set_favorite(key: str, value: bool) -> bool:
        """Set or clear the favorite flag for a channel. Returns True if row was found."""
        async with db.tx() as conn:
            async with conn.execute(
                "UPDATE channels SET favorite = ? WHERE key = ?",
                (1 if value else 0, key.upper()),
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0

    @staticmethod
    async def set_muted(key: str, value: bool) -> bool:
        """Set or clear the muted flag for a channel. Returns True if row was found."""
        async with db.tx() as conn:
            async with conn.execute(
                "UPDATE channels SET muted = ? WHERE key = ?",
                (1 if value else 0, key.upper()),
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0

    @staticmethod
    async def delete(key: str) -> None:
        """Delete a channel by key."""
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM channels WHERE key = ?",
                (key.upper(),),
            ):
                pass

    @staticmethod
    async def update_last_read_at(
        key: str,
        timestamp: int | None = None,
        message_id: int | None = None,
    ) -> bool:
        """Update the timestamp and message-ID read cursor for a channel.

        The cursor is the newest message at or before the timestamp, so a
        message arriving later in that same second still counts as unread.

        When ``message_id`` is given, advance only through that exact message
        and never backwards. A delayed client can then acknowledge what was
        on screen without consuming newer arrivals.

        Returns True if a row was updated, False if channel not found
        (or the message is not part of this conversation).
        """
        async with db.tx() as conn:
            if message_id is not None:
                async with conn.execute(
                    "SELECT last_read_at, last_read_message_id FROM channels WHERE key = ?",
                    (key.upper(),),
                ) as cursor:
                    current_row = await cursor.fetchone()
                if current_row is None:
                    return False

                async with conn.execute(
                    """
                    SELECT received_at, id
                    FROM messages
                    WHERE id = ? AND type = 'CHAN' AND conversation_key = ?
                    """,
                    (message_id, key.upper()),
                ) as cursor:
                    boundary = await cursor.fetchone()
                if boundary is None:
                    return False

                current = (
                    current_row["last_read_at"] or 0,
                    current_row["last_read_message_id"] or 0,
                )
                requested = (boundary["received_at"], boundary["id"])
                if requested > current:
                    await conn.execute(
                        """
                        UPDATE channels
                        SET last_read_at = ?, last_read_message_id = ?
                        WHERE key = ?
                        """,
                        (*requested, key.upper()),
                    )
                return True

            ts = timestamp if timestamp is not None else int(time.time())
            async with conn.execute(
                """
                UPDATE channels
                SET last_read_at = ?,
                    last_read_message_id = COALESCE((
                        SELECT MAX(m.id)
                        FROM messages m
                        WHERE m.type = 'CHAN'
                          AND m.conversation_key = channels.key
                          AND m.received_at <= ?
                    ), 0)
                WHERE key = ?
                """,
                (ts, ts, key.upper()),
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0

    @staticmethod
    async def update_flood_scope_override(key: str, flood_scope_override: str | None) -> bool:
        """Set or clear a channel's flood-scope override."""
        async with db.tx() as conn:
            async with conn.execute(
                "UPDATE channels SET flood_scope_override = ? WHERE key = ?",
                (flood_scope_override, key.upper()),
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0

    @staticmethod
    async def update_path_hash_mode_override(key: str, path_hash_mode_override: int | None) -> bool:
        """Set or clear a channel's path hash mode override."""
        async with db.tx() as conn:
            async with conn.execute(
                "UPDATE channels SET path_hash_mode_override = ? WHERE key = ?",
                (path_hash_mode_override, key.upper()),
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0

    @staticmethod
    async def mark_all_read(timestamp: int) -> None:
        """Mark all channels as read at the given timestamp."""
        async with db.tx() as conn:
            async with conn.execute(
                """
                UPDATE channels
                SET last_read_at = ?,
                    last_read_message_id = COALESCE((
                        SELECT MAX(m.id)
                        FROM messages m
                        WHERE m.type = 'CHAN'
                          AND m.conversation_key = channels.key
                          AND m.received_at <= ?
                    ), 0)
                """,
                (timestamp, timestamp),
            ):
                pass
