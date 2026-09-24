import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create the per-packet link edge log and its backfill cursor.

    link_edge_events holds one row per resolved undirected node pair per stored
    packet (raw_packets.id). The UNIQUE index makes repeated copies and the
    backfill idempotent. link_edge_backfill_state records which pre-existing
    raw_packets ids still need resolving (next_id..end_id); live ingest covers
    everything after end_id. Also adds app_settings.link_edge_retention_days
    (default 365, 0 = keep forever). Idempotent.
    """
    cur = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await cur.fetchall()}

    if "link_edge_events" not in tables:
        await conn.execute(
            """
            CREATE TABLE link_edge_events (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                raw_packet_id INTEGER NOT NULL,
                ts            INTEGER NOT NULL,
                a_pubkey      TEXT NOT NULL,
                b_pubkey      TEXT NOT NULL,
                hop_width     INTEGER NOT NULL,
                payload_type  TEXT,
                route_type    TEXT,
                confidence    TEXT NOT NULL,
                snr           REAL,
                rssi          INTEGER
            )
            """
        )
        await conn.execute(
            "CREATE UNIQUE INDEX ux_link_edge_events_pkt_edge "
            "ON link_edge_events(raw_packet_id, a_pubkey, b_pubkey, hop_width)"
        )
        await conn.execute("CREATE INDEX ix_link_edge_events_ts ON link_edge_events(ts)")
        await conn.execute(
            "CREATE INDEX ix_link_edge_events_edge_ts ON link_edge_events(a_pubkey, b_pubkey, ts)"
        )

    if "link_edge_backfill_state" not in tables:
        await conn.execute(
            """
            CREATE TABLE link_edge_backfill_state (
                id      INTEGER PRIMARY KEY CHECK (id = 1),
                next_id INTEGER NOT NULL,
                end_id  INTEGER NOT NULL
            )
            """
        )
        end_id = 0
        if "raw_packets" in tables:
            cur = await conn.execute("SELECT COALESCE(MAX(id), 0) FROM raw_packets")
            row = await cur.fetchone()
            end_id = int(row[0]) if row else 0
        await conn.execute(
            "INSERT INTO link_edge_backfill_state (id, next_id, end_id) VALUES (1, 1, ?)",
            (end_id,),
        )

    if "app_settings" in tables:
        cur = await conn.execute("PRAGMA table_info(app_settings)")
        columns = {row[1] for row in await cur.fetchall()}
        if "link_edge_retention_days" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings "
                "ADD COLUMN link_edge_retention_days INTEGER NOT NULL DEFAULT 365"
            )

    await conn.commit()
