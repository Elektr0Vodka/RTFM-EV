import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Keep each advert's own timestamp, and add the repeater clock-sync list.

    ``advert_events.sender_timestamp`` (INTEGER, nullable) is the wall clock the
    advertising node put in its advert. With ``first_seen`` (our receive time)
    next to it, the node's clock offset is ``sender_timestamp - first_seen``.
    Rows stored before this migration stay NULL: the value was not kept.

    ``app_settings.clock_sync_repeaters`` (TEXT, JSON list of public keys,
    default ``[]``) holds the tracked repeaters whose clock may be set during a
    telemetry cycle. Empty by default, so nothing is sent until a repeater is
    opted in.

    Idempotent: skips an absent table or columns that already exist.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    for table, column, ddl in (
        ("advert_events", "sender_timestamp", "INTEGER"),
        ("app_settings", "clock_sync_repeaters", "TEXT DEFAULT '[]'"),
    ):
        if table not in tables:
            continue
        col_cursor = await conn.execute(f"PRAGMA table_info({table})")
        if column not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

    await conn.commit()
