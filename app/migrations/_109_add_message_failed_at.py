import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add nullable ``failed_at`` to ``messages``.

    Set (Unix seconds) on an outgoing direct message when every background
    retry ran out without an ACK, so the UI can show a failed state instead of
    a pending ``?`` forever. NULL means "not failed" (pending, delivered, or any
    incoming/channel row). A late ACK clears it again.

    Idempotent: skips if the column exists or ``messages`` is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "messages" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(messages)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "failed_at" not in columns:
        await conn.execute("ALTER TABLE messages ADD COLUMN failed_at INTEGER")

    await conn.commit()
