import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``analyzer_resolved_names``: the plan 16 case (a) name-resolution cache.

    One row per full public key RTFM-EV asked a configured analyzer about:
    the name it answered (NULL = queried, no name; cached so a miss is not
    re-asked on every click), which analyzer site answered and when. Names
    found in the locally synced analyzer directory (``external_map_nodes``)
    are not cached here, they are read from that table directly. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS analyzer_resolved_names (
            pubkey TEXT PRIMARY KEY,
            resolved_name TEXT,
            source_site TEXT NOT NULL,
            resolved_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
