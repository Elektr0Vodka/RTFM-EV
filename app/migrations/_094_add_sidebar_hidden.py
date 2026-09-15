import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``sidebar_hidden`` to ``app_settings`` (default: empty JSON object).

    Stores which Customize-sidebar entries the user has hidden from the sidebar:
    a JSON object ``{sections: [...], tools: [...], favorites: [...]}`` of hidden
    keys. Hidden entries still appear in the Customize panel so they can be
    re-shown. Idempotent: skips if the column already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "sidebar_hidden" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN sidebar_hidden TEXT NOT NULL DEFAULT '{}'"
        )

    await conn.commit()
