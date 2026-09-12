import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``external_map_nodes`` for nodes synced from an external analyzer.

    A local cache of located nodes pulled from an external map/analyzer API
    (e.g. the EU MeshCore Analyzer ``/api/nodes`` directory) so the map can
    overlay nodes RTFM-EV has not heard itself. Keyed by ``pubkey`` for upsert /
    full-refresh replacement. Only located nodes (lat/lon present) are stored.
    Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS external_map_nodes (
            pubkey TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT '',
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            last_seen INTEGER,
            advert_count INTEGER NOT NULL DEFAULT 0,
            mobile INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT '',
            synced_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_external_map_nodes_bbox ON external_map_nodes(lat, lon)"
    )
    await conn.commit()
