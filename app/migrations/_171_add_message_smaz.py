import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Record which messages arrived SMAZ-compressed.

    ``messages.smaz`` (INTEGER NOT NULL DEFAULT 0): set at ingest when an
    incoming body was an ``s:<base64>`` SMAZ body that ``app.smaz`` decoded.
    Stored rows already hold the decoded text and the raw packets are not
    re-decrypted here, so existing rows stay 0 (no backfill). Idempotent: skips
    a column that already exists or a table that is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}
    if "messages" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(messages)")
        if "smaz" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute("ALTER TABLE messages ADD COLUMN smaz INTEGER NOT NULL DEFAULT 0")
    await conn.commit()
