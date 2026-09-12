import asyncio
import logging
import time

from app.repository import AppSettingsRepository
from app.repository.advert_events import AdvertEventRepository

logger = logging.getLogger(__name__)

PRUNE_INTERVAL_SECONDS = 86400  # daily
_prune_task: asyncio.Task | None = None


async def prune_once() -> int:
    """Prune advert_events older than the configured retention, once."""
    settings = await AppSettingsRepository.get()
    days = max(1, int(settings.advert_retention_days or 30))
    cutoff = int(time.time()) - days * 86400
    deleted = await AdvertEventRepository.prune_older_than(cutoff)
    if deleted:
        logger.info("Pruned %d advert_events older than %d days", deleted, days)
    return deleted


async def _prune_loop() -> None:
    # Run shortly after startup, then daily.
    while True:
        try:
            await asyncio.sleep(60)
            await prune_once()
            await asyncio.sleep(PRUNE_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("Advert prune task cancelled")
            break
        except Exception as e:
            logger.error("Error in advert prune loop: %s", e, exc_info=True)
            await asyncio.sleep(PRUNE_INTERVAL_SECONDS)


def start_advert_prune() -> None:
    global _prune_task
    if _prune_task is None or _prune_task.done():
        _prune_task = asyncio.create_task(_prune_loop())
        logger.info("Started advert-event prune loop")


async def stop_advert_prune() -> None:
    global _prune_task
    if _prune_task and not _prune_task.done():
        _prune_task.cancel()
        try:
            await _prune_task
        except asyncio.CancelledError:
            pass
        _prune_task = None
        logger.info("Stopped advert-event prune loop")
