import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


async def migrate(conn: aiosqlite.Connection) -> None:
    """Storage for Spam Guard (channel spam detection).

    ``spam_guard_config``: one row (``id = 1``) with the settings document as
    JSON and a ``version`` counter for optimistic concurrency, like
    ``host_repeater_config``. No row means defaults (Monitor mode, Public only).

    ``spam_guard_state``: one row (``id = 1``) with what the detector has learnt
    as JSON: blocks, known names, learnt routes, hourly history. Written at
    most every few minutes unless something important changed.

    ``spam_evidence``: one row per evidence record (off unless the user turns
    the evidence log on), pruned by the retention pruner.

    ``messages.spam`` (INTEGER, default 0): set when the detector flags a
    channel message as spam, also after the fact for earlier copies of a
    campaign. ``app_settings.spam_guard_enabled`` (default 0) is the master
    switch; ``app_settings.hide_spam`` (default 0) hides flagged messages in
    chat and keeps them out of unread counts, mentions and Web Push.

    Idempotent: skips tables and columns that already exist, and tables that
    are absent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS spam_guard_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            version INTEGER NOT NULL,
            settings TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS spam_guard_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            state TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS spam_evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts REAL NOT NULL,
            type TEXT NOT NULL,
            data TEXT NOT NULL
        )
        """
    )
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_spam_evidence_ts ON spam_evidence(ts)")

    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    if "messages" in tables and "spam" not in await _columns(conn, "messages"):
        await conn.execute("ALTER TABLE messages ADD COLUMN spam INTEGER NOT NULL DEFAULT 0")

    if "app_settings" in tables:
        columns = await _columns(conn, "app_settings")
        for column in ("spam_guard_enabled", "hide_spam"):
            if column not in columns:
                await conn.execute(
                    f"ALTER TABLE app_settings ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0"
                )

    await conn.commit()
