import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``partial_node_resolutions`` for soft-linked partial-node identities.

    A soft, reversible link from a pubkey *prefix* (1/2/3 bytes = 2/4/6 hex chars)
    to a full pubkey matched from the external-map cache. It lets nodes we only
    hold partial info for (prefix-only placeholder contacts, or hop hashes seen in
    paths but never heard via a full advert) show resolved name/location without
    writing a guess into the authoritative ``contacts`` table. Keyed by
    ``prefix_hex`` for upsert; clearing a resolution deletes the row. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS partial_node_resolutions (
            prefix_hex TEXT PRIMARY KEY,
            resolved_pubkey TEXT NOT NULL,
            resolved_name TEXT,
            source TEXT NOT NULL DEFAULT 'external_map',
            confidence REAL NOT NULL DEFAULT 0,
            candidate_count INTEGER NOT NULL DEFAULT 0,
            resolved_by TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    await conn.commit()
