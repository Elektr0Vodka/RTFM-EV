import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add the 'Hide by name pattern' chat filter.

    ``messages.name_filtered`` (INTEGER, default 0): set for an incoming channel
    message whose sender matches ``app_settings.name_filter_patterns``, at ingest
    and again for stored messages when the list changes (``app.name_filter``).

    ``app_settings.name_filter_patterns`` (TEXT, default ``[]``): the patterns as
    a JSON list. ``app_settings.hide_name_filtered`` (INTEGER, default 0): when
    on, flagged messages are hidden in chat and excluded from unread counts,
    mentions and Web Push.

    The list starts empty, so there is nothing to backfill. Idempotent: skips a
    column that already exists or a table that is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    if "messages" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(messages)")
        if "name_filtered" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute(
                "ALTER TABLE messages ADD COLUMN name_filtered INTEGER NOT NULL DEFAULT 0"
            )

    if "app_settings" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        if "name_filter_patterns" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN name_filter_patterns TEXT NOT NULL DEFAULT '[]'"
            )
        if "hide_name_filtered" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN hide_name_filtered INTEGER NOT NULL DEFAULT 0"
            )

    await conn.commit()
