import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create airtime_history for persisted cumulative TX/RX airtime counters.

    Persists the tx_air_secs/rx_air_secs counters from the STATS_RADIO frame so
    airtime-utilization history survives restarts and can be queried over a
    range (My Node airtime chart). Values are cumulative-from-boot seconds;
    utilization % is derived at query time from deltas. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS airtime_history (
            timestamp INTEGER NOT NULL,
            tx_air_secs INTEGER NOT NULL,
            rx_air_secs INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_airtime_history_timestamp ON airtime_history(timestamp)"
    )
    await conn.commit()
