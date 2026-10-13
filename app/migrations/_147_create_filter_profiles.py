import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create the filter library tables.

    ``filter_profiles``: one row per saved profile. ``kind`` says what the
    profile holds (``spam_guard`` is the first kind) and decides the shape of
    ``payload`` (JSON). ``source`` is ``local`` for a profile made or imported
    on this installation.

    ``filter_profile_in_use``: the profile last applied, one row per kind.

    Idempotent: the tables and the index use IF NOT EXISTS.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS filter_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_filter_profiles_kind ON filter_profiles(kind)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS filter_profile_in_use (
            kind TEXT PRIMARY KEY,
            profile_id INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
