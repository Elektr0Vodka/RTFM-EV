import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``fleet_assets``, the fleet asset register.

    One row per device the operator keeps track of. It holds what only the
    operator knows (serials, MAC addresses, who has it, where it is placed);
    what the mesh reports (name, type, last seen, position) stays in
    ``contacts`` and is read at display time.

    ``public_key`` (64 hex, lower case) is optional and unique when set. There
    is no foreign key on purpose: an asset can exist before its node was ever
    heard (a device still in a box) and it outlives a deleted contact.

    ``status`` is ``in_stock``, ``deployed``, ``maintenance``, ``lost``,
    ``stolen`` or ``retired``.

    Idempotent: IF NOT EXISTS on the table.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fleet_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key TEXT UNIQUE,
            label TEXT,
            org_serial TEXT,
            hw_serial TEXT,
            model TEXT,
            role TEXT,
            wifi_mac TEXT,
            ble_mac TEXT,
            assigned_to TEXT,
            site_name TEXT,
            status TEXT NOT NULL DEFAULT 'in_stock',
            notes TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
