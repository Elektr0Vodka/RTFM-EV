import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create the fleet config library tables.

    ``fleet_configs``: one stored config document of a fleet asset. ``kind`` is
    ``snapshot`` (what the device had) or ``desired`` (what it should have).
    ``source`` says where it came from (``file``, ``template``; later phases
    add ``usb_browser``, ``usb_server``, ``webconfig``, ``manual``).
    ``profile`` is ``stock``, ``dmc_repeater``, ``dmc_observer`` or
    ``companion_v1``. ``document`` is the device's own file as JSON text with
    every secret replaced by ``{"$secret": <fleet_secrets id or null>}``: a
    secret value is never stored here. ``role``, ``firmware_version`` and
    ``label`` sit beside the document because the file formats have no place
    for them. A document is never changed after it is stored; a change is a
    new row. Rows go with their asset (ON DELETE CASCADE): they hold no
    secret, so nothing is lost that the vault does not keep.

    ``fleet_config_templates``: a document with ``{{name}}`` variables and no
    secret at all, plus its variable list as JSON (name, description, default,
    type). Not tied to an asset.

    Idempotent: IF NOT EXISTS on tables and the index.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fleet_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER NOT NULL REFERENCES fleet_assets(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            source TEXT NOT NULL,
            profile TEXT NOT NULL,
            role TEXT,
            firmware_version TEXT,
            label TEXT,
            document TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fleet_configs_asset ON fleet_configs (asset_id, created_at)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fleet_config_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            profile TEXT NOT NULL,
            role TEXT,
            document TEXT NOT NULL,
            variables TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
