import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add rssi, snr, payload_type columns to raw_packets.

    Persists the signal metadata that previously flowed only through live
    events, so it can be queried historically (packet feed seeding, timeseries,
    My Node / MeshHealth analytics). Idempotent: skips columns that already
    exist and skips entirely if the table is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "raw_packets" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(raw_packets)")
    existing = {row[1] for row in await col_cursor.fetchall()}
    for column, typedef in [("rssi", "INTEGER"), ("snr", "REAL"), ("payload_type", "TEXT")]:
        if column not in existing:
            await conn.execute(f"ALTER TABLE raw_packets ADD COLUMN {column} {typedef}")
            logger.debug("Added raw_packets.%s", column)

    await conn.commit()
