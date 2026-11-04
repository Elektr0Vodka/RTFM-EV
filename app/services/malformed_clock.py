"""Keeps ``messages.malformed`` in step with the operator's clock-ahead limit."""

import asyncio
import logging

from app.malformed import malformed_reason
from app.repository import AppSettingsRepository, MessageRepository
from app.websocket import broadcast_event

logger = logging.getLogger(__name__)

# Two saves in a row: the later scan runs last, on the limit saved last.
_rescan_lock = asyncio.Lock()


def _body(text: str | None, sender_name: str | None) -> str:
    """The message text without the ``sender: `` prefix, as checked at ingest."""
    body = text or ""
    prefix = f"{sender_name}: " if sender_name else ""
    return body[len(prefix) :] if prefix and body.startswith(prefix) else body


async def rescan_clock_ahead() -> int:
    """Apply the saved limit to stored future-stamped messages; returns rows changed.

    Only a row stamped after it was received can change, so only those are
    read; the rest of the malformed rule (text, a clock never set) is checked
    again with them. Browsers hold loaded messages with the old flag, so a
    change is announced with a ``malformed_applied`` event and they load them
    again.
    """
    async with _rescan_lock:
        minutes = await AppSettingsRepository.get_malformed_clock_ahead_minutes()
        updates: list[tuple[int, bool, str | None]] = []
        for row in await MessageRepository.get_future_stamped_channel_rows():
            reason = malformed_reason(
                _body(row["text"], row["sender_name"]),
                row["sender_timestamp"],
                row["received_at"],
                minutes,
            )
            if bool(row["malformed"]) != (reason is not None) or row["malformed_reason"] != reason:
                updates.append((row["id"], reason is not None, reason))
        changed = await MessageRepository.set_malformed(updates)
    if changed:
        logger.info("Clock-ahead limit changed the malformed flag on %d message(s)", changed)
        broadcast_event("malformed_applied", {"changed": changed})
    return changed
