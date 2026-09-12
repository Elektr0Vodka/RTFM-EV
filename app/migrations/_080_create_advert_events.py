import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create advert_events + add app_settings.advert_retention_days.

    advert_events holds one row per unique advert transmission (deduped across
    paths). transmission_id is the primary copy's raw_packets.id; NULL for
    backfilled rows. min_path_len is the smallest hop count seen across copies
    (0 = heard direct). Backfill seeds one approximate event per existing
    contact_advert_paths row. Idempotent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    # advert_events table + indexes.
    if "advert_events" not in tables:
        await conn.execute(
            """
            CREATE TABLE advert_events (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                transmission_id INTEGER,
                public_key      TEXT NOT NULL,
                first_seen      INTEGER NOT NULL,
                min_path_len    INTEGER NOT NULL,
                path_hex        TEXT,
                hop_width       INTEGER
            )
            """
        )
        await conn.execute(
            "CREATE UNIQUE INDEX ux_advert_events_txid ON advert_events(transmission_id)"
        )
        await conn.execute(
            "CREATE INDEX ix_advert_events_pk_seen ON advert_events(public_key, first_seen)"
        )
        await conn.execute("CREATE INDEX ix_advert_events_seen ON advert_events(first_seen)")

        # Approximate backfill from contact_advert_paths (per-path, not per-transmission).
        if "contact_advert_paths" in tables:
            async with conn.execute(
                """
                SELECT public_key, path_hex, path_len,
                       COALESCE(last_primary_seen, first_seen) AS seen
                FROM contact_advert_paths
                """
            ) as cur:
                rows = await cur.fetchall()
            for row in rows:
                path_hex = row["path_hex"] or ""
                path_len = row["path_len"] or 0
                hop_width = None
                if path_len > 0 and path_hex:
                    hex_per_hop = len(path_hex) // path_len
                    if hex_per_hop > 0:
                        hop_width = hex_per_hop // 2
                await conn.execute(
                    """
                    INSERT INTO advert_events
                        (transmission_id, public_key, first_seen, min_path_len, path_hex, hop_width)
                    VALUES (NULL, ?, ?, ?, ?, ?)
                    """,
                    (row["public_key"], row["seen"], path_len, path_hex, hop_width),
                )

    # app_settings.advert_retention_days (default 30 days).
    if "app_settings" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        existing = {row[1] for row in await col_cursor.fetchall()}
        if "advert_retention_days" not in existing:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN advert_retention_days INTEGER DEFAULT 30"
            )

    await conn.commit()
