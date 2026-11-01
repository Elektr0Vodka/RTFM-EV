"""Keeps ``messages.name_filtered`` in step with the operator's name patterns."""

import asyncio
import logging

from app.name_filter import name_matches
from app.repository import AppSettingsRepository, MessageRepository
from app.websocket import broadcast_event

logger = logging.getLogger(__name__)

# Two saves in a row: the later scan runs last, on the list saved last.
_rescan_lock = asyncio.Lock()


async def rescan_messages() -> int:
    """Apply the saved patterns to the stored messages; returns how many rows changed.

    Browsers hold loaded messages with the old flag, so a change is announced
    with a ``name_filter_applied`` event and they load them again.
    """
    async with _rescan_lock:
        patterns = await AppSettingsRepository.get_name_filter_patterns()
        names = await MessageRepository.get_incoming_channel_senders()
        changed = await MessageRepository.set_name_filtered(
            [name for name in names if name_matches(name, patterns)]
        )
    if changed:
        logger.info("Name filter changed the flag on %d stored message(s)", changed)
        broadcast_event("name_filter_applied", {"changed": changed})
    return changed
