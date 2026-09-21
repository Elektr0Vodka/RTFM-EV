import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``packet_group_by_content`` to ``app_settings`` (default: ``0``).

    Persists the last-selected "Group repeats by content" packet-filter toggle,
    shared by the Raw Packet Feed and Packet History views. Stored as an INTEGER
    (0/1) boolean. Idempotent: skips if the column already exists, and skips
    entirely if ``app_settings`` is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "packet_group_by_content" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN packet_group_by_content INTEGER NOT NULL DEFAULT 0"
        )

    await conn.commit()
