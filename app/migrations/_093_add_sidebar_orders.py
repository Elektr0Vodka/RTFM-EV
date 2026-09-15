import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add sidebar drag-order columns to ``app_settings``.

    Stores the user's Customize-sidebar drag orders server-side so they sync
    across devices: ``sidebar_section_order``, ``sidebar_tool_order`` and
    ``sidebar_favorites_order``, each a JSON array string. Empty string means
    "unset" - the client falls back to its canonical default order. This
    reverses migration _051, which had moved sidebar sort order out to
    localStorage. Idempotent: skips columns that already exist.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    for column in (
        "sidebar_section_order",
        "sidebar_tool_order",
        "sidebar_favorites_order",
    ):
        if column not in columns:
            await conn.execute(
                f"ALTER TABLE app_settings ADD COLUMN {column} TEXT NOT NULL DEFAULT ''"
            )

    await conn.commit()
