import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``host_repeater_stats``: long-run host repeater counters (plan 29, Phase 4).

    One row (``id = 1``) holding the lifetime shadow/armed decision totals as JSON,
    the time they started accumulating and how many server runs contributed, so the
    Settings > Host repeater statistics survive a restart. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS host_repeater_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            since INTEGER NOT NULL,
            runs INTEGER NOT NULL DEFAULT 1,
            stats TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
