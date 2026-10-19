import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create the tracker tables (ATAK users and MeshCore SAR fast-GPS beacons).

    ``tracker_positions`` keeps every decoded position fix (the map draws the
    newest per ``(source, identity)``, or a trail). ``tracker_objects`` keeps
    the newest version of each map object (CoT event) an ATAK user shared,
    keyed by its uid. Both age out with the device-history retention setting.
    Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tracker_positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            identity TEXT NOT NULL,
            display_name TEXT,
            team TEXT,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            alt_m REAL,
            speed_mps REAL,
            course_deg REAL,
            battery_pct INTEGER,
            cot_uid TEXT,
            channel_key TEXT,
            packet_id INTEGER,
            path_len INTEGER,
            received_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracker_positions_source_identity_time "
        "ON tracker_positions (source, identity, received_at)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracker_positions_time ON tracker_positions (received_at)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tracker_objects (
            uid TEXT PRIMARY KEY,
            cot_type TEXT NOT NULL,
            callsign TEXT,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            remarks TEXT,
            stale_at INTEGER,
            sender TEXT,
            channel_key TEXT,
            received_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracker_objects_time ON tracker_objects (received_at)"
    )
    await conn.commit()
