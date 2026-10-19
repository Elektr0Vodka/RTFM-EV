import logging

import aiosqlite

logger = logging.getLogger(__name__)

OLD_DEFAULT_EXTERNAL_MAP_URL = "https://meshcore-analyzer.eu/api/nodes"


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``external_map_source`` to ``app_settings``.

    The external-map overlay can now sync from map.meshcore.io
    (``meshcore_map``, the new default) or from an analyzer feed at
    ``external_map_sync_url`` (``analyzer``). Existing installs still on the
    old default URL (or a blank one) move to ``meshcore_map``; an install that
    set its own URL keeps syncing from it (``analyzer``).

    Idempotent: guards the table and the column before adding.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    if "external_map_source" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN external_map_source TEXT NOT NULL "
            "DEFAULT 'meshcore_map'"
        )
        if "external_map_sync_url" in columns:
            await conn.execute(
                "UPDATE app_settings SET external_map_source = 'analyzer' "
                "WHERE TRIM(COALESCE(external_map_sync_url, '')) NOT IN ('', ?)",
                (OLD_DEFAULT_EXTERNAL_MAP_URL,),
            )

    await conn.commit()
