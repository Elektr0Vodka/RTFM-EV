import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add stored SNMP history and a per-contact poll interval.

    ``snmp_history``: one row per successful SNMP poll, the decoded MeshCore
    values as a JSON object (same shape as the poll response ``values``).
    Follows ``repeater_telemetry_history``; pruned by age with the telemetry
    retention class. Rows go away with their contact (ON DELETE CASCADE).

    ``contact_snmp.poll_interval_minutes`` (default 5): how often a contact
    with ``poll_enabled`` is polled by the scheduler.

    Idempotent: skips a column that already exists or a table that is absent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS snmp_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            data TEXT NOT NULL,
            FOREIGN KEY (public_key) REFERENCES contacts(public_key) ON DELETE CASCADE
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_snmp_history_pk_ts ON snmp_history (public_key, timestamp)"
    )

    tables_cursor = await conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='contact_snmp'"
    )
    if await tables_cursor.fetchone() is not None:
        col_cursor = await conn.execute("PRAGMA table_info(contact_snmp)")
        if "poll_interval_minutes" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute(
                "ALTER TABLE contact_snmp ADD COLUMN poll_interval_minutes INTEGER NOT NULL DEFAULT 5"
            )

    await conn.commit()
