import logging

import aiosqlite

logger = logging.getLogger(__name__)

RETENTION_COLUMN = "relay_history_retention_days"
RETENTION_DEFAULT_DAYS = 365


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``relay_reception_hourly`` and its retention setting.

    Long-term per-relay history for the Mesh Health "Relay reception" tab.
    ``packet_receptions`` keeps one row per received copy and is pruned after
    ``packet_reception_retention_days`` (default 2); before that prune, every
    complete hour is folded into one row per (hour, relay) here by
    ``app/services/relay_reception.py::rollup_relay_history``. ``relay_hex`` is
    the delivering relay's last-hop hash, ``''`` = heard from the origin.
    ``first_arrivals`` and ``unique_packets`` are attributed to the hour of the
    packet's first copy.

    Also adds ``app_settings.relay_history_retention_days`` (default 365; 0
    keeps forever). Existing reception rows are folded in by the first rollup
    (run by the retention prune service). Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS relay_reception_hourly (
            hour_ts INTEGER NOT NULL,
            relay_hex TEXT NOT NULL,
            receptions INTEGER NOT NULL,
            packets INTEGER NOT NULL,
            first_arrivals INTEGER NOT NULL,
            unique_packets INTEGER NOT NULL,
            snr_sum REAL NOT NULL DEFAULT 0,
            snr_count INTEGER NOT NULL DEFAULT 0,
            snr_best REAL,
            rssi_sum INTEGER NOT NULL DEFAULT 0,
            rssi_count INTEGER NOT NULL DEFAULT 0,
            rssi_best INTEGER,
            last_seen INTEGER NOT NULL,
            PRIMARY KEY (hour_ts, relay_hex)
        )
        """
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
