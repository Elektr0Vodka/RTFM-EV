import aiosqlite

RETENTION_COLUMN = "wardrive_retention_days"


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create the wardrive plugin tables (``MESHCORE_WARDRIVE``).

    Wardrive accounts are separate from the main login. A radio joins an
    account by signing a challenge; ``wardrive_radios.public_key`` is the
    radio's key in upper case and belongs to one account. ``wardrive_obs`` and
    ``wardrive_tracks`` hold the local copy of what drivers' radios heard,
    in the DutchMeshCore wardrive obs/track shape, keyed so a re-sent upload
    is a no-op. Also adds ``app_settings.wardrive_retention_days`` (0 keeps
    forever). The tables exist whether or not the module is on. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            visibility TEXT NOT NULL DEFAULT 'own'
                CHECK (visibility IN ('own', 'groups', 'all')),
            disabled INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_radios (
            public_key TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            name TEXT,
            added_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_wardrive_radios_user ON wardrive_radios (user_id)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_group_members (
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY (group_id, user_id)
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_obs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            radio_key TEXT NOT NULL,
            rx_at TEXT NOT NULL,
            rx_ts INTEGER NOT NULL,
            pub_at TEXT,
            hash TEXT NOT NULL,
            raw TEXT NOT NULL,
            len INTEGER,
            packet_type INTEGER,
            route TEXT,
            payload_len INTEGER,
            path TEXT,
            rssi REAL,
            snr REAL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            accuracy REAL,
            src TEXT,
            uploaded_at INTEGER NOT NULL,
            UNIQUE (radio_key, rx_at, hash)
        )
        """
    )
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_wardrive_obs_rx_ts ON wardrive_obs (rx_ts)")
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_wardrive_obs_user_rx_ts ON wardrive_obs (user_id, rx_ts)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            radio_key TEXT NOT NULL,
            t0 TEXT NOT NULL,
            t1 TEXT NOT NULL,
            t0_ts INTEGER NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            accuracy REAL,
            rx_count INTEGER NOT NULL,
            listening INTEGER NOT NULL,
            src TEXT,
            uploaded_at INTEGER NOT NULL,
            UNIQUE (radio_key, t0)
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_wardrive_tracks_t0_ts ON wardrive_tracks (t0_ts)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_wardrive_tracks_user_t0_ts "
        "ON wardrive_tracks (user_id, t0_ts)"
    )

    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" in {row[0] for row in await tables_cursor.fetchall()}:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        if RETENTION_COLUMN not in columns:
            await conn.execute(
                f"ALTER TABLE app_settings ADD COLUMN {RETENTION_COLUMN} INTEGER NOT NULL DEFAULT 0"
            )
    await conn.commit()
