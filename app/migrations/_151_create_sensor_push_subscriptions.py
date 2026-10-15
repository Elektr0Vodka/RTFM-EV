import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``sensor_push_subscriptions`` (MeshCore 1.18 sensor telemetry push).

    One row per sensor contact. ``thresholds`` is the JSON list the user
    picked ({channel, type_name, min_delta}); ``push_tag`` is the 4-byte tag
    (8 hex chars, wire byte order) we gave the sensor in REQ_TYPE_SUBSCRIBE,
    the only way to tell which sensor a push came from. ``granted_until`` is
    our clock plus the expiry the sensor granted. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sensor_push_subscriptions (
            public_key TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 0,
            push_tag TEXT,
            thresholds TEXT NOT NULL DEFAULT '[]',
            granted_until INTEGER,
            scope_name TEXT,
            last_push_at INTEGER,
            last_attempt_at INTEGER,
            last_error TEXT,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sensor_push_tag ON sensor_push_subscriptions (push_tag)"
    )
    await conn.commit()
