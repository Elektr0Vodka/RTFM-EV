import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``contact_snmp.use_as_telemetry``: the node's SNMP polls count as telemetry.

    When 1, the node's SNMP readings feed the latest-telemetry view (map, Fleet)
    and the repeater telemetry history, and the RF tracked-telemetry cycle skips
    the node while SNMP answers. 0 (the default) keeps today's behaviour.

    Idempotent: skips an existing column or an absent table.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}
    if "contact_snmp" in tables:
        cursor = await conn.execute("PRAGMA table_info(contact_snmp)")
        columns = {row[1] for row in await cursor.fetchall()}
        if "use_as_telemetry" not in columns:
            await conn.execute(
                "ALTER TABLE contact_snmp ADD COLUMN use_as_telemetry INTEGER NOT NULL DEFAULT 0"
            )
    await conn.commit()
