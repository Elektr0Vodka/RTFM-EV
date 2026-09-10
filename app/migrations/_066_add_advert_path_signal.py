import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add best_rssi and best_snr columns to contact_advert_paths.

    Tracks the strongest signal observed on each unique advert path, enabling
    signal-ranked neighbor analysis (My Node historical stats) and map display.
    Idempotent: skips columns that already exist and skips entirely if the
    table is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "contact_advert_paths" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(contact_advert_paths)")
    existing = {row[1] for row in await col_cursor.fetchall()}
    for column in ("best_rssi", "best_snr"):
        if column not in existing:
            await conn.execute(f"ALTER TABLE contact_advert_paths ADD COLUMN {column} REAL")
            logger.debug("Added contact_advert_paths.%s", column)

    await conn.commit()
