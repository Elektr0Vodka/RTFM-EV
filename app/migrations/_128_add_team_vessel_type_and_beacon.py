import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add the MeshCore TEAM columns: a contact vessel type and the beacon settings.

    ``contacts.vessel_type`` (nullable TEXT): a hand-set vessel type that picks
    the icon of the contact's TEAM beacons on the map. NULL means none. A TEAM
    or signalk-meshcore beacon carries no vessel type, so nothing detects it.
    Follows the ``power_source`` pattern (migration _126): absent from the
    radio-sync upsert, written only by ``set_annotations``. Allowed values are
    in ``app.models.VesselType``; validation happens in the API layer.

    ``app_settings.team_beacon`` (JSON TEXT, default '{}'): the periodic
    ``#TEL:`` beacon settings (``app.models.TeamBeaconSettings``). An empty
    object means off.

    Idempotent: skips a column that already exists or a table that is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    if "contacts" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(contacts)")
        if "vessel_type" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute("ALTER TABLE contacts ADD COLUMN vessel_type TEXT")

    if "app_settings" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        if "team_beacon" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN team_beacon TEXT NOT NULL DEFAULT '{}'"
            )

    await conn.commit()
