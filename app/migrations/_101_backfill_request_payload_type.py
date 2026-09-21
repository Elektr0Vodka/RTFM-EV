import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Relabel REQUEST packets that were mis-stored as ``"Unknown"``.

    ``raw_packets.payload_type`` is written at ingest from ``PayloadType.name``.
    A bug guarded that on ``if payload_type`` - but ``PayloadType.REQUEST`` is
    ``0x00`` (falsy), so every request was persisted as ``"Unknown"`` instead of
    ``"REQUEST"``. That made the Packet History "Request" filter return nothing
    while the "Unknown" bucket surfaced them.

    A row was stored ``"Unknown"`` only when the packet did not parse *or* its
    payload type was REQUEST, so any ``"Unknown"`` row whose stored bytes now
    decode to REQUEST is exactly one the bug mislabelled. Re-decode those rows
    with the same parser used at ingest and relabel them; genuinely unparseable
    rows stay ``"Unknown"``. Idempotent; skips entirely if raw_packets is absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "raw_packets" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    from app.decoder import PayloadType, parse_packet

    async with conn.execute(
        "SELECT id, data FROM raw_packets WHERE payload_type = 'Unknown' AND data IS NOT NULL"
    ) as cursor:
        rows = await cursor.fetchall()

    relabelled = 0
    for row in rows:
        info = parse_packet(bytes(row[1]))
        if info is not None and info.payload_type is PayloadType.REQUEST:
            await conn.execute(
                "UPDATE raw_packets SET payload_type = 'REQUEST' WHERE id = ?",
                (row[0],),
            )
            relabelled += 1

    if relabelled:
        logger.info("Relabelled %d mislabelled REQUEST raw_packets rows", relabelled)

    await conn.commit()
