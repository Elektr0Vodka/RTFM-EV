import logging

import aiosqlite

logger = logging.getLogger(__name__)

# Column -> default. Defaults reproduce the behavior before this migration:
# telemetry kept 30 days / 1000 rows per node, link_signal 30 days, 10 advert
# paths per contact, and noise floor / battery / airtime / messages were never
# pruned (0 = keep forever).
_COLUMNS: dict[str, int] = {
    "retention_prune_interval_hours": 24,
    "telemetry_retention_days": 30,
    "telemetry_max_rows_per_node": 1000,
    "link_signal_retention_days": 30,
    "advert_paths_per_contact": 10,
    "noise_floor_retention_days": 0,
    "battery_retention_days": 0,
    "airtime_retention_days": 0,
    "message_retention_days": 0,
}


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add the per-data-class retention settings to ``app_settings``.

    Idempotent: skips any column that already exists, and skips entirely if
    ``app_settings`` is absent (partial-migration snapshot).
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    for name, default in _COLUMNS.items():
        if name not in columns:
            await conn.execute(
                f"ALTER TABLE app_settings ADD COLUMN {name} INTEGER NOT NULL DEFAULT {default}"
            )

    await conn.commit()
