import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``telemetry_schedule_minute`` to app_settings.

    The minute of the UTC hour at which scheduled telemetry collection runs.
    ``-1`` (the default) means automatic: a minute derived from the connected
    radio's public key. ``0``-``59`` is a minute the operator chose, so nodes
    near each other can be given different minutes.

    Idempotent: skips an absent table or a column that already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    if "telemetry_schedule_minute" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN telemetry_schedule_minute INTEGER NOT NULL DEFAULT -1"
        )

    await conn.commit()
