import logging

import aiosqlite

logger = logging.getLogger(__name__)

RETENTION_COLUMN = "device_history_retention_days"


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``app_settings.device_history_retention_days`` (plan 14).

    One age limit for both device history tables: ``device_config_history``
    (by snapshot time) and ``contact_location_history`` (by ``last_seen``, so
    a position still being reported is kept). Default 0 keeps forever, which
    is the behavior before this migration. Idempotent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" in {row[0] for row in await tables_cursor.fetchall()}:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        if RETENTION_COLUMN not in columns:
            await conn.execute(
                f"ALTER TABLE app_settings ADD COLUMN {RETENTION_COLUMN} INTEGER NOT NULL DEFAULT 0"
            )
    await conn.commit()
