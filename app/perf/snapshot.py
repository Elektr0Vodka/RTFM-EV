"""Builds the full Performance snapshot from the recorders and live app state."""

import asyncio
import logging
import os
import sqlite3
import time
from collections import Counter

from app.config import settings
from app.database import db
from app.perf.health import evaluate
from app.perf.loopwatch import loop_watch
from app.perf.process import process_stats
from app.perf.recorders import db_calls, log_tail, loops, outputs, pipeline, radio_ops, routes
from app.perf.sampler import sampler

logger = logging.getLogger(__name__)


def _file_mb(path: str) -> float | None:
    try:
        return round(os.path.getsize(path) / 1_048_576, 2)
    except OSError:
        return None


def _asyncio_tasks() -> list[dict]:
    counts: Counter[str] = Counter()
    for task in asyncio.all_tasks():
        coro = task.get_coro()
        counts[getattr(coro, "__qualname__", None) or task.get_name()] += 1
    return [{"name": name, "count": n} for name, n in counts.most_common()]


async def _push_subscriptions() -> int | None:
    try:
        async with db.readonly() as conn:
            async with conn.execute("SELECT COUNT(*) FROM push_subscriptions") as cursor:
                row = await cursor.fetchone()
        return int(row[0]) if row else 0
    except (RuntimeError, sqlite3.Error):
        return None


async def _oldest_undecrypted() -> int | None:
    from app.repository import RawPacketRepository

    try:
        return await RawPacketRepository.get_oldest_undecrypted()
    except (RuntimeError, sqlite3.Error):
        return None


def _radio() -> dict:
    from app.services.radio_runtime import radio_runtime as radio_manager

    return {
        "connected": bool(getattr(radio_manager, "is_connected", False)),
        "desired": bool(getattr(radio_manager, "connection_desired", True)),
        "connection_info": getattr(radio_manager, "connection_info", None),
        "queue": _radio_queue(radio_manager),
        **radio_ops.snapshot(),
    }


def _radio_queue(radio_manager) -> dict:
    empty: dict = {"holder": None, "waiting": []}
    queue = getattr(radio_manager, "operation_queue", None)
    if not callable(queue):
        return empty
    try:
        result = queue()
    except Exception:
        return empty
    return result if isinstance(result, dict) else empty


async def _outputs() -> dict:
    from app.fanout.manager import fanout_manager
    from app.tak_stream.server import tak_stream
    from app.websocket import ws_manager

    stats = outputs.snapshot()
    modules = []
    try:
        statuses = fanout_manager.get_statuses()
    except Exception:
        statuses = {}
    for config_id, info in statuses.items():
        modules.append({"id": config_id, **info, **stats.get(config_id, {})})
    modules.sort(key=lambda m: str(m.get("name") or ""))
    return {
        "modules": modules,
        "websocket_clients": len(ws_manager.active_connections),
        "tak_stream": tak_stream.status(),
        "push_subscriptions": await _push_subscriptions(),
    }


async def build_snapshot() -> dict:
    now = time.time()
    process = sampler.latest_process or process_stats(None)[0]
    readers, readers_busy = db.reader_pool_status()
    database = {
        **db_calls.snapshot(),
        "file_mb": _file_mb(settings.database_path),
        "wal_mb": _file_mb(settings.database_path + "-wal"),
        "readers": readers,
        "readers_busy": readers_busy,
    }
    snapshot = {
        "generated_at": now,
        "process": process,
        "latest": sampler.latest(),
        "loop": {
            "lag": loop_watch.lag.hour.last_hour(now).summary(),
            "stalls": loop_watch.stalls(30),
            "stalls_last_hour": len(loop_watch.stalls_since(now - 3600)),
        },
        "tasks": loops.rows(now),
        "asyncio_tasks": _asyncio_tasks(),
        "pipeline": {**pipeline.snapshot(), "oldest_undecrypted": await _oldest_undecrypted()},
        "database": database,
        "radio": _radio(),
        "outputs": await _outputs(),
        "routes": routes.snapshot(),
        "logs": log_tail.records(100),
    }
    snapshot["health"] = evaluate(snapshot, now)
    return snapshot
