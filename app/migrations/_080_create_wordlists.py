import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``wordlists`` for user-uploaded channel-finder wordlists.

    Metadata only: the normalized word file lives on disk under
    ``<data_dir>/wordlists/<id>.txt``, never in the database. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wordlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            filename TEXT NOT NULL,
            entry_count INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
