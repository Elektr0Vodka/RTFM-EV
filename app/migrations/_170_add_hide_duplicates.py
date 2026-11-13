import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add the chat "Hide duplicates" switch.

    ``app_settings.hide_duplicates`` (INTEGER NOT NULL DEFAULT 0) hides incoming
    messages Spam Guard suppressed as a duplicate in chat. Idempotent: skips a
    column that already exists or a table that is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        if "hide_duplicates" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN hide_duplicates INTEGER NOT NULL DEFAULT 0"
            )
    await conn.commit()
