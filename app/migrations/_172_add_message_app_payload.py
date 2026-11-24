import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Keep the app payload of an MCOimg v3 channel picture with its chat row.

    ``messages.app_payload`` (BLOB, NULL) holds ``0x13 | body`` (at most 165
    bytes) for a GRP_DATA ``data_type 0x0120`` datagram that carried MCOimg v3,
    so the picture can be drawn from history. NULL for every other row.
    Idempotent: skips a column that already exists or a table that is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}
    if "messages" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(messages)")
        if "app_payload" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute("ALTER TABLE messages ADD COLUMN app_payload BLOB")
    await conn.commit()
