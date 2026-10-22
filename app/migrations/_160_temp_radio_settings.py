import aiosqlite

_STAMP_COLUMNS = (
    ("radio_freq", "REAL"),
    ("radio_bw", "REAL"),
    ("radio_sf", "INTEGER"),
    ("radio_cr", "INTEGER"),
)


async def _add_missing(conn: aiosqlite.Connection, table: str, columns) -> None:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    existing = {row[1] for row in await cursor.fetchall()}
    for name, ddl in columns:
        if name not in existing:
            await conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


async def migrate(conn: aiosqlite.Connection) -> None:
    """Temporary radio settings for the companion, SF stamps and SF filters.

    - ``app_settings.temp_radio_state``: JSON of the active temporary session
      (original + temporary settings, expiry, opt-ins); NULL = no session.
    - ``app_settings.hidden_radio_sfs``: JSON array of SFs whose incoming
      messages the chat SF filter hides (0 = rows without a stamp).
    - ``raw_packets`` / ``messages``: the radio settings the row was heard or
      sent on (``radio_freq`` MHz, ``radio_bw`` kHz, ``radio_sf``, ``radio_cr``);
      NULL for rows from before this migration.
    - ``contact_radio_sightings``: every settings set a contact was heard on.
    - ``contact_radio_profiles``: saved per-contact settings + auto switch.
    - ``radio_scan_lists``: user lists of settings to cycle through.

    Idempotent: adds only missing columns, ``CREATE TABLE IF NOT EXISTS``, and
    skips column changes for tables that do not exist.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    if "app_settings" in tables:
        await _add_missing(
            conn,
            "app_settings",
            (
                ("temp_radio_state", "TEXT"),
                ("hidden_radio_sfs", "TEXT NOT NULL DEFAULT '[]'"),
            ),
        )
    for table in ("raw_packets", "messages"):
        if table in tables:
            await _add_missing(conn, table, _STAMP_COLUMNS)

    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS contact_radio_sightings (
            public_key TEXT NOT NULL,
            freq REAL NOT NULL,
            bw REAL NOT NULL,
            sf INTEGER NOT NULL,
            cr INTEGER NOT NULL,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            PRIMARY KEY (public_key, freq, bw, sf, cr)
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS contact_radio_profiles (
            public_key TEXT PRIMARY KEY,
            freq REAL NOT NULL,
            bw REAL NOT NULL,
            sf INTEGER NOT NULL,
            cr INTEGER NOT NULL,
            region TEXT,
            duration_secs INTEGER NOT NULL,
            auto_switch INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS radio_scan_lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            entries TEXT NOT NULL,
            rounds INTEGER NOT NULL DEFAULT 0,
            normal_between_secs INTEGER NOT NULL DEFAULT 0,
            hold_on_activity_secs INTEGER NOT NULL DEFAULT 0,
            opt_ins TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
