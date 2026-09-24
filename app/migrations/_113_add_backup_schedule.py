import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add the scheduled-backup columns to ``app_settings``.

    ``backup_schedule_enabled`` turns on automatic snapshots into the
    server-side backup directory (``backup_destination_path``, which must also
    be enabled). ``backup_schedule_interval_hours`` is the gap between
    snapshots; ``backup_schedule_keep`` is how many automatic snapshots are
    retained (older ones are deleted; manual backups are never touched).

    Idempotent: skips any column that already exists, and skips entirely if
    ``app_settings`` is absent (partial-migration snapshot).
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    if "backup_schedule_enabled" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN backup_schedule_enabled INTEGER NOT NULL DEFAULT 0"
        )
    if "backup_schedule_interval_hours" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN "
            "backup_schedule_interval_hours INTEGER NOT NULL DEFAULT 24"
        )
    if "backup_schedule_keep" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN backup_schedule_keep INTEGER NOT NULL DEFAULT 7"
        )

    await conn.commit()
