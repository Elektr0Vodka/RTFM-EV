import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``date_time_format`` to ``app_settings`` (default: ``'auto'``).

    Controls the UI date/time format: ``auto`` follows the UI language,
    ``12h_mdy`` forces 12-hour + mm/dd/yyyy, ``24h_dmy`` forces 24-hour +
    dd/mm/yyyy. Idempotent: skips if the column already exists, and skips
    entirely if ``app_settings`` is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "date_time_format" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN date_time_format TEXT NOT NULL DEFAULT 'auto'"
        )

    await conn.commit()
