"""Repository for ``relay_reception_hourly``: long-term per-relay history.

One row per (hour, relay) folded from ``packet_receptions`` before that table
is pruned (migration ``_124``). Pruned by ``relay_history_retention_days``.
"""

from __future__ import annotations

from app.database import db
from app.repository.packet_receptions import (
    RelayStatsRow,
    relay_filter,
    relay_stats_sql,
)

HOUR = 3600
# Copies of one flood arrive within seconds; judging "first copy" and "relays
# per packet" over a padded window keeps a packet that straddles an hour edge
# from being credited in both hours.
ROLLUP_CONTEXT_SECONDS = 600

_STAT_COLUMNS = (
    "receptions, packets, first_arrivals, unique_packets, snr_sum, snr_count, snr_best, "
    "rssi_sum, rssi_count, rssi_best, last_seen"
)


class RelayHistoryRepository:
    @staticmethod
    async def latest_hour() -> int | None:
        """Newest rolled-up hour that had receptions (None = nothing rolled up yet)."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT MAX(hour_ts) AS h FROM relay_reception_hourly"
            ) as cursor:
                row = await cursor.fetchone()
        return int(row["h"]) if row and row["h"] is not None else None

    @staticmethod
    async def rollup(from_hour: int, to_hour: int) -> int:
        """(Re)build the hours ``[from_hour, to_hour)`` from ``packet_receptions``.

        Idempotent: the hours are replaced. Returns the rows written.
        """
        sql, params = relay_stats_sql(f"(w.observed_at - (w.observed_at % {HOUR}))", None)
        params.update(
            start=from_hour,
            end=to_hour - 1,
            ctx_start=from_hour - ROLLUP_CONTEXT_SECONDS,
            ctx_end=to_hour - 1 + ROLLUP_CONTEXT_SECONDS,
        )
        async with db.tx() as conn:
            await conn.execute(
                "DELETE FROM relay_reception_hourly WHERE hour_ts >= ? AND hour_ts < ?",
                (from_hour, to_hour),
            )
            async with conn.execute(
                f"INSERT INTO relay_reception_hourly (hour_ts, relay_hex, {_STAT_COLUMNS}) "
                f"SELECT bucket_ts, relay_hex, {_STAT_COLUMNS} FROM ({sql})",
                params,
            ) as cursor:
                return cursor.rowcount

    @staticmethod
    async def relay_stats(
        from_hour: int,
        to_hour: int,
        *,
        relay_hexes: list[str] | None = None,
        bucket_seconds: int | None = None,
        origin: int = 0,
    ) -> list[RelayStatsRow]:
        """Per-relay (optionally per bucket) sums over the hours ``[from_hour, to_hour)``.

        Buckets start at ``origin + k * bucket_seconds``; an hour before
        ``origin`` falls in the first bucket.
        """
        if bucket_seconds:
            size = int(bucket_seconds)
            group = f"(:origin + ((MAX(hour_ts, :origin) - :origin) / {size}) * {size})"
        else:
            group = "NULL"
        where, params = relay_filter("relay_hex", relay_hexes)
        params.update(from_hour=from_hour, to_hour=to_hour, origin=origin)
        async with db.readonly() as conn:
            async with conn.execute(
                f"""
                SELECT relay_hex, {group} AS bucket_ts,
                       SUM(receptions) AS receptions, SUM(packets) AS packets,
                       SUM(first_arrivals) AS first_arrivals,
                       SUM(unique_packets) AS unique_packets,
                       SUM(snr_sum) AS snr_sum, SUM(snr_count) AS snr_count,
                       MAX(snr_best) AS snr_best,
                       SUM(rssi_sum) AS rssi_sum, SUM(rssi_count) AS rssi_count,
                       MAX(rssi_best) AS rssi_best,
                       MAX(last_seen) AS last_seen
                FROM relay_reception_hourly
                WHERE hour_ts >= :from_hour AND hour_ts < :to_hour{where}
                GROUP BY relay_hex, bucket_ts
                """,
                params,
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            RelayStatsRow(
                relay_hex=row["relay_hex"],
                bucket_ts=row["bucket_ts"],
                receptions=int(row["receptions"]),
                packets=int(row["packets"]),
                first_arrivals=int(row["first_arrivals"]),
                unique_packets=int(row["unique_packets"]),
                snr_sum=float(row["snr_sum"] or 0.0),
                snr_count=int(row["snr_count"] or 0),
                snr_best=row["snr_best"],
                rssi_sum=int(row["rssi_sum"] or 0),
                rssi_count=int(row["rssi_count"] or 0),
                rssi_best=row["rssi_best"],
                last_seen=int(row["last_seen"]),
            )
            for row in rows
        ]
