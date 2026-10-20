"""10-second sampler: an in-memory hour of points plus one stored row per minute.

Each point holds the figures the Performance charts draw. The last hour is
served from memory; longer ranges come from ``perf_samples`` (migration 159),
which keeps 30 days and is pruned here.
"""

import asyncio
import logging
import math
import sqlite3
import time
from collections import deque

from app.database import db
from app.perf.loopwatch import loop_watch
from app.perf.process import CpuMark, process_stats
from app.perf.recorders import db_calls, log_tail, loops, pipeline, radio_ops, routes

logger = logging.getLogger(__name__)

INTERVAL_S = 10
RING_POINTS = 360  # one hour of 10 s points
RETENTION_S = 30 * 86400
PRUNE_EVERY_S = 3600
MAX_HISTORY_POINTS = 720

POINT_KEYS = (
    "cpu",
    "rss_mb",
    "lag_p50",
    "lag_p95",
    "lag_max",
    "tasks",
    "pkts",
    "db_p95",
    "radio_p95",
    "http_p95",
    "stalls",
    "warnings",
)

# History range id -> seconds. Up to an hour comes from memory.
RANGES: dict[str, int] = {
    "live": 300,
    "15m": 900,
    "1h": 3600,
    "6h": 6 * 3600,
    "24h": 86400,
    "7d": 7 * 86400,
    "30d": 30 * 86400,
}

# How a minute (and a history bucket) combines its points.
_AGG = {
    "cpu": "avg",
    "rss_mb": "max",
    "lag_p50": "avg",
    "lag_p95": "max",
    "lag_max": "max",
    "tasks": "max",
    "pkts": "avg",
    "db_p95": "max",
    "radio_p95": "max",
    "http_p95": "max",
    "stalls": "sum",
    "warnings": "sum",
}


def _r(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 2)


def combine(points: list[dict]) -> dict:
    """One point from several, by each key's rule (average, worst or sum)."""
    out: dict = {}
    for key in POINT_KEYS:
        values = [p[key] for p in points if p.get(key) is not None]
        if not values:
            out[key] = None
            continue
        rule = _AGG[key]
        if rule == "avg":
            out[key] = _r(sum(values) / len(values))
        elif rule == "max":
            out[key] = max(values)
        else:
            out[key] = sum(values)
    return out


class Sampler:
    def __init__(self) -> None:
        self._ring: deque[dict] = deque(maxlen=RING_POINTS)
        self._task: asyncio.Task | None = None
        self._cpu_mark: CpuMark | None = None
        self._minute: int | None = None
        self._minute_points: list[dict] = []
        self._last_prune = 0.0
        self._last_stall_check = time.time()
        self.latest_process: dict | None = None

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._cpu_mark = process_stats(None)[1]
        self._task = asyncio.create_task(self._run(), name="perf.sampler")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(INTERVAL_S)
            try:
                with loops.tick("perf.sampler", INTERVAL_S):
                    await self.sample()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Performance sampler error")

    async def sample(self, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        stats, self._cpu_mark = process_stats(self._cpu_mark)
        self.latest_process = stats
        lag = loop_watch.lag.swap()
        stalls = len(loop_watch.stalls_since(self._last_stall_check))
        self._last_stall_check = now
        point = {
            "ts": int(now),
            "cpu": stats["cpu_percent"],
            "rss_mb": stats["rss_mb"],
            "lag_p50": _r(lag.percentile(50)),
            "lag_p95": _r(lag.percentile(95)),
            "lag_max": _r(lag.max),
            "tasks": len(asyncio.all_tasks()),
            "pkts": pipeline.take_interval_count() * 60 / INTERVAL_S,
            "db_p95": _r(db_calls.interval_p95()),
            "radio_p95": _r(radio_ops.hold.swap().percentile(95)),
            "http_p95": _r(routes.latency.swap().percentile(95)),
            "stalls": stalls,
            "warnings": log_tail.take_interval_count(),
        }
        self._ring.append(point)
        await self._roll_minute(point)
        if now - self._last_prune >= PRUNE_EVERY_S:
            self._last_prune = now
            await self._prune(now)
        return point

    async def _roll_minute(self, point: dict) -> None:
        minute = point["ts"] // 60
        if self._minute is not None and minute != self._minute and self._minute_points:
            row = combine(self._minute_points)
            await self._store(self._minute * 60, row)
            self._minute_points = []
        self._minute = minute
        self._minute_points.append(point)

    async def _store(self, ts: int, row: dict) -> None:
        columns = ", ".join(("ts", *POINT_KEYS))
        marks = ", ".join("?" for _ in range(len(POINT_KEYS) + 1))
        try:
            async with db.tx() as conn:
                await conn.execute(
                    f"INSERT OR REPLACE INTO perf_samples ({columns}) VALUES ({marks})",
                    (ts, *(row[k] for k in POINT_KEYS)),
                )
        except (RuntimeError, sqlite3.Error):
            logger.debug("Could not store a performance sample", exc_info=True)

    async def _prune(self, now: float) -> None:
        try:
            async with db.tx() as conn:
                await conn.execute(
                    "DELETE FROM perf_samples WHERE ts < ?", (int(now - RETENTION_S),)
                )
        except (RuntimeError, sqlite3.Error):
            logger.debug("Could not prune performance samples", exc_info=True)

    def ring(self) -> list[dict]:
        return list(self._ring)

    def latest(self) -> dict | None:
        return self._ring[-1] if self._ring else None

    async def history(self, range_id: str, now: float | None = None) -> dict:
        """Points for a range: 10 s from memory up to an hour, else stored minutes."""
        seconds = RANGES[range_id]
        now = time.time() if now is None else now
        since = now - seconds
        if seconds <= 3600:
            points = [p for p in self._ring if p["ts"] >= since]
            return {"range": range_id, "step_s": INTERVAL_S, "points": points}

        step = max(60, math.ceil(seconds / MAX_HISTORY_POINTS / 60) * 60)
        columns = ", ".join(
            f"{'SUM' if _AGG[k] == 'sum' else 'AVG' if _AGG[k] == 'avg' else 'MAX'}({k})"
            for k in POINT_KEYS
        )
        try:
            async with db.readonly() as conn:
                async with conn.execute(
                    f"SELECT (ts / ?) * ? AS bucket, {columns} FROM perf_samples "
                    "WHERE ts >= ? GROUP BY bucket ORDER BY bucket",
                    (step, step, int(since)),
                ) as cursor:
                    rows = await cursor.fetchall()
        except (RuntimeError, sqlite3.Error):
            logger.debug("Could not read performance history", exc_info=True)
            rows = []
        points = []
        for row in rows:
            point = {"ts": row[0]}
            for index, key in enumerate(POINT_KEYS, start=1):
                value = row[index]
                point[key] = _r(value) if isinstance(value, float) else value
            points.append(point)
        return {"range": range_id, "step_s": step, "points": points}


sampler = Sampler()
