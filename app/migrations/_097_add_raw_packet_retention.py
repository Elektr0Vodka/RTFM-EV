import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``raw_packet_retention_days`` to ``app_settings`` (default: 0).

    0 keeps raw_packets forever (preserves pre-migration behavior). A positive
    integer is the number of days of raw_packets history to keep; the daily
    prune task deletes rows older than that. Idempotent: skips if the column
    already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "raw_packet_retention_days" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN raw_packet_retention_days INTEGER NOT NULL DEFAULT 0"
        )

    await conn.commit()
