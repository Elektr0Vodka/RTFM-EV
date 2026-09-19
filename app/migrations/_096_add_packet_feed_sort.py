import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``packet_feed_sort`` to ``app_settings`` (default: ``oldest``).

    Stores the Raw Packet Feed time-sort direction: ``oldest`` (oldest packet
    first, the historical default) or ``newest`` (newest packet first). The
    default preserves existing behavior. Idempotent: skips if the column already
    exists, and skips entirely if ``app_settings`` is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "packet_feed_sort" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN packet_feed_sort TEXT NOT NULL DEFAULT 'oldest'"
        )

    await conn.commit()
