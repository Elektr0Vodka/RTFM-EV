import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``radio_presets`` to ``app_settings`` (default: empty = never synced).

    Stores the JSON blob of the last preset list synced from the official
    MeshCore presets API. An empty string means the operator has never synced,
    so the frontend keeps its built-in preset list. Idempotent: skips if the
    column already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" not in existing_tables:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    settings_columns = {row[1] for row in await col_cursor.fetchall()}
    if "radio_presets" not in settings_columns:
        await conn.execute("ALTER TABLE app_settings ADD COLUMN radio_presets TEXT DEFAULT ''")

    await conn.commit()
