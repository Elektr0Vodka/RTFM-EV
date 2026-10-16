import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create the meshcomod companion receive filter tables.

    ``companion_filter_history`` holds the radio's cumulative hidden counters
    (``filter`` summary) from the 60s stats sampler, per radio (plan 18). The
    counters live in RAM on the radio, so readers turn them into per-interval
    deltas and treat a drop as a restart.

    ``companion_filter_backups`` keeps the last filter settings read from each
    radio (JSON), so they can be written back after a flash or ``filter reset``.
    ``truncated`` is 1 when a list on the radio did not fit in its CLI reply and
    the backup may miss entries. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS companion_filter_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            malformed INTEGER NOT NULL,
            age INTEGER NOT NULL,
            path INTEGER NOT NULL,
            sender INTEGER NOT NULL,
            text INTEGER NOT NULL,
            radio_identity_id INTEGER
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_companion_filter_history_timestamp "
        "ON companion_filter_history (timestamp)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS companion_filter_backups (
            radio_identity_id INTEGER PRIMARY KEY,
            config TEXT NOT NULL,
            truncated INTEGER NOT NULL DEFAULT 0,
            saved_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
