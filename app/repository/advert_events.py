from app.database import db


class AdvertEventRepository:
    """One row per unique advert transmission (deduped across paths).

    transmission_id is the primary copy's raw_packets.id; all copies of a
    payload share it, so it is the dedup key. min_path_len is the smallest hop
    count seen across copies (0 = direct). record() is called on every advert
    reception so a later direct copy can lower min_path_len to 0.
    """

    @staticmethod
    def _hop_width(path_len: int, path_hex: str) -> int | None:
        if path_len > 0 and path_hex:
            hex_per_hop = len(path_hex) // path_len
            if hex_per_hop > 0:
                return hex_per_hop // 2
        return None

    @staticmethod
    async def record(
        transmission_id: int,
        public_key: str,
        timestamp: int,
        path_len: int,
        path_hex: str,
    ) -> None:
        normalized_key = public_key.lower()
        normalized_path = (path_hex or "").lower()
        hop_width = AdvertEventRepository._hop_width(path_len, normalized_path)
        async with db.tx() as conn:
            await conn.execute(
                """
                INSERT INTO advert_events
                    (transmission_id, public_key, first_seen, min_path_len, path_hex, hop_width)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(transmission_id) DO UPDATE SET
                    path_hex = CASE
                        WHEN excluded.min_path_len < advert_events.min_path_len
                        THEN excluded.path_hex ELSE advert_events.path_hex END,
                    hop_width = CASE
                        WHEN excluded.min_path_len < advert_events.min_path_len
                        THEN excluded.hop_width ELSE advert_events.hop_width END,
                    min_path_len = MIN(advert_events.min_path_len, excluded.min_path_len),
                    first_seen = MIN(advert_events.first_seen, excluded.first_seen)
                """,
                (transmission_id, normalized_key, timestamp, path_len, normalized_path, hop_width),
            )

    @staticmethod
    async def mesh_health_rows(start_ts: int, end_ts: int) -> list[dict]:
        """Per-contact direct/flood aggregation over [start_ts, end_ts)."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT
                    ae.public_key AS public_key,
                    MIN(ae.first_seen) AS first_seen,
                    MAX(ae.first_seen) AS last_event,
                    MIN(ae.min_path_len) AS min_path_len,
                    SUM(CASE WHEN ae.min_path_len = 0 THEN 1 ELSE 0 END) AS direct_count,
                    SUM(CASE WHEN ae.min_path_len > 0 THEN 1 ELSE 0 END) AS flood_count
                FROM advert_events ae
                WHERE ae.first_seen >= :start_ts AND ae.first_seen < :end_ts
                GROUP BY ae.public_key
                """,
                {"start_ts": start_ts, "end_ts": end_ts},
            ) as cur:
                rows = await cur.fetchall()
        return [
            {
                "public_key": r["public_key"],
                "first_seen": r["first_seen"],
                "last_event": r["last_event"],
                "min_path_len": r["min_path_len"],
                "direct_count": int(r["direct_count"]),
                "flood_count": int(r["flood_count"]),
            }
            for r in rows
        ]

    @staticmethod
    async def prune_older_than(cutoff_ts: int) -> int:
        """Delete events with first_seen < cutoff_ts. Returns rows deleted."""
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM advert_events WHERE first_seen < ?", (cutoff_ts,)
            ) as cur:
                return cur.rowcount
