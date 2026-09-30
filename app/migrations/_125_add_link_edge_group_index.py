import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add a covering index for the traffic-links window aggregation.

    ``LinkEdgesRepository.window_edges`` groups link_edge_events by
    (a_pubkey, b_pubkey, hop_width) over a ts window. Without this index SQLite
    walks ix_link_edge_events_edge_ts and fetches every table row, which is
    random I/O across the whole table. With every referenced column in the
    index the query never touches the table. Idempotent.
    """
    cur = await conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='link_edge_events'"
    )
    if await cur.fetchone() is None:
        return
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS ix_link_edge_events_group ON link_edge_events"
        "(a_pubkey, b_pubkey, hop_width, ts, raw_packet_id, confidence)"
    )
