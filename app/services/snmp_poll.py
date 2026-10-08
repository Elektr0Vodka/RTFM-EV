"""Poll contacts' SNMP agents, record the outcome, and run the poll schedule.

LAN only: this talks UDP to the address stored in ``contact_snmp`` and never
touches the radio. ``poll_contact`` serves the "Poll now" endpoint and the
scheduler; every good poll is stored in ``snmp_history``.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.models import SnmpPollResponse
from app.repository.contact_snmp import ContactSnmpRepository, SnmpHistoryRepository
from app.snmp.client import SnmpError, poll_meshcore

logger = logging.getLogger(__name__)

NO_MESHCORE_OIDS = "The agent answered, but serves none of the MeshCore OIDs"

# The schedule is checked this often; a contact is polled when its own
# poll_interval_minutes has passed since its last attempt.
SCHEDULE_TICK_SECONDS = 30
MAX_CONCURRENT_POLLS = 4

_schedule_task: asyncio.Task | None = None
# Keeps fire-and-forget fanout tasks alive until they finish.
_background_tasks: set[asyncio.Task] = set()


def _broadcast(public_key: str, timestamp: int, values: dict[str, Any]) -> None:
    """Hand a good poll to the fanout modules (e.g. HA MQTT), fire and forget.

    Only the key, time and values go out; the address and community stay here.
    """
    from app.fanout.manager import fanout_manager

    task = asyncio.create_task(
        fanout_manager.broadcast_snmp(
            {"public_key": public_key, "timestamp": timestamp, "values": dict(values)}
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def poll_contact(config: dict[str, Any]) -> SnmpPollResponse:
    """Poll the agent described by a ``contact_snmp`` row. Never raises for a
    failed poll: the failure is recorded on the row and returned."""
    public_key: str = config["public_key"]
    host: str = config["host"]
    port: int = config["port"]

    error: str | None = None
    values = None
    try:
        values = await poll_meshcore(host, port, config["community"])
    except SnmpError as exc:
        error = str(exc)
    else:
        if all(value is None for value in values.values()):
            values = None
            error = NO_MESHCORE_OIDS

    now = int(time.time())
    if error is None and values is not None:
        await ContactSnmpRepository.record_ok(public_key, now)
        await SnmpHistoryRepository.record(public_key, now, values)
        _broadcast(public_key, now, values)
    else:
        logger.info("SNMP poll of %s (%s:%d) failed: %s", public_key[:12], host, port, error)
        await ContactSnmpRepository.record_error(public_key, now, error or "unknown error")
    return SnmpPollResponse(
        ok=error is None, timestamp=now, host=host, port=port, error=error, values=values
    )


def is_due(config: dict[str, Any], now: int) -> bool:
    """True when a scheduled contact's interval has passed since its last
    attempt, good or failed. A contact that was never polled is due."""
    last_attempt = max(config.get("last_ok_at") or 0, config.get("last_error_at") or 0)
    return now - last_attempt >= config["poll_interval_minutes"] * 60


async def run_scheduled_polls_once(now: int | None = None) -> int:
    """Poll every scheduled contact that is due. Returns how many were polled."""
    now = int(time.time()) if now is None else now
    due = [row for row in await ContactSnmpRepository.list_poll_enabled() if is_due(row, now)]
    if not due:
        return 0
    limit = asyncio.Semaphore(MAX_CONCURRENT_POLLS)

    async def _one(row: dict[str, Any]) -> None:
        async with limit:
            try:
                await poll_contact(row)
            except Exception:  # noqa: BLE001 - one bad contact must not stop the rest
                logger.exception("Scheduled SNMP poll of %s failed", row["public_key"][:12])

    await asyncio.gather(*(_one(row) for row in due))
    return len(due)


async def _schedule_loop() -> None:
    await asyncio.sleep(SCHEDULE_TICK_SECONDS)
    while True:
        try:
            await run_scheduled_polls_once()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Error in SNMP poll schedule: %s", e, exc_info=True)
        await asyncio.sleep(SCHEDULE_TICK_SECONDS)


def start_snmp_poll_schedule() -> None:
    global _schedule_task
    if _schedule_task is None or _schedule_task.done():
        _schedule_task = asyncio.create_task(_schedule_loop())
        logger.info("Started SNMP poll schedule")


async def stop_snmp_poll_schedule() -> None:
    global _schedule_task
    if _schedule_task and not _schedule_task.done():
        _schedule_task.cancel()
        try:
            await _schedule_task
        except asyncio.CancelledError:
            pass
        _schedule_task = None
        logger.info("Stopped SNMP poll schedule")
