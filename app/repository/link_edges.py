"""Storage and queries for the per-packet link edge log (``link_edge_events``)."""

from dataclasses import dataclass
from typing import Any, Literal

from app.database import db
from app.repository.advert_links import _effective_latlon
from app.services.traffic_links import EdgeObservation, KnownNode

EndpointKind = Literal["contact", "external", "unknown"]


@dataclass(frozen=True)
class RawPacketRow:
    id: int
    timestamp: int
    data: bytes
    snr: float | None
    rssi: int | None


@dataclass(frozen=True)
class WindowEdge:
    a_pubkey: str
    b_pubkey: str
    hop_width: int
    count: int
    first_seen: int
    last_seen: int
    confident: bool


def _window_sql(since: int | None, until: int | None) -> tuple[str, list[int]]:
    """AND-clauses for an optional [since, until] ts window."""
    clauses: list[str] = []
    params: list[int] = []
    if since is not None:
        clauses.append("ts >= ?")
        params.append(since)
    if until is not None:
        clauses.append("ts <= ?")
        params.append(until)
    return ("".join(f" AND {c}" for c in clauses), params)


class LinkEdgesRepository:
    @staticmethod
    async def window_edges(since: int | None, until: int | None) -> list[WindowEdge]:
        """Edges used in the window with distinct-packet counts."""
        where, params = _window_sql(since, until)
        async with db.readonly() as conn:
            async with conn.execute(
                f"""
                SELECT a_pubkey, b_pubkey, hop_width,
                       COUNT(DISTINCT raw_packet_id) AS n,
                       MIN(ts) AS first_seen, MAX(ts) AS last_seen,
                       MAX(CASE WHEN confidence IN ('unique', 'confirmed') THEN 1 ELSE 0 END)
                           AS confident
                FROM link_edge_events
                WHERE 1 = 1{where}
                GROUP BY a_pubkey, b_pubkey, hop_width
                """,
                params,
            ) as cur:
                rows = await cur.fetchall()
        return [
            WindowEdge(
                a_pubkey=r["a_pubkey"],
                b_pubkey=r["b_pubkey"],
                hop_width=int(r["hop_width"]),
                count=int(r["n"]),
                first_seen=int(r["first_seen"]),
                last_seen=int(r["last_seen"]),
                confident=bool(r["confident"]),
            )
            for r in rows
        ]

    @staticmethod
    async def known_nodes() -> list[KnownNode]:
        """Link candidates: local contacts with a full public key.

        Analyzer-only nodes (``external_map_nodes``) are never link endpoints;
        an analyzer node takes part only once it is a contact (heard over RF,
        or promoted by an applied partial resolution). Prefix-only placeholder
        contacts are skipped too. Contacts without a location are kept, so a
        1-byte prefix shared with an unlocated contact is not mistaken for a
        unique match.
        """
        by_pk: dict[str, KnownNode] = {}
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT public_key, lat, lon, manual_lat, manual_lon FROM contacts "
                "WHERE LENGTH(public_key) = 64"
            ) as cur:
                for r in await cur.fetchall():
                    pk = (r["public_key"] or "").lower()
                    if not pk:
                        continue
                    loc = _effective_latlon(r["lat"], r["lon"], r["manual_lat"], r["manual_lon"])
                    lat, lon = loc if loc is not None else (None, None)
                    by_pk[pk] = KnownNode(pk, lat, lon)
        return list(by_pk.values())

    @staticmethod
    async def insert_edges(
        *,
        raw_packet_id: int,
        ts: int,
        payload_type: str | None,
        route_type: str | None,
        edges: list[EdgeObservation],
        snr: float | None,
        rssi: int | None,
    ) -> None:
        """Store one packet copy's edges. Duplicates of (packet, edge) are ignored,
        so the first copy's signal wins. Only the edge into our node gets signal."""
        if not edges:
            return
        rows = [
            (
                raw_packet_id,
                ts,
                e.a_pubkey,
                e.b_pubkey,
                e.hop_width,
                payload_type,
                route_type,
                e.confidence,
                snr if e.measured else None,
                rssi if e.measured else None,
            )
            for e in edges
        ]
        async with db.tx() as conn:
            await conn.executemany(
                """
                INSERT OR IGNORE INTO link_edge_events
                    (raw_packet_id, ts, a_pubkey, b_pubkey, hop_width,
                     payload_type, route_type, confidence, snr, rssi)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

    @staticmethod
    async def backfill_state() -> tuple[int, int] | None:
        """(next_id, end_id) of the one-time backfill, or None if absent."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT next_id, end_id FROM link_edge_backfill_state WHERE id = 1"
            ) as cur:
                row = await cur.fetchone()
        return (int(row["next_id"]), int(row["end_id"])) if row else None

    @staticmethod
    async def set_backfill_next(next_id: int) -> None:
        async with db.tx() as conn:
            await conn.execute(
                "UPDATE link_edge_backfill_state SET next_id = ? WHERE id = 1", (next_id,)
            )

    @staticmethod
    async def raw_packets_batch(*, start_id: int, end_id: int, limit: int) -> list[RawPacketRow]:
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT id, timestamp, data, snr, rssi FROM raw_packets
                WHERE id >= ? AND id <= ?
                ORDER BY id
                LIMIT ?
                """,
                (start_id, end_id, limit),
            ) as cur:
                rows = await cur.fetchall()
        return [
            RawPacketRow(
                id=int(r["id"]),
                timestamp=int(r["timestamp"] or 0),
                data=bytes(r["data"] or b""),
                snr=r["snr"],
                rssi=r["rssi"],
            )
            for r in rows
        ]

    @staticmethod
    async def summary_counts(
        a: str, b: str, since: int | None, until: int | None
    ) -> dict[str, Any]:
        """Distinct-packet totals and breakdowns for one link in the window."""
        where, params = _window_sql(since, until)
        base = f"FROM link_edge_events WHERE a_pubkey = ? AND b_pubkey = ?{where}"
        args: list[Any] = [a, b, *params]
        out: dict[str, Any] = {}
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT COUNT(DISTINCT raw_packet_id) AS n, MIN(ts) AS lo, MAX(ts) AS hi {base}",
                args,
            ) as cur:
                row = await cur.fetchone()
            out["total"] = int(row["n"]) if row else 0
            out["first_seen"] = row["lo"] if row else None
            out["last_seen"] = row["hi"] if row else None
            # Column names come from this fixed tuple, never from caller input.
            for key, column in (
                ("by_hop_width", "hop_width"),
                ("by_confidence", "confidence"),
                ("by_payload_type", "payload_type"),
            ):
                async with conn.execute(
                    f"SELECT {column} AS k, COUNT(DISTINCT raw_packet_id) AS n {base} "
                    f"GROUP BY {column}",
                    args,
                ) as cur:
                    out[key] = {str(r["k"]): int(r["n"]) for r in await cur.fetchall()}
        return out

    @staticmethod
    async def timeseries(
        a: str, b: str, since: int | None, until: int | None, bucket_seconds: int
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """(traffic rows, signal rows) bucketed by UTC-aligned ``bucket_seconds``."""
        where, params = _window_sql(since, until)
        base = f"FROM link_edge_events WHERE a_pubkey = ? AND b_pubkey = ?{where}"
        args: list[Any] = [bucket_seconds, bucket_seconds, a, b, *params]
        async with db.readonly() as conn:
            async with conn.execute(
                f"""
                SELECT (ts / ?) * ? AS bucket,
                       COALESCE(payload_type, 'Unknown') AS payload_type,
                       COUNT(DISTINCT raw_packet_id) AS n
                {base}
                GROUP BY bucket, payload_type ORDER BY bucket
                """,
                args,
            ) as cur:
                traffic = [
                    {
                        "bucket": int(r["bucket"]),
                        "payload_type": r["payload_type"],
                        "count": int(r["n"]),
                    }
                    for r in await cur.fetchall()
                ]
            async with conn.execute(
                f"""
                SELECT (ts / ?) * ? AS bucket, COUNT(snr) AS samples,
                       AVG(snr) AS snr_avg, MIN(snr) AS snr_min, MAX(snr) AS snr_max,
                       AVG(rssi) AS rssi_avg, MIN(rssi) AS rssi_min, MAX(rssi) AS rssi_max
                {base} AND snr IS NOT NULL
                GROUP BY bucket ORDER BY bucket
                """,
                args,
            ) as cur:
                signal = [dict(r) for r in await cur.fetchall()]
        return traffic, signal

    @staticmethod
    async def packets(a: str, b: str, limit: int, before: int | None) -> list[dict[str, Any]]:
        """Newest-first edge rows for one link, optionally before a ts cursor."""
        clause = " AND ts < ?" if before is not None else ""
        args: list[Any] = [a, b]
        if before is not None:
            args.append(before)
        args.append(limit)
        async with db.readonly() as conn:
            async with conn.execute(
                f"""
                SELECT raw_packet_id, ts, payload_type, route_type, hop_width,
                       confidence, snr, rssi
                FROM link_edge_events
                WHERE a_pubkey = ? AND b_pubkey = ?{clause}
                ORDER BY ts DESC, id DESC
                LIMIT ?
                """,
                args,
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]

    @staticmethod
    async def endpoint_info(
        pubkey: str,
    ) -> tuple[str | None, EndpointKind, float | None, float | None]:
        """(name, kind, lat, lon) for a pubkey from contacts, else analyzer nodes."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT name, lat, lon, manual_lat, manual_lon FROM contacts "
                "WHERE LOWER(public_key) = ?",
                (pubkey,),
            ) as cur:
                row = await cur.fetchone()
            if row is not None:
                loc = _effective_latlon(
                    row["lat"], row["lon"], row["manual_lat"], row["manual_lon"]
                )
                lat, lon = loc if loc is not None else (None, None)
                return row["name"], "contact", lat, lon
            async with conn.execute(
                "SELECT name, lat, lon FROM external_map_nodes WHERE LOWER(pubkey) = ?",
                (pubkey,),
            ) as cur:
                row = await cur.fetchone()
            if row is not None:
                loc = _effective_latlon(row["lat"], row["lon"], None, None)
                lat, lon = loc if loc is not None else (None, None)
                return row["name"], "external", lat, lon
        return None, "unknown", None, None
