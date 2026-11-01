import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Wardrive owner settings served to drivers (``MESHCORE_WARDRIVE``).

    ``wardrive_config`` is a small key/value store: ``value`` holds JSON. The
    first key is ``hashtag_channels``, the hashtag channel names drivers may
    decode (names only; drivers derive the keys). Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
