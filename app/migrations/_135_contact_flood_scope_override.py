import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add a per-contact flood-scope override for direct messages.

    ``contacts.flood_scope_override`` (TEXT, nullable) is the same tri-state the
    channels table already has: NULL inherits the global region, ``'*'`` forces
    unscoped/plain flood, and a region name (``'#nl'``) scopes direct messages to
    that contact. It only matters for flood-routed DMs; a direct send over a known
    path carries no transport code.

    Idempotent: skips an absent table or a column that already exists.
    """
    table_cursor = await conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'contacts'"
    )
    if await table_cursor.fetchone() is None:
        await conn.commit()
        return

    cursor = await conn.execute("PRAGMA table_info(contacts)")
    columns = {row[1] for row in await cursor.fetchall()}
    if "flood_scope_override" not in columns:
        await conn.execute("ALTER TABLE contacts ADD COLUMN flood_scope_override TEXT")
    await conn.commit()
