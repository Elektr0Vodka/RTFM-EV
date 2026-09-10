import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create noise_floor_samples for persisted 24h+ noise-floor history.

    RT samples the noise floor into an in-memory deque; this table persists
    those samples so history survives restarts and can be queried over a range
    (My Node / MeshHealth analytics). Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS noise_floor_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            noise_floor_dbm INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_noise_floor_samples_timestamp "
        "ON noise_floor_samples(timestamp)"
    )
    await conn.commit()
