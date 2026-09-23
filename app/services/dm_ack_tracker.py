"""Shared pending ACK tracking for outgoing direct messages."""

import logging
import time

logger = logging.getLogger(__name__)

PendingAck = tuple[int, float, int]
BUFFERED_ACK_TTL_SECONDS = 30.0
# After a DM is marked failed, its ACK codes stay matchable this long so a late
# ACK still flips it to delivered (meshcore-open does the same). After that a
# late ACK is treated as unmatched and the message stays failed.
FAILED_ACK_GRACE_SECONDS = 30.0

_pending_acks: dict[str, PendingAck] = {}
_buffered_acks: dict[str, float] = {}
# ack code -> (message_id, time.time() when the message was marked failed)
_failed_acks: dict[str, tuple[int, float]] = {}


def track_pending_ack(expected_ack: str, message_id: int, timeout_ms: int) -> bool:
    """Track an expected ACK code for an outgoing direct message.

    Returns True when the ACK was already observed and buffered before registration.
    """
    buffered_at = _buffered_acks.pop(expected_ack, None)
    if buffered_at is not None:
        logger.debug(
            "Matched buffered ACK %s immediately for message %d",
            expected_ack,
            message_id,
        )
        return True

    _pending_acks[expected_ack] = (message_id, time.time(), timeout_ms)
    logger.debug(
        "Tracking pending ACK %s for message %d (timeout %dms)",
        expected_ack,
        message_id,
        timeout_ms,
    )
    return False


def buffer_unmatched_ack(ack_code: str) -> None:
    """Remember an ACK that arrived before its message registration."""
    _buffered_acks[ack_code] = time.time()
    logger.debug("Buffered unmatched ACK %s for late registration", ack_code)


def cleanup_expired_acks() -> None:
    """Remove stale pending ACK entries."""
    now = time.time()
    expired_codes = [
        code
        for code, (_message_id, created_at, timeout_ms) in _pending_acks.items()
        if now - created_at > (timeout_ms / 1000) * 2
    ]
    for code in expired_codes:
        del _pending_acks[code]
        logger.debug("Expired pending ACK %s", code)

    expired_buffered_codes = [
        code
        for code, buffered_at in _buffered_acks.items()
        if now - buffered_at > BUFFERED_ACK_TTL_SECONDS
    ]
    for code in expired_buffered_codes:
        del _buffered_acks[code]
        logger.debug("Expired buffered ACK %s", code)

    expired_failed_codes = [
        code
        for code, (_message_id, failed_at) in _failed_acks.items()
        if now - failed_at > FAILED_ACK_GRACE_SECONDS
    ]
    for code in expired_failed_codes:
        del _failed_acks[code]
        logger.debug("Expired failed-message ACK grace for %s", code)


def pop_pending_ack(ack_code: str) -> int | None:
    """Claim the tracked message ID for an ACK code if present."""
    pending = _pending_acks.pop(ack_code, None)
    if pending is None:
        return None
    message_id, _, _ = pending
    return message_id


def clear_pending_acks_for_message(message_id: int) -> None:
    """Remove any still-pending ACK codes for a message once one ACK wins."""
    sibling_codes = [
        code
        for code, (pending_message_id, _created_at, _timeout_ms) in _pending_acks.items()
        if pending_message_id == message_id
    ]
    for code in sibling_codes:
        del _pending_acks[code]
        logger.debug("Cleared sibling pending ACK %s for message %d", code, message_id)
    clear_failed_acks_for_message(message_id)


def track_failed_acks(ack_codes: list[str], message_id: int) -> None:
    """Keep a failed DM's ACK codes matchable for ``FAILED_ACK_GRACE_SECONDS``.

    Replaces any still-pending entries for the message, so the codes are held in
    exactly one place.
    """
    for code, (pending_message_id, _created_at, _timeout_ms) in list(_pending_acks.items()):
        if pending_message_id == message_id:
            del _pending_acks[code]
    failed_at = time.time()
    for code in ack_codes:
        _failed_acks[code] = (message_id, failed_at)
    logger.debug(
        "Holding %d ACK code(s) for failed message %d for late delivery",
        len(ack_codes),
        message_id,
    )


def pop_failed_ack(ack_code: str) -> int | None:
    """Claim a failed message's ID for a late ACK still inside its grace window."""
    entry = _failed_acks.pop(ack_code, None)
    if entry is None:
        return None
    message_id, failed_at = entry
    if time.time() - failed_at > FAILED_ACK_GRACE_SECONDS:
        return None
    return message_id


def clear_failed_acks_for_message(message_id: int) -> None:
    """Drop any failed-grace ACK codes held for a message."""
    for code, (failed_message_id, _failed_at) in list(_failed_acks.items()):
        if failed_message_id == message_id:
            del _failed_acks[code]
