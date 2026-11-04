import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``antenna_test_runs`` for the Trace page's Antenna test.

    One row per finished test run: the antenna name the user typed, the radio
    it ran on, how many direct traces were sent per node, and the per-node
    trace outcomes as a JSON list (``results``). Reports are computed from
    ``results`` on read (``app.antenna_test_report``).

    Idempotent: ``CREATE ... IF NOT EXISTS``.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS antenna_test_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            antenna TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            radio_public_key TEXT,
            radio_name TEXT,
            traces_per_node INTEGER NOT NULL,
            started_at INTEGER NOT NULL,
            finished_at INTEGER NOT NULL,
            results TEXT NOT NULL DEFAULT '[]'
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_antenna_test_runs_started "
        "ON antenna_test_runs (started_at DESC)"
    )
    await conn.commit()
