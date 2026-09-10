import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``analyzer_sites`` to ``app_settings`` (default: empty JSON array).

    Stores a JSON-encoded list of user-configured external analyzer sites
    (``{name, node_url_template, packet_url_template}``) used for client-side
    "look up on analyzer" deep links. Idempotent: skips if the column already
    exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "analyzer_sites" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN analyzer_sites TEXT NOT NULL DEFAULT '[]'"
        )

    await conn.commit()
