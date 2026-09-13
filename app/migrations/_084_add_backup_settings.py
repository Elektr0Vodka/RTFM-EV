import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add server-side backup settings to ``app_settings``.

    - ``backup_to_path_enabled`` (0/1, default off): allow writing backups to a
      configured server-side directory.
    - ``backup_destination_path`` (default ''): absolute directory the backup is
      written to when the toggle is on.

    Idempotent: guards the table and each column before adding.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    if "backup_to_path_enabled" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN backup_to_path_enabled INTEGER NOT NULL DEFAULT 0"
        )
    if "backup_destination_path" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN backup_destination_path TEXT NOT NULL DEFAULT ''"
        )

    await conn.commit()
