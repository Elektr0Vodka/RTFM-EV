import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add nullable ``telemetry_perms`` to ``contacts``.

    Per-contact telemetry sharing permissions set in the app, as the firmware's
    TELEM_PERM_* bits (0x01 base/battery, 0x02 location, 0x04 environment).
    The radio stores them in ``contact.flags`` shifted left by one (bit 0 is the
    radio favourite bit). NULL means "never set in the app": the radio's flags
    are left alone. A non-NULL value is authoritative and is re-applied to the
    radio whenever the radio's copy differs.

    Idempotent: skips if the column exists or ``contacts`` is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "contacts" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(contacts)")
    columns = {row[1] for row in await col_cursor.fetchall()}
    if "telemetry_perms" not in columns:
        await conn.execute("ALTER TABLE contacts ADD COLUMN telemetry_perms INTEGER")

    await conn.commit()
