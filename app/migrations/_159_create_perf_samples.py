import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Performance page history: one row per minute of backend self-monitoring.

    ``ts`` is the minute start (unix seconds). Latency columns are in
    milliseconds and hold the worst 10-second p95 / max of that minute;
    ``pkts`` is packets per minute, ``stalls`` and ``warnings`` are counts.
    The sampler (``app/perf/sampler.py``) prunes rows older than 30 days.

    Idempotent: ``CREATE TABLE IF NOT EXISTS``.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS perf_samples (
            ts INTEGER PRIMARY KEY,
            cpu REAL,
            rss_mb REAL,
            lag_p50 REAL,
            lag_p95 REAL,
            lag_max REAL,
            tasks INTEGER,
            pkts REAL,
            db_p95 REAL,
            radio_p95 REAL,
            http_p95 REAL,
            stalls INTEGER,
            warnings INTEGER
        )
        """
    )
    await conn.commit()
