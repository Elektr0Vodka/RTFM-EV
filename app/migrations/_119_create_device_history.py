import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create the two plan 14 history tables.

    ``contact_location_history``: append-on-change contact positions, same shape
    as ``contact_name_history`` (one row per distinct rounded lat/lon per
    contact, ``last_seen`` bumped on repeats). Fed by adverts and contact
    imports. ``device_config_history``: append-on-change snapshots of the
    repeater dashboard panes (node info, radio settings, advert intervals,
    owner info, regions) as JSON, keyed by ``kind``, capped per contact and
    kind by the repository. Rows follow the contact on delete. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS contact_location_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key TEXT NOT NULL REFERENCES contacts(public_key) ON DELETE CASCADE,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            UNIQUE(public_key, lat, lon)
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_contact_location_history_key "
        "ON contact_location_history(public_key, last_seen DESC)"
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS device_config_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key TEXT NOT NULL REFERENCES contacts(public_key) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            data TEXT NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_device_config_history_pk_kind_ts "
        "ON device_config_history(public_key, kind, timestamp DESC)"
    )
    await conn.commit()
