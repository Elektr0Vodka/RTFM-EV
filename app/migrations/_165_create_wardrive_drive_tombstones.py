import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Retired wardrive drive uids (``MESHCORE_WARDRIVE``).

    A page's queue can still hold rows of a drive the driver deleted, merged
    or split. ``kind`` 'deleted': rows of that uid up to ``until_ts`` (the
    drive's end) are dropped, later ones start a drive again. ``kind``
    'retired' (merged away or split): rows of that uid join a drive by the
    10-minute gap rule, as rows without a uid do. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_drive_tombstones (
            uid TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            radio_key TEXT NOT NULL,
            kind TEXT NOT NULL,
            until_ts INTEGER,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
