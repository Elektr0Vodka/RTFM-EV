import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``hidden_hop_widths`` to ``app_settings`` (default: ``'[]'``).

    JSON array of per-hop path byte widths (1/2/3) whose incoming messages the
    chat "Hide by hop size" filter hides. Previously a browser-local preference;
    moved server-side so unread counts, mention flags and Web Push can honour
    it too. The default (nothing hidden) preserves existing behavior.
    Idempotent: skips if the column already exists, and skips entirely if
    ``app_settings`` is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "hidden_hop_widths" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN hidden_hop_widths TEXT NOT NULL DEFAULT '[]'"
        )

    await conn.commit()
