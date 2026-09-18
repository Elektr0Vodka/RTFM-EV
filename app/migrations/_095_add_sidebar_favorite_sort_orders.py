import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``sidebar_favorite_sort_orders`` to ``app_settings`` (default: ``{}``).

    Stores the per-favorite-group sort order in the sidebar: a JSON object
    ``{channels, companions, repeaters, rooms, sensors}`` where each value is
    ``recent`` or ``alpha``. An empty object means "unset" - the client falls
    back to its default (all ``recent``). Idempotent: skips if the column
    already exists, and skips entirely if ``app_settings`` is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "sidebar_favorite_sort_orders" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings "
            "ADD COLUMN sidebar_favorite_sort_orders TEXT NOT NULL DEFAULT '{}'"
        )

    await conn.commit()
