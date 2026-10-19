import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``antenna_register_sites``: the Dutch Antenneregister map cache.

    One row per antenna site from the public Antenneregister WFS that carries at
    least one antenna in the sub-GHz mobile bands next to the 868 MHz mesh band.
    ``transmitters`` holds them as a JSON array, one entry per system + frequency.
    Filled only by a manual sync (Settings), replaced in full each time.
    Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS antenna_register_sites (
            id INTEGER PRIMARY KEY,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            municipality TEXT NOT NULL DEFAULT '',
            postcode TEXT NOT NULL DEFAULT '',
            place TEXT NOT NULL DEFAULT '',
            kinds TEXT NOT NULL DEFAULT '',
            bands TEXT NOT NULL DEFAULT '',
            max_power_dbw REAL,
            transmitters TEXT NOT NULL DEFAULT '[]',
            synced_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_antenna_register_sites_bbox "
        "ON antenna_register_sites(lat, lon)"
    )
    await conn.commit()
