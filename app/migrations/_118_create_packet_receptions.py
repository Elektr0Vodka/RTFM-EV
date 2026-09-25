import logging

import aiosqlite

logger = logging.getLogger(__name__)

RETENTION_COLUMN = "packet_reception_retention_days"
RETENTION_DEFAULT_DAYS = 2


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``packet_receptions`` (plan 21 S1) and its retention setting.

    One row per physical reception of a flood-routed packet copy, written even
    when ``raw_packets`` deduplicates the payload: which relay delivered the
    copy (the last path hop), the signal our radio measured for it, when, and
    the payload hash that groups copies of the same packet. Direct-routed
    packets are not recorded (their path is popped hop by hop, so the last
    chunk is not the delivering relay).

    Also adds ``app_settings.packet_reception_retention_days`` (default 2 = 48 h;
    0 keeps forever). The table is one row per copy, so it is pruned tightly by
    default. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS packet_receptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_packet_id INTEGER,
            payload_hash BLOB NOT NULL,
            observed_at INTEGER NOT NULL,
            snr REAL,
            rssi INTEGER,
            payload_type TEXT NOT NULL,
            route_type TEXT NOT NULL,
            hop_count INTEGER NOT NULL,
            hash_size INTEGER NOT NULL,
            last_hop_hex TEXT,
            path_hex TEXT
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_packet_receptions_observed "
        "ON packet_receptions(observed_at DESC)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_packet_receptions_hash ON packet_receptions(payload_hash)"
    )

    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" in {row[0] for row in await tables_cursor.fetchall()}:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        if RETENTION_COLUMN not in columns:
            await conn.execute(
                f"ALTER TABLE app_settings ADD COLUMN {RETENTION_COLUMN} "
                f"INTEGER NOT NULL DEFAULT {RETENTION_DEFAULT_DAYS}"
            )
    await conn.commit()
