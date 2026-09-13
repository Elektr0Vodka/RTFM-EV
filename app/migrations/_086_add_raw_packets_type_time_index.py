import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add a (payload_type, timestamp) index for the request-traffic window scan.

    The Mesh Health "Requests" panel scans raw_packets filtered by payload_type
    within a time window. A composite index lets SQLite range-scan per type
    instead of scanning the whole window and filtering.
    """
    cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await cursor.fetchall()}

    if "raw_packets" in tables:
        cursor = await conn.execute("PRAGMA table_info(raw_packets)")
        columns = {row[1] for row in await cursor.fetchall()}
        if {"payload_type", "timestamp"}.issubset(columns):
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_raw_packets_payload_type_timestamp "
                "ON raw_packets(payload_type, timestamp)"
            )
    await conn.commit()
