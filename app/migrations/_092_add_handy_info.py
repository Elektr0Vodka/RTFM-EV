import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``handy_info`` to ``app_settings`` (default: empty JSON object).

    Stores the user overlay for the Handy Info settings section: a JSON object
    ``{overrides: {<builtin_id>: {...}}, custom: [{...}]}`` holding edits to
    built-in entries plus user-created entries. Idempotent: skips if the column
    already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "handy_info" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN handy_info TEXT NOT NULL DEFAULT '{}'"
        )

    await conn.commit()
