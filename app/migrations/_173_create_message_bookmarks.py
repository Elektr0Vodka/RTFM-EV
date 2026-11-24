import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``message_bookmarks`` for message bookmarks.

    One row per bookmarked message, with an optional note. ``message_id`` is
    both the key and a foreign key to ``messages`` with ``ON DELETE CASCADE``,
    so deleting a message also removes its bookmark. Retention cleanup skips
    bookmarked messages (``RetentionRepository.prune_messages_older_than``).

    Idempotent: ``CREATE ... IF NOT EXISTS``.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS message_bookmarks (
            message_id INTEGER PRIMARY KEY
                REFERENCES messages(id) ON DELETE CASCADE,
            note TEXT,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_message_bookmarks_created "
        "ON message_bookmarks (created_at DESC, message_id DESC)"
    )
    await conn.commit()
