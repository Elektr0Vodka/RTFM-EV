import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``radio_policy`` to ``contacts`` (default: ``'auto'``).

    Explicit per-contact control over radio residency, separate from the
    automatic recency-based sync selection and from the ``favorite`` flag:

    - ``auto`` (default): eligible for the recency-based fill, and for the
      favorite tier when favorited. Preserves existing behaviour.
    - ``pinned``: always loaded onto the radio, up to capacity, regardless of
      recency (joins the favorite tier in the sync selection).
    - ``excluded``: never loaded onto the radio (app-only), even if favorite or
      recently active.

    The legacy ``contacts.on_radio`` column is intentionally left untouched;
    it is stale metadata (cleared each offload/reload cycle) and is not the
    truth source for residency. Idempotent: skips if the column already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "contacts" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(contacts)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "radio_policy" not in columns:
        await conn.execute(
            "ALTER TABLE contacts ADD COLUMN radio_policy TEXT NOT NULL DEFAULT 'auto'"
        )

    await conn.commit()
