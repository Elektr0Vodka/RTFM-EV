import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``region_sync_url`` to ``app_settings`` (default: empty).

    Stores the URL of a remote analyzer regions endpoint (a bare JSON array of
    ``{"code": ..., "name": ...}`` objects, e.g.
    ``https://meshcore-analyzer.eu/api/regions/scopes``) that the
    ``GET /api/regions/sync`` endpoint fetches and normalises into names the
    operator can merge into ``known_regions``. Idempotent: skips if the column
    already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "region_sync_url" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN region_sync_url TEXT NOT NULL DEFAULT ''"
        )

    await conn.commit()
