import logging

import aiosqlite

logger = logging.getLogger(__name__)

# Self-radio measurement series that get a per-radio owner column.
SCOPED_STAT_TABLES = ("battery_history", "noise_floor_samples", "airtime_history")


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``radio_identities`` and scope the self-radio stat series (plan 18).

    ``radio_identities`` holds one row per radio that has fed this install,
    keyed by its full public key. ``status`` is ``pending`` until the user
    answers the connect-time question (``pending_reason``: ``new_key`` or
    ``legacy_history``), then ``confirmed``. A replacement is recorded on the
    OLD row: ``replaced_by`` points at the new row, and ``carry_stats`` /
    ``carry_owned`` say which categories the new radio inherits at read time.
    ``is_active`` marks the most recently connected radio.

    ``battery_history``, ``noise_floor_samples`` and ``airtime_history`` get a
    nullable ``radio_identity_id``. Existing rows stay NULL ("recorded before
    radio tracking") until the first connect assigns them. Idempotent; a
    stat table that does not exist is skipped.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS radio_identities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key TEXT NOT NULL UNIQUE,
            name TEXT,
            notes TEXT,
            first_connected INTEGER NOT NULL,
            last_connected INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'confirmed',
            pending_reason TEXT,
            replaced_by INTEGER,
            carry_stats INTEGER NOT NULL DEFAULT 0,
            carry_owned INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 0
        )
        """
    )

    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}
    for table in SCOPED_STAT_TABLES:
        if table not in tables:
            continue
        col_cursor = await conn.execute(f"PRAGMA table_info({table})")
        columns = {row[1] for row in await col_cursor.fetchall()}
        if "radio_identity_id" not in columns:
            await conn.execute(f"ALTER TABLE {table} ADD COLUMN radio_identity_id INTEGER")
            logger.info("Added %s.radio_identity_id", table)
        await conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{table}_radio_identity "
            f"ON {table}(radio_identity_id, timestamp)"
        )

    await conn.commit()
