import logging

import aiosqlite

logger = logging.getLogger(__name__)

DEFAULT_EXTERNAL_MAP_URL = "https://meshcore-analyzer.eu/api/nodes"


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add external-map node sync settings to ``app_settings``.

    Adds three columns used by the external analyzer node overlay:
    - ``external_map_enabled`` (0/1, default off)
    - ``external_map_sync_url`` (default: the EU MeshCore Analyzer node feed)
    - ``external_map_sync_interval_hours`` (0 = manual only)

    Idempotent: guards the table and each column before adding.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    if "external_map_enabled" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN external_map_enabled INTEGER NOT NULL DEFAULT 0"
        )
    if "external_map_sync_url" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN external_map_sync_url TEXT NOT NULL "
            f"DEFAULT '{DEFAULT_EXTERNAL_MAP_URL}'"
        )
    if "external_map_sync_interval_hours" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN external_map_sync_interval_hours "
            "INTEGER NOT NULL DEFAULT 0"
        )

    await conn.commit()
