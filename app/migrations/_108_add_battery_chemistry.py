import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add battery chemistry settings: a global default and a per-contact override.

    ``app_settings.battery_chemistry`` (TEXT NOT NULL DEFAULT 'lipo') is the
    global default, stored server-side so it is consistent across browsers
    rather than kept in ``localStorage`` like most other local display
    preferences.

    ``contacts.battery_chemistry`` (nullable TEXT) is a per-node override:
    NULL means "use the global default", matching the ``telemetry_perms``
    convention (migration _106).

    Allowed values: 'lipo', 'lifepo4', 'lipo_hv', 'nmc' (see
    ``app.models.BATTERY_CHEMISTRIES``). The column itself has no CHECK
    constraint (consistent with other enum-like text columns in this schema);
    validation happens in the API layer.

    Idempotent: skips a column that already exists or a table that is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    if "contacts" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(contacts)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        if "battery_chemistry" not in columns:
            await conn.execute("ALTER TABLE contacts ADD COLUMN battery_chemistry TEXT")

    if "app_settings" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        if "battery_chemistry" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN battery_chemistry TEXT NOT NULL DEFAULT 'lipo'"
            )

    await conn.commit()
