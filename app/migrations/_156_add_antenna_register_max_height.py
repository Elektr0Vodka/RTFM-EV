import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``antenna_register_sites.max_height_m``: the site's highest antenna.

    Height in metres from ground level to the antenna centre, as registered.
    The map's 3D view draws each mast up to this height, so it travels with the
    site summary instead of the transmitter JSON. Existing rows are backfilled
    from that JSON; the next sync writes it directly.

    Idempotent: skips an existing column or an absent table.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}
    if "antenna_register_sites" in tables:
        cursor = await conn.execute("PRAGMA table_info(antenna_register_sites)")
        columns = {row[1] for row in await cursor.fetchall()}
        if "max_height_m" not in columns:
            await conn.execute("ALTER TABLE antenna_register_sites ADD COLUMN max_height_m REAL")
            await conn.execute(
                """
                UPDATE antenna_register_sites
                SET max_height_m = (
                    SELECT MAX(json_extract(value, '$.height_m'))
                    FROM json_each(antenna_register_sites.transmitters)
                )
                """
            )
    await conn.commit()
