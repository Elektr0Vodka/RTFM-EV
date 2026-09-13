import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add navbar branding columns to ``app_settings``.

    ``brand_name`` overrides the "RemoteTerm" wordmark, ``brand_hidden`` hides
    the wordmark text, ``brand_icon`` is a data-URL logo (empty = built-in SVG).
    Idempotent: skips columns that already exist.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" not in existing_tables:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    if "brand_name" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN brand_name TEXT NOT NULL DEFAULT ''"
        )
    if "brand_hidden" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN brand_hidden INTEGER NOT NULL DEFAULT 0"
        )
    if "brand_icon" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN brand_icon TEXT NOT NULL DEFAULT ''"
        )

    await conn.commit()
