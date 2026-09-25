"""Retention prune service: applies every per-class retention setting.

Replaces the per-table daily loops (advert events, raw packets) and the
scattered prune-on-insert / hourly prune points (telemetry, link signal). One
loop ticks every minute and runs ``prune_once`` when
``retention_prune_interval_hours`` has elapsed since the last run, so an
interval change takes effect without a restart.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from app.repository import AppSettingsRepository
from app.repository.retention import RetentionRepository

logger = logging.getLogger(__name__)

TICK_SECONDS = 60
DAY_SECONDS = 86400

_lock = asyncio.Lock()
_task: asyncio.Task | None = None
_last_run_at: int | None = None
_last_result: dict[str, int] = {}


def _cutoff(days: int, now: int) -> int:
    return now - days * DAY_SECONDS


async def _run_step(result: dict[str, int], key: str, step: Callable[[], Awaitable[int]]) -> None:
    """Run one prune step, isolating failures so other classes still run."""
    try:
        deleted = await step()
    except Exception as e:  # noqa: BLE001 - one class must not block the rest
        logger.error("Retention prune failed for %s: %s", key, e, exc_info=True)
        return
    result[key] = result.get(key, 0) + deleted


async def prune_once(now: int | None = None) -> dict[str, int]:
    """Apply every retention setting once and return rows deleted per class.

    A value of 0 means keep forever (or no row cap) and skips that class.
    Settings are re-read on every call.
    """
    global _last_run_at, _last_result
    async with _lock:
        now = int(now if now is not None else time.time())
        s = await AppSettingsRepository.get()
        result: dict[str, int] = {}

        age_settings = {
            "raw_packets": s.raw_packet_retention_days,
            "advert_events": s.advert_retention_days,
            "repeater_telemetry": s.telemetry_retention_days,
            "contact_telemetry": s.telemetry_retention_days,
            "link_signal": s.link_signal_retention_days,
            "noise_floor": s.noise_floor_retention_days,
            "battery": s.battery_retention_days,
            "airtime": s.airtime_retention_days,
            "link_edges": s.link_edge_retention_days,
            "packet_receptions": s.packet_reception_retention_days,
            "device_config": s.device_history_retention_days,
            "contact_locations": s.device_history_retention_days,
        }
        for key, days in age_settings.items():
            if days > 0:
                cutoff = _cutoff(days, now)
                await _run_step(
                    result,
                    key,
                    lambda key=key, cutoff=cutoff: RetentionRepository.prune_older_than(
                        key, cutoff
                    ),
                )

        if s.telemetry_max_rows_per_node > 0:
            for key, table in (
                ("repeater_telemetry", "repeater_telemetry_history"),
                ("contact_telemetry", "contact_telemetry_history"),
            ):
                await _run_step(
                    result,
                    key,
                    lambda table=table: RetentionRepository.cap_rows_per_node(
                        table, s.telemetry_max_rows_per_node
                    ),
                )

        await _run_step(
            result,
            "advert_paths",
            lambda: RetentionRepository.trim_advert_paths(s.advert_paths_per_contact),
        )

        if s.message_retention_days > 0:
            linked_raw: list[int] = []

            async def _prune_messages() -> int:
                messages, raw = await RetentionRepository.prune_messages_older_than(
                    _cutoff(s.message_retention_days, now)
                )
                linked_raw.append(raw)
                return messages

            await _run_step(result, "messages", _prune_messages)
            if linked_raw:
                result["messages_raw_packets"] = linked_raw[0]

        if sum(result.values()) > 0:
            try:
                await RetentionRepository.incremental_vacuum()
            except Exception as e:  # noqa: BLE001 - space reclaim is best-effort
                logger.warning("incremental_vacuum after retention prune failed: %s", e)

        deleted = {k: v for k, v in result.items() if v}
        if deleted:
            logger.info("Retention prune deleted rows: %s", deleted)

        _last_run_at = now
        _last_result = result
        return result


def status() -> dict:
    """Last run time (unix seconds, or None) and its per-class result."""
    return {"last_run_at": _last_run_at, "last_result": dict(_last_result)}


def is_due(now: float, interval_hours: int) -> bool:
    return _last_run_at is None or now - _last_run_at >= interval_hours * 3600


async def _loop() -> None:
    # First run shortly after startup, then whenever the interval has elapsed.
    while True:
        try:
            await asyncio.sleep(TICK_SECONDS)
            settings = await AppSettingsRepository.get()
            if is_due(time.time(), settings.retention_prune_interval_hours):
                await prune_once()
        except asyncio.CancelledError:
            logger.info("Retention prune task cancelled")
            break
        except Exception as e:
            logger.error("Error in retention prune loop: %s", e, exc_info=True)


def start_retention_prune() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())
        logger.info("Started retention prune loop")


async def stop_retention_prune() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
        logger.info("Stopped retention prune loop")
