import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``fleet_assets.target_firmware`` and the ``fleet_settings`` row.

    ``target_firmware`` (nullable TEXT): the firmware version this device is
    meant to run. The Fleet page compares it with the version the node last
    reported.

    ``fleet_settings`` holds one row (id 1) with the thresholds of the "needs
    attention" filter: ``silent_hours`` (a deployed node not seen for longer)
    and ``low_battery_volts`` (a stored battery reading below it).

    Idempotent: the column is skipped when present or when ``fleet_assets`` is
    absent; the table uses IF NOT EXISTS and the row INSERT OR IGNORE.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "fleet_assets" in {row[0] for row in await tables_cursor.fetchall()}:
        col_cursor = await conn.execute("PRAGMA table_info(fleet_assets)")
        if "target_firmware" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute("ALTER TABLE fleet_assets ADD COLUMN target_firmware TEXT")

    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fleet_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            silent_hours INTEGER NOT NULL DEFAULT 48,
            low_battery_volts REAL NOT NULL DEFAULT 3.5
        )
        """
    )
    await conn.execute("INSERT OR IGNORE INTO fleet_settings (id) VALUES (1)")
    await conn.commit()
