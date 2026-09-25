import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``contact_path_outcomes``: per-route direct-message outcomes (plan 28 item 1.15).

    One row per ``(contact, path, hop count)`` a DM was sent on (``path_len`` -1 =
    flood, 0 = direct neighbour): attempts, successes, failures, trip times and a
    meshcore-open style route weight. Read by the contact analytics endpoint,
    which scores and ranks them for display. Rows follow the contact on delete.
    Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS contact_path_outcomes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key TEXT NOT NULL REFERENCES contacts(public_key) ON DELETE CASCADE,
            path_hex TEXT NOT NULL DEFAULT '',
            path_len INTEGER NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            success_count INTEGER NOT NULL DEFAULT 0,
            failure_count INTEGER NOT NULL DEFAULT 0,
            route_weight REAL NOT NULL DEFAULT 1.0,
            last_trip_ms INTEGER,
            best_trip_ms INTEGER,
            first_used INTEGER NOT NULL,
            last_used INTEGER NOT NULL,
            last_success INTEGER,
            UNIQUE(public_key, path_hex, path_len)
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_contact_path_outcomes_contact "
        "ON contact_path_outcomes(public_key, last_used DESC)"
    )
    await conn.commit()
