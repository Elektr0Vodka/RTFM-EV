"""Repository for ``packet_receptions`` (plan 21 S1): one row per received copy.

``raw_packets`` keeps one row per payload; this table keeps one row per
physical reception of a flood-routed copy so the same packet can be compared
across the relays that delivered it. Pruned by ``packet_reception_retention_days``
(see ``app/repository/retention.py``).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.database import db


@dataclass(frozen=True)
class PacketReceptionRow:
    id: int
    raw_packet_id: int | None
    payload_hash: bytes
    observed_at: int
    snr: float | None
    rssi: int | None
    payload_type: str
    route_type: str
    hop_count: int
    hash_size: int
    last_hop_hex: str | None
    path_hex: str | None


_COLUMNS = (
    "id, raw_packet_id, payload_hash, observed_at, snr, rssi, payload_type, "
    "route_type, hop_count, hash_size, last_hop_hex, path_hex"
)


@dataclass(frozen=True)
class RelayStatsRow:
    """Aggregated receptions of one relay (``relay_hex`` ``''`` = heard from the origin).

    Sums and counts (not averages) so rows from the raw table and the hourly
    rollup can be merged. ``last_snr``/``last_rssi`` exist only for raw rows.
    """

    relay_hex: str
    bucket_ts: int | None
    receptions: int
    packets: int
    first_arrivals: int
    unique_packets: int
    snr_sum: float
    snr_count: int
    snr_best: float | None
    rssi_sum: int
    rssi_count: int
    rssi_best: int | None
    last_seen: int
    last_snr: float | None = None
    last_rssi: int | None = None


def relay_filter(column: str, relay_hexes: list[str] | None) -> tuple[str, dict]:
    """``AND column IN (...)`` with named params, or nothing for all relays."""
    if relay_hexes is None:
        return "", {}
    params = {f"relay{i}": hop for i, hop in enumerate(relay_hexes)}
    if not params:
        return " AND 0", {}
    return f" AND {column} IN ({', '.join(':' + k for k in params)})", params


def relay_stats_sql(group_expr: str, relay_hexes: list[str] | None) -> tuple[str, dict]:
    """SQL grouping ``packet_receptions`` rows into :class:`RelayStatsRow` columns.

    Rows counted: ``observed_at`` in ``[:start, :end]``. Packet context (which
    copy came first, how many relays delivered it) is judged over
    ``[:ctx_start, :ctx_end]``, which may be wider so a packet whose copies
    straddle the edge is not credited twice. A first arrival and a unique
    packet are attributed to the packet's first copy, so both sum across
    buckets. ``group_expr`` is an SQL expression over ``w`` (``NULL`` = no time
    bucket), built by the callers and never from request input.
    """
    where, params = relay_filter("w.relay_hex", relay_hexes)
    sql = f"""
        WITH ctx AS (
            SELECT id, payload_hash, COALESCE(last_hop_hex, '') AS relay_hex,
                   observed_at, snr, rssi
            FROM packet_receptions
            WHERE observed_at >= :ctx_start AND observed_at <= :ctx_end
        ),
        p AS (
            SELECT payload_hash, MIN(id) AS first_id, COUNT(DISTINCT relay_hex) AS n_relays
            FROM ctx GROUP BY payload_hash
        ),
        w AS (
            SELECT ctx.*, ctx.id = p.first_id AS is_first, p.n_relays AS n_relays
            FROM ctx JOIN p ON p.payload_hash = ctx.payload_hash
            WHERE ctx.observed_at >= :start AND ctx.observed_at <= :end
        ),
        g AS (
            SELECT w.*, {group_expr} AS bucket_ts,
                   ROW_NUMBER() OVER (
                       PARTITION BY w.relay_hex, {group_expr}
                       ORDER BY w.observed_at DESC, w.id DESC
                   ) AS recency
            FROM w
            WHERE 1{where}
        )
        SELECT relay_hex, bucket_ts,
               COUNT(*) AS receptions,
               COUNT(DISTINCT payload_hash) AS packets,
               SUM(is_first) AS first_arrivals,
               SUM(CASE WHEN is_first AND n_relays = 1 THEN 1 ELSE 0 END) AS unique_packets,
               COALESCE(SUM(snr), 0) AS snr_sum, COUNT(snr) AS snr_count, MAX(snr) AS snr_best,
               COALESCE(SUM(rssi), 0) AS rssi_sum, COUNT(rssi) AS rssi_count,
               MAX(rssi) AS rssi_best,
               MAX(observed_at) AS last_seen,
               MAX(CASE WHEN recency = 1 THEN snr END) AS last_snr,
               MAX(CASE WHEN recency = 1 THEN rssi END) AS last_rssi
        FROM g
        GROUP BY relay_hex, bucket_ts
    """
    return sql, params


def _stats_row(row) -> RelayStatsRow:
    keys = row.keys()
    return RelayStatsRow(
        relay_hex=row["relay_hex"],
        bucket_ts=row["bucket_ts"],
        receptions=int(row["receptions"]),
        packets=int(row["packets"]),
        first_arrivals=int(row["first_arrivals"] or 0),
        unique_packets=int(row["unique_packets"] or 0),
        snr_sum=float(row["snr_sum"] or 0.0),
        snr_count=int(row["snr_count"] or 0),
        snr_best=row["snr_best"],
        rssi_sum=int(row["rssi_sum"] or 0),
        rssi_count=int(row["rssi_count"] or 0),
        rssi_best=row["rssi_best"],
        last_seen=int(row["last_seen"]),
        last_snr=row["last_snr"] if "last_snr" in keys else None,
        last_rssi=row["last_rssi"] if "last_rssi" in keys else None,
    )


def _row_to_model(row) -> PacketReceptionRow:
    return PacketReceptionRow(
        id=row["id"],
        raw_packet_id=row["raw_packet_id"],
        payload_hash=bytes(row["payload_hash"]),
        observed_at=row["observed_at"],
        snr=row["snr"],
        rssi=row["rssi"],
        payload_type=row["payload_type"],
        route_type=row["route_type"],
        hop_count=row["hop_count"],
        hash_size=row["hash_size"],
        last_hop_hex=row["last_hop_hex"],
        path_hex=row["path_hex"],
    )


class PacketReceptionRepository:
    @staticmethod
    async def insert(
        *,
        raw_packet_id: int | None,
        payload_hash: bytes,
        observed_at: int,
        snr: float | None,
        rssi: int | None,
        payload_type: str,
        route_type: str,
        hop_count: int,
        hash_size: int,
        last_hop_hex: str | None,
        path_hex: str | None,
    ) -> int:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO packet_receptions (raw_packet_id, payload_hash, observed_at, snr, "
                "rssi, payload_type, route_type, hop_count, hash_size, last_hop_hex, path_hex) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    raw_packet_id,
                    payload_hash,
                    observed_at,
                    snr,
                    rssi,
                    payload_type,
                    route_type,
                    hop_count,
                    hash_size,
                    last_hop_hex,
                    path_hex,
                ),
            ) as cursor:
                return int(cursor.lastrowid or 0)

    @staticmethod
    async def window_rows(
        start_ts: int, end_ts: int, limit: int | None = None
    ) -> list[PacketReceptionRow]:
        """Receptions observed in ``[start_ts, end_ts]``, newest first (all, or ``limit``)."""
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM packet_receptions "
                "WHERE observed_at >= ? AND observed_at <= ? "
                "ORDER BY observed_at DESC, id DESC LIMIT ?",
                (start_ts, end_ts, -1 if limit is None else limit),
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_model(row) for row in rows]

    @staticmethod
    async def packet_page(
        start_ts: int, end_ts: int, limit: int, offset: int
    ) -> tuple[list[bytes], int]:
        """One page of payload hashes in the window (newest copy first) and the total."""
        params = {"start": start_ts, "end": end_ts, "limit": limit, "offset": offset}
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT payload_hash FROM packet_receptions "
                "WHERE observed_at >= :start AND observed_at <= :end "
                "GROUP BY payload_hash ORDER BY MAX(observed_at) DESC, MAX(id) DESC "
                "LIMIT :limit OFFSET :offset",
                params,
            ) as cursor:
                hashes = [bytes(row["payload_hash"]) for row in await cursor.fetchall()]
            async with conn.execute(
                "SELECT COUNT(DISTINCT payload_hash) AS n FROM packet_receptions "
                "WHERE observed_at >= :start AND observed_at <= :end",
                params,
            ) as cursor:
                row = await cursor.fetchone()
        return hashes, int(row["n"]) if row else 0

    @staticmethod
    async def rows_for_hashes(
        payload_hashes: list[bytes], start_ts: int, end_ts: int
    ) -> list[PacketReceptionRow]:
        """Every copy of the given packets inside the window, newest first."""
        if not payload_hashes:
            return []
        placeholders = ",".join("?" for _ in payload_hashes)
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM packet_receptions "
                f"WHERE payload_hash IN ({placeholders}) "
                "AND observed_at >= ? AND observed_at <= ? "
                "ORDER BY observed_at DESC, id DESC",
                (*payload_hashes, start_ts, end_ts),
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_model(row) for row in rows]

    @staticmethod
    async def oldest_observed_at() -> int | None:
        """Oldest stored reception (raw rows start here; older hours live in the rollup)."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT MIN(observed_at) AS ts FROM packet_receptions"
            ) as cursor:
                row = await cursor.fetchone()
        return int(row["ts"]) if row and row["ts"] is not None else None

    @staticmethod
    async def relay_stats(
        start_ts: int,
        end_ts: int,
        *,
        relay_hexes: list[str] | None = None,
        bucket_seconds: int | None = None,
        origin: int | None = None,
    ) -> list[RelayStatsRow]:
        """Per-relay (optionally per time bucket) statistics over the raw rows in the window.

        See :func:`relay_stats_sql`. ``bucket_seconds`` also groups by
        ``origin + k * bucket_seconds`` (``origin`` defaults to ``start_ts``,
        and must not be after it); otherwise ``bucket_ts`` is None.
        """
        if bucket_seconds:
            size = int(bucket_seconds)
            group = f"(:origin + ((w.observed_at - :origin) / {size}) * {size})"
        else:
            group = "NULL"
        sql, params = relay_stats_sql(group, relay_hexes)
        params.update(
            start=start_ts,
            end=end_ts,
            ctx_start=start_ts,
            ctx_end=end_ts,
            origin=start_ts if origin is None else origin,
        )
        async with db.readonly() as conn:
            async with conn.execute(sql, params) as cursor:
                return [_stats_row(row) for row in await cursor.fetchall()]

    @staticmethod
    async def relay_breakdowns(
        start_ts: int, end_ts: int, relay_hexes: list[str]
    ) -> tuple[dict[str, int], dict[int, int]]:
        """Copies delivered by the relay in the window: by payload type and by hop count."""
        where, params = relay_filter("COALESCE(last_hop_hex, '')", relay_hexes)
        params.update(start=start_ts, end=end_ts)
        base = f"FROM packet_receptions WHERE observed_at >= :start AND observed_at <= :end{where}"
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT payload_type AS k, COUNT(*) AS n {base} GROUP BY payload_type", params
            ) as cursor:
                by_type = {row["k"]: int(row["n"]) for row in await cursor.fetchall()}
            async with conn.execute(
                f"SELECT hop_count AS k, COUNT(*) AS n {base} GROUP BY hop_count", params
            ) as cursor:
                by_hops = {int(row["k"]): int(row["n"]) for row in await cursor.fetchall()}
        return by_type, by_hops

    @staticmethod
    async def relay_recent(
        start_ts: int, end_ts: int, relay_hexes: list[str], limit: int
    ) -> list[tuple[PacketReceptionRow, bool, int]]:
        """The relay's newest copies in the window, each with (first copy?, relays).

        "First" and the relay count are judged over every copy of the packet in
        the window, not only this relay's.
        """
        where, params = relay_filter("COALESCE(r.last_hop_hex, '')", relay_hexes)
        params.update(start=start_ts, end=end_ts, limit=limit)
        cols = ", ".join(f"r.{c.strip()}" for c in _COLUMNS.split(","))
        async with db.readonly() as conn:
            async with conn.execute(
                f"""
                WITH p AS (
                    SELECT payload_hash, MIN(id) AS first_id,
                           COUNT(DISTINCT COALESCE(last_hop_hex, '')) AS n_relays
                    FROM packet_receptions
                    WHERE observed_at >= :start AND observed_at <= :end
                    GROUP BY payload_hash
                )
                SELECT {cols}, r.id = p.first_id AS is_first, p.n_relays AS n_relays
                FROM packet_receptions r JOIN p ON p.payload_hash = r.payload_hash
                WHERE r.observed_at >= :start AND r.observed_at <= :end{where}
                ORDER BY r.observed_at DESC, r.id DESC
                LIMIT :limit
                """,
                params,
            ) as cursor:
                rows = await cursor.fetchall()
        return [(_row_to_model(row), bool(row["is_first"]), int(row["n_relays"])) for row in rows]

    @staticmethod
    async def message_previews(raw_packet_ids: list[int]) -> dict[int, tuple[int, str]]:
        """``raw_packet_id -> (message_id, text)`` for the copies that decrypted to a message."""
        if not raw_packet_ids:
            return {}
        placeholders = ",".join("?" for _ in raw_packet_ids)
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT r.id AS raw_id, m.id AS message_id, m.text AS text "
                "FROM raw_packets r JOIN messages m ON m.id = r.message_id "
                f"WHERE r.id IN ({placeholders})",
                tuple(raw_packet_ids),
            ) as cursor:
                rows = await cursor.fetchall()
        return {int(row["raw_id"]): (int(row["message_id"]), row["text"] or "") for row in rows}

    @staticmethod
    async def count() -> int:
        async with db.readonly() as conn:
            async with conn.execute("SELECT COUNT(*) AS n FROM packet_receptions") as cursor:
                row = await cursor.fetchone()
        return int(row["n"]) if row else 0
