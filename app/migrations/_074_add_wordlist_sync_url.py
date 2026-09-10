import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``wordlist_sync_url`` to ``app_settings`` (default: empty).

    Stores the URL of a remote JSON array of candidate channel names that the
    ``GET /api/registry/wordlist-sync`` endpoint fetches and proxies to the
    browser channel finder, where it is merged into the bundled wordlist.
    Idempotent: skips if the column already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "wordlist_sync_url" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN wordlist_sync_url TEXT NOT NULL DEFAULT ''"
        )

    await conn.commit()
