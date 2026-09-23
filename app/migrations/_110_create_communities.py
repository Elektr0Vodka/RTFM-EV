import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create the communities table (meshcore-open communities).

    One row per joined community: ``id`` is the one-way community ID
    (hex SHA256("community:v1" || secret)) and ``secret`` is the 32-byte shared
    secret the channel keys are derived from. The secret is stored so more
    community hashtag channels can be added later. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS communities (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            secret     BLOB NOT NULL,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
