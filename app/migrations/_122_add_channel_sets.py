import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``channel_sets`` to ``app_settings`` (default: ``'[]'``).

    JSON array of named channel sets (plan 08): each set is a list of channel
    keys + names that can be loaded onto the radio's channel slots in one
    action. Internal-only column, served by ``/api/channel-sets``, not part of
    the ``AppSettings`` model. The default (no sets) changes nothing.
    Idempotent: skips if the column already exists, and skips entirely if
    ``app_settings`` is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "channel_sets" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN channel_sets TEXT NOT NULL DEFAULT '[]'"
        )

    await conn.commit()
