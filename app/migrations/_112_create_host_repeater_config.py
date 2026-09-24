import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``host_repeater_config``: the host repeater settings document (plan 29).

    One row (``id = 1``) holding the whole settings document as JSON plus a
    ``version`` counter that the API uses for optimistic concurrency, so two
    browsers cannot silently overwrite each other's edits. No row means
    defaults (everything off). Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS host_repeater_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            version INTEGER NOT NULL,
            settings TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
