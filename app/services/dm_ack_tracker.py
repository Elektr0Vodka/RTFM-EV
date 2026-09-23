"""Shared pending ACK tracking for outgoing direct messages."""

import logging
import time

logger = logging.getLogger(__name__)

PendingAck = tuple[int, float, int]
BUFFERED_ACK_TTL_SECONDS = 30.0
# How long a "deleted" mark is kept around. Background DM retries finish well
# inside this window (see DM_SEND_MAX_ATTEMPTS in message_send.py); the mark
# only needs to outlive a retry loop that is already in flight when the delete
# happens.
DELETED_MESSAGE_TTL_SECONDS = 300.0

_pending_acks: dict[str, PendingAck] = {}
_buffered_acks: dict[str, float] = {}
_deleted_message_ids: dict[int, float] = {}


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

    cleanup_expired_deleted_marks()


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


def mark_message_deleted(message_id: int) -> None:
    """Record that a message row was deleted so background DM retries stop.

    Local message delete never sends anything over RF; this only prevents the
    background retry loop in ``message_send.py`` from continuing to send the
    text again for a message that no longer exists.
    """
    _deleted_message_ids[message_id] = time.time()
    logger.debug("Marked message %d deleted for retry cancellation", message_id)


def is_message_deleted(message_id: int) -> bool:
    """True if ``message_id`` was deleted while a background retry was pending."""
    return message_id in _deleted_message_ids


def cleanup_expired_deleted_marks() -> None:
    """Remove deleted-message marks older than their TTL."""
    now = time.time()
    expired = [
        message_id
        for message_id, marked_at in _deleted_message_ids.items()
        if now - marked_at > DELETED_MESSAGE_TTL_SECONDS
    ]
    for message_id in expired:
        del _deleted_message_ids[message_id]
