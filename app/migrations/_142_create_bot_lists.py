import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create the bot list tables and ``app_settings.hide_bots``.

    ``bot_lists``: one row per list. ``source`` is ``local`` (made or imported
    here), ``url`` (a subscription) or ``shipped`` (the list in the repo).
    ``enabled`` marks its senders in chat; ``block_forward`` is the per-list
    forwarding switch. Both default to 0.

    ``bot_list_entries``: exact sender name, optional public key (64 hex, lower
    case) and note. ``forward_reviewed`` is 0 only for a name a URL refresh
    added and the user has not confirmed for forward blocking yet.

    ``bot_exceptions``: names never treated as a bot, whichever list names them.

    ``app_settings.hide_bots`` (default 0): hide listed senders in chat and keep
    them out of unread counts, mentions and Web Push.

    Idempotent: tables use IF NOT EXISTS; the column is skipped when present or
    when ``app_settings`` is absent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS bot_lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL,
            url TEXT,
            enabled INTEGER NOT NULL DEFAULT 0,
            block_forward INTEGER NOT NULL DEFAULT 0,
            file_updated TEXT,
            fetched_at INTEGER,
            last_error TEXT,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS bot_list_entries (
            list_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            public_key TEXT,
            note TEXT,
            forward_reviewed INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (list_id, name)
        )
        """
    )
    await conn.execute("CREATE TABLE IF NOT EXISTS bot_exceptions (name TEXT PRIMARY KEY)")

    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" in {row[0] for row in await tables_cursor.fetchall()}:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        if "hide_bots" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN hide_bots INTEGER NOT NULL DEFAULT 0"
            )

    await conn.commit()
