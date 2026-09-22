import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add the map "home view" columns to ``app_settings``.

    ``map_home_mode`` selects how the map picks its initial camera on load:
    ``auto`` (the existing geolocate-then-fit behavior), ``home`` (fly to the
    saved ``map_home_lat``/``map_home_lon`` at ``map_home_zoom``) or ``last``
    (restore the last camera the browser saved locally). The lat/lon/zoom
    columns are nullable and only meaningful in ``home`` mode.

    Idempotent: skips any column that already exists, and skips entirely if
    ``app_settings`` is absent (partial-migration snapshot).
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    if "map_home_mode" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN map_home_mode TEXT NOT NULL DEFAULT 'auto'"
        )
    if "map_home_lat" not in columns:
        await conn.execute("ALTER TABLE app_settings ADD COLUMN map_home_lat REAL")
    if "map_home_lon" not in columns:
        await conn.execute("ALTER TABLE app_settings ADD COLUMN map_home_lon REAL")
    if "map_home_zoom" not in columns:
        await conn.execute("ALTER TABLE app_settings ADD COLUMN map_home_zoom REAL")

    await conn.commit()
