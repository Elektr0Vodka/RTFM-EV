import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``show_mention_ticker`` to ``app_settings`` (default: enabled).

    Controls the top-bar mention ticker that surfaces channel @mentions the
    user has not yet seen. Idempotent: skips if the column already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" not in existing_tables:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    settings_columns = {row[1] for row in await col_cursor.fetchall()}
    if "show_mention_ticker" not in settings_columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN show_mention_ticker INTEGER NOT NULL DEFAULT 1"
        )

    await conn.commit()
