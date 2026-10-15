import aiosqlite


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add the MeshCore 1.18 companion command line columns.

    ``contacts.remote_cli``: app-set Remote CLI permission (contact flags bit
    0x10, ``ContactInfo::isRemoteCLIAllowed``). NULL means never set in the
    app, so the radio's own bit is left alone; 0/1 is authoritative and is
    re-applied when the radio's copy differs, like ``telemetry_perms``.

    ``messages.cli_permitted``: for an incoming txt_type 3 (CLI command) row,
    1 when our radio had given the sender Remote CLI permission at receive
    time (so the radio ran it and replied), 0 when it ignored it. NULL for
    every other row.

    Idempotent: skips a column that exists or a table that is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    if "contacts" in tables and "remote_cli" not in await _columns(conn, "contacts"):
        await conn.execute("ALTER TABLE contacts ADD COLUMN remote_cli INTEGER")

    if "messages" in tables and "cli_permitted" not in await _columns(conn, "messages"):
        await conn.execute("ALTER TABLE messages ADD COLUMN cli_permitted INTEGER")

    await conn.commit()
