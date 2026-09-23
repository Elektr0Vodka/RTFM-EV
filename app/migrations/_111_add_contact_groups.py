import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``contact_groups`` to ``app_settings`` (default: empty JSON array).

    Stores the user's contact/channel groups server-side so all browsers agree:
    a JSON array of ``{id, name, contact_keys, channel_keys}`` objects. Each
    group is rendered as its own collapsible sidebar section (see
    ``sidebar_section_order`` / ``sidebar_hidden`` from migrations _093/_094,
    which already tolerate unknown keys and so accept the group section keys
    without a schema change). Idempotent: skips if the column already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "contact_groups" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN contact_groups TEXT NOT NULL DEFAULT '[]'"
        )

    await conn.commit()
