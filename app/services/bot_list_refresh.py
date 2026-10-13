"""Hourly check that refreshes subscribed bot lists once a day.

Each pass asks the service for the subscriptions whose last good fetch is 24
hours old or older. With no subscription it does nothing and contacts nobody.
"""

import asyncio
import logging

from app.services.bot_lists import bot_lists

logger = logging.getLogger(__name__)

FIRST_CHECK_SECONDS = 120
CHECK_INTERVAL_SECONDS = 3600

_refresh_task: asyncio.Task[None] | None = None


async def run_bot_list_refresh_once() -> int:
    """One pass. Returns how many subscriptions were tried."""
    return await bot_lists.refresh_due()


async def _refresh_loop() -> None:
    await asyncio.sleep(FIRST_CHECK_SECONDS)
    while True:
        try:
            await run_bot_list_refresh_once()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Error in bot list refresh loop: %s", e, exc_info=True)
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)


def start_bot_list_refresh() -> None:
    global _refresh_task
    if _refresh_task is None or _refresh_task.done():
        _refresh_task = asyncio.create_task(_refresh_loop())
        logger.info("Started bot list refresh loop")


async def stop_bot_list_refresh() -> None:
    global _refresh_task
    if _refresh_task and not _refresh_task.done():
        _refresh_task.cancel()
        try:
            await _refresh_task
        except asyncio.CancelledError:
            pass
        _refresh_task = None
        logger.info("Stopped bot list refresh loop")
