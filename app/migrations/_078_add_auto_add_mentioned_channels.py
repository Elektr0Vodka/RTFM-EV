import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``auto_add_mentioned_channels`` to ``app_settings`` (default: disabled).

    When enabled, #hashtag channels referenced in chat are auto-recorded in the
    Channel Registry. Idempotent: skips if the column already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" not in existing_tables:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    settings_columns = {row[1] for row in await col_cursor.fetchall()}
    if "auto_add_mentioned_channels" not in settings_columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN "
            "auto_add_mentioned_channels INTEGER NOT NULL DEFAULT 0"
        )

    await conn.commit()
