import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Full capture (meshcomod): damaged frames and the saved switch.

    ``rx_bad_frames`` keeps frames a meshcomod companion received with a CRC or
    header error. They stay out of ``raw_packets`` and every pipeline built on
    it. ``app_settings.full_capture_flags`` holds which kinds of frames the
    radio is asked to pass on (RTFM-EV sends it again on every connect).

    Idempotent: guards the table and the column.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rx_bad_frames (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            status INTEGER NOT NULL,
            length INTEGER NOT NULL,
            rssi INTEGER,
            snr REAL,
            data BLOB NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_rx_bad_frames_timestamp ON rx_bad_frames (timestamp)"
    )

    tables = await (
        await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    ).fetchall()
    if "app_settings" in {row[0] for row in tables}:
        columns = {
            row[1]
            for row in await (await conn.execute("PRAGMA table_info(app_settings)")).fetchall()
        }
        if "full_capture_flags" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN full_capture_flags INTEGER NOT NULL DEFAULT 0"
            )

    await conn.commit()
