import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``fleet_asset_events``, the log of a fleet asset.

    ``kind`` is ``placement``, ``maintenance``, ``failure``, ``custody``,
    ``firmware``, ``note`` (written by a person, with ``summary`` and optional
    ``detail``) or ``status`` (written by the app). ``status`` and ``custody``
    rows the app writes on a change carry the old and new value in
    ``from_value`` / ``to_value`` and no summary. ``actor`` is free text: the
    app has no user accounts to point at.

    Rows go with their asset (ON DELETE CASCADE).

    Idempotent: IF NOT EXISTS on the table and the index.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fleet_asset_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER NOT NULL REFERENCES fleet_assets(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            occurred_at INTEGER NOT NULL,
            summary TEXT,
            detail TEXT,
            actor TEXT,
            from_value TEXT,
            to_value TEXT,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fleet_asset_events_asset "
        "ON fleet_asset_events (asset_id, kind, occurred_at)"
    )
    await conn.commit()
