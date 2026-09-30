import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add a per-contact power source override.

    ``contacts.power_source`` (nullable TEXT): NULL means "auto", so the
    frontend detects the power source from the node name (DTIS prefix or power
    emoji, see ``frontend/src/utils/powerSource.ts``). A set value wins over
    that detection. Follows the ``battery_chemistry`` pattern (migration _108):
    absent from the radio-sync upsert, written only by ``set_annotations``.

    Allowed values: 'mains', 'battery', 'solar', 'solar_battery', 'unknown'
    (see ``app.models.ContactAnnotationsUpdate``). No CHECK constraint;
    validation happens in the API layer.

    Idempotent: skips a column that already exists or a table that is absent.
    """
    tables_cursor = await conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='contacts'"
    )
    if await tables_cursor.fetchone() is None:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(contacts)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "power_source" not in columns:
        await conn.execute("ALTER TABLE contacts ADD COLUMN power_source TEXT")

    await conn.commit()
