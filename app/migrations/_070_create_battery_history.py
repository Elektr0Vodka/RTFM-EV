import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create battery_history for persisted battery voltage samples.

    Persists periodic battery-voltage readings so battery history survives
    restarts and can be queried over a range (My Node analytics). Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS battery_history (
            timestamp INTEGER NOT NULL,
            battery_mv INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_battery_history_timestamp ON battery_history(timestamp)"
    )
    await conn.commit()
