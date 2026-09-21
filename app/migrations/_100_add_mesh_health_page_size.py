import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``mesh_health_page_size`` to ``app_settings`` (default: ``50``).

    Stores the page size (rows per page) for the Mesh Health "All Advertised
    Contacts Heard" table. ``0`` means "show all" (no pagination); other values
    are the allowed page sizes (10/25/50/100). Idempotent: skips if the column
    already exists, and skips entirely if ``app_settings`` is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "mesh_health_page_size" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN mesh_health_page_size INTEGER NOT NULL DEFAULT 50"
        )

    await conn.commit()
