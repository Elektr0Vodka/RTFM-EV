import asyncio
import logging
import time

from app.repository import AppSettingsRepository
from app.repository.raw_packets import RawPacketRepository

logger = logging.getLogger(__name__)

PRUNE_INTERVAL_SECONDS = 86400  # daily
_prune_task: asyncio.Task | None = None


async def prune_once() -> int:
    """Prune raw_packets older than the configured retention, once.

    No-op (returns 0) when raw_packet_retention_days is 0 (keep forever).
    Reads the setting each call so config changes take effect without restart.
    """
    settings = await AppSettingsRepository.get()
    days = int(settings.raw_packet_retention_days or 0)
    if days <= 0:
        return 0
    cutoff = int(time.time()) - days * 86400
    deleted = await RawPacketRepository.prune_older_than(cutoff)
    if deleted:
        logger.info("Pruned %d raw_packets older than %d days", deleted, days)
    return deleted


async def _prune_loop() -> None:
    # Run shortly after startup, then daily.
    while True:
        try:
            await asyncio.sleep(60)
            await prune_once()
            await asyncio.sleep(PRUNE_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("Raw-packet prune task cancelled")
            break
        except Exception as e:
            logger.error("Error in raw-packet prune loop: %s", e, exc_info=True)
            await asyncio.sleep(PRUNE_INTERVAL_SECONDS)


def start_raw_packet_prune() -> None:
    global _prune_task
    if _prune_task is None or _prune_task.done():
        _prune_task = asyncio.create_task(_prune_loop())
        logger.info("Started raw-packet prune loop")


async def stop_raw_packet_prune() -> None:
    global _prune_task
    if _prune_task and not _prune_task.done():
        _prune_task.cancel()
        try:
            await _prune_task
        except asyncio.CancelledError:
            pass
        _prune_task = None
        logger.info("Stopped raw-packet prune loop")
