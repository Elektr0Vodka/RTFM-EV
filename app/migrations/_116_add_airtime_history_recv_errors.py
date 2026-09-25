import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``recv_errors`` to ``airtime_history``.

    The radio stats sampler already polls the companion's ``STATS_PACKETS``
    frame every 60 s; firmware v1.12+ appends the cumulative
    ``n_recv_errors`` counter (``radio_driver.getPacketsRecvErrors()``) to it.
    Persisting it next to the airtime counters lets My Node draw a receive-error
    graph (parity-audit L2). NULL for samples taken from older firmware or
    before this migration; per-bin counts are derived from deltas at query time.

    Idempotent: skips when the column already exists or the table is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "airtime_history" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(airtime_history)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "recv_errors" not in columns:
        await conn.execute("ALTER TABLE airtime_history ADD COLUMN recv_errors INTEGER")
        logger.info("Added airtime_history.recv_errors")
    await conn.commit()
