import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``contact_snmp``: per-contact SNMP polling settings.

    One row per contact that has an SNMP address configured (observer firmware
    nodes reachable over the LAN). Kept out of ``contacts`` on purpose: contact
    rows are sent to the browser, over the WebSocket and into fanout modules,
    and the SNMP community must not travel with them.

    - ``host`` / ``port`` / ``community``: where and how to poll (UDP).
    - ``poll_enabled``: include the contact in scheduled polling.
    - ``last_ok_at`` / ``last_error`` / ``last_error_at``: outcome of the most
      recent polls, for the UI.

    The row is removed with its contact (ON DELETE CASCADE).
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS contact_snmp (
            public_key TEXT PRIMARY KEY,
            host TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 161,
            community TEXT NOT NULL DEFAULT 'public',
            poll_enabled INTEGER NOT NULL DEFAULT 0,
            last_ok_at INTEGER,
            last_error TEXT,
            last_error_at INTEGER,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (public_key) REFERENCES contacts(public_key) ON DELETE CASCADE
        )
        """
    )
    await conn.commit()
