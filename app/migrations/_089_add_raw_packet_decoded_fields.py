import logging

import aiosqlite

logger = logging.getLogger(__name__)

_NEW_COLUMNS = [
    ("route_type", "TEXT"),
    ("hop_count", "INTEGER"),
    ("hop_byte_width", "INTEGER"),
    ("path_signature", "TEXT"),
]


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add decoded stat columns to raw_packets and backfill from stored bytes.

    Persists route type, hop count, hop byte width, and the routing path
    signature (parsed from the packet header, no decryption) so the Raw Packet
    Feed's stat breakdowns can be computed historically from the DB. Existing
    rows are backfilled by decoding their stored ``data`` blob with the same
    parser used at ingest. Idempotent; skips entirely if raw_packets is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "raw_packets" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(raw_packets)")
    existing = {row[1] for row in await col_cursor.fetchall()}
    for column, typedef in _NEW_COLUMNS:
        if column not in existing:
            await conn.execute(f"ALTER TABLE raw_packets ADD COLUMN {column} {typedef}")
            logger.debug("Added raw_packets.%s", column)

    # Backfill rows that predate these columns by decoding their raw bytes.
    from app.decoder import parse_packet
    from app.services.packet_decoded_fields import decoded_stat_fields

    async with conn.execute(
        "SELECT id, data FROM raw_packets WHERE route_type IS NULL AND data IS NOT NULL"
    ) as cursor:
        rows = await cursor.fetchall()

    for row in rows:
        fields = decoded_stat_fields(parse_packet(bytes(row[1])))
        await conn.execute(
            "UPDATE raw_packets SET route_type = ?, hop_count = ?, hop_byte_width = ?, "
            "path_signature = ? WHERE id = ?",
            (
                fields["route_type"],
                fields["hop_count"],
                fields["hop_byte_width"],
                fields["path_signature"],
                row[0],
            ),
        )

    await conn.commit()
