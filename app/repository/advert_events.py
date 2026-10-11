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
        sender_timestamp: int | None = None,
    ) -> None:
        """``sender_timestamp`` is the advertising node's own clock, from the advert.

        It is part of the signed payload, so every copy of one transmission
        carries the same value; a later copy never changes it.
        """
        normalized_key = public_key.lower()
        normalized_path = (path_hex or "").lower()
        hop_width = AdvertEventRepository._hop_width(path_len, normalized_path)
        async with db.tx() as conn:
            await conn.execute(
                """
                INSERT INTO advert_events
                    (transmission_id, public_key, first_seen, min_path_len, path_hex, hop_width,
                     sender_timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?)
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
                (
                    transmission_id,
                    normalized_key,
                    timestamp,
                    path_len,
                    normalized_path,
                    hop_width,
                    sender_timestamp,
                ),
            )

    @staticmethod
    async def latest_clock_reading(public_key: str) -> tuple[int, int] | None:
        """``(sender_timestamp, first_seen)`` of the newest advert that kept its clock.

        None when no advert from this key was stored since the sender timestamp
        is kept (migration 139), or all of them were pruned.
        """
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT sender_timestamp, first_seen FROM advert_events
                WHERE public_key = ? AND sender_timestamp IS NOT NULL
                ORDER BY first_seen DESC LIMIT 1
                """,
                (public_key.lower(),),
            ) as cur:
                row = await cur.fetchone()
        if row is None:
            return None
        return int(row["sender_timestamp"]), int(row["first_seen"])

    @staticmethod
    async def latest_clock_readings_since(since_ts: int) -> list[tuple[str, int, int]]:
        """``(public_key, sender_timestamp, first_seen)``: each node's newest reading.

        Only adverts first heard at or after ``since_ts`` count. One row per
        node, so a node that advertises often does not outweigh the others.
        """
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT public_key, sender_timestamp, first_seen FROM (
                    SELECT public_key, sender_timestamp, first_seen,
                           ROW_NUMBER() OVER (
                               PARTITION BY public_key ORDER BY first_seen DESC
                           ) AS rn
                    FROM advert_events
                    WHERE first_seen >= ? AND sender_timestamp IS NOT NULL
                )
                WHERE rn = 1
                """,
                (since_ts,),
            ) as cur:
                rows = await cur.fetchall()
        return [
            (row["public_key"], int(row["sender_timestamp"]), int(row["first_seen"]))
            for row in rows
        ]

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
                    MAX(ae.hop_width) AS hop_width,
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
                # Bytes-per-hop of the advert path (1/2/3). Direct-only contacts
                # have no path, so this is None. Hop width is a mesh-wide setting
                # per node, so any non-null observation is representative.
                "hop_width": r["hop_width"],
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

    @staticmethod
    async def latest_raw_adverts(public_keys: list[str]) -> dict[str, bytes]:
        """Most recent stored raw ADVERT packet per key, keyed by lowercase public_key.

        Joins to raw_packets by transmission_id, so a key is present only when
        its most recently recorded advert transmission still has a raw packet
        row (backfilled events have no transmission_id, and old raw packets can
        be pruned by retention independently of advert_events). Read-only; lets
        a meshcore:// contact link be built from mesh-heard history without a
        per-node radio command.
        """
        normalized = sorted({k.lower() for k in public_keys if k})
        if not normalized:
            return {}
        placeholders = ",".join("?" * len(normalized))
        async with db.readonly() as conn:
            async with conn.execute(
                f"""
                SELECT public_key, data FROM (
                    SELECT ae.public_key AS public_key, rp.data AS data,
                           ROW_NUMBER() OVER (
                               PARTITION BY ae.public_key
                               ORDER BY ae.first_seen DESC
                           ) AS rn
                    FROM advert_events ae
                    JOIN raw_packets rp ON rp.id = ae.transmission_id
                    WHERE ae.public_key IN ({placeholders})
                )
                WHERE rn = 1
                """,
                normalized,
            ) as cursor:
                rows = await cursor.fetchall()
        return {row["public_key"]: bytes(row["data"]) for row in rows}
