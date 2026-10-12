import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``messages.duplicate``, the Spam Guard duplicate-suppression marker.

    ``messages.duplicate`` (INTEGER, default 0): set when Spam Guard's duplicate
    suppression caught an incoming channel message (a repeat of a message seen
    shortly before). It is a marker only: unlike ``messages.spam`` it hides
    nothing and does not touch unread counts, mentions or Web Push. Existing
    rows keep 0; nothing is backfilled.

    Idempotent: skips an absent table or a column that already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "messages" in {row[0] for row in await tables_cursor.fetchall()}:
        col_cursor = await conn.execute("PRAGMA table_info(messages)")
        if "duplicate" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute(
                "ALTER TABLE messages ADD COLUMN duplicate INTEGER NOT NULL DEFAULT 0"
            )

    await conn.commit()
