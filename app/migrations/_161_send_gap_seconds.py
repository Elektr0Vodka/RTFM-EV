import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``send_gap_seconds`` to app_settings.

    The longest wait between two outgoing sends (DMs, channel messages and
    resends). A repeater cannot hear while it repeats, so a send that lands
    while the previous one is still being repeated is lost. The next send goes
    out a second after the previous one's first echo or ACK, or after this many
    seconds, whichever is sooner. ``0`` turns the spacing off; the default is 5.

    Idempotent: skips an absent table or a column that already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    if "send_gap_seconds" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN send_gap_seconds INTEGER NOT NULL DEFAULT 5"
        )

    await conn.commit()
