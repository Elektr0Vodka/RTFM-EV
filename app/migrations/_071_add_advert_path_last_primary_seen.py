import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add last_primary_seen to contact_advert_paths.

    Tracks the last time a path was the *primary* arrival of an advert (the
    first-heard unique transmission), not a relay copy. The mesh-health
    advert-count query uses this so relay copies are not counted as separate
    advert events. Idempotent; skips if the table is absent.

    Backfill: existing rows heard at least once (heard_count > 0) get
    last_primary_seen = last_seen as a best approximation; relay-only paths
    (heard_count = 0) stay NULL since they were never primary.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "contact_advert_paths" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(contact_advert_paths)")
    existing = {row[1] for row in await col_cursor.fetchall()}
    if "last_primary_seen" not in existing:
        await conn.execute(
            "ALTER TABLE contact_advert_paths ADD COLUMN last_primary_seen INTEGER"
        )
        await conn.execute(
            "UPDATE contact_advert_paths SET last_primary_seen = last_seen WHERE heard_count > 0"
        )

    await conn.commit()
