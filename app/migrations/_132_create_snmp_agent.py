import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``snmp_agent``: settings of RTFM-EV's own SNMP agent (one row).

    The agent answers SNMPv2c GET/GETNEXT/GETBULK with the same OID layout as
    the observer firmware. It is off until ``enabled`` is set.

    - ``port``: UDP port the agent listens on (default 161).
    - ``community``: community a manager must send (default 'public').
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS snmp_agent (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL DEFAULT 0,
            port INTEGER NOT NULL DEFAULT 161,
            community TEXT NOT NULL DEFAULT 'public'
        )
        """
    )
    await conn.execute("INSERT OR IGNORE INTO snmp_agent (id) VALUES (1)")
    await conn.commit()
