"""Shared direct-message ACK application logic."""

import logging

from app.services import dm_ack_tracker, dm_path_outcomes
from app.services.messages import BroadcastFn, increment_ack_and_broadcast

logger = logging.getLogger(__name__)


async def apply_dm_ack_code(ack_code: str, *, broadcast_fn: BroadcastFn) -> bool:
    """Apply a DM ACK code using the shared pending/buffered state machine.

    A late ACK for a DM already marked failed still counts while it is inside
    ``dm_ack_tracker.FAILED_ACK_GRACE_SECONDS``: the ACK increment clears the
    failed marker and the ``message_acked`` broadcast flips the UI to delivered.
    Later than that it is buffered like any unmatched ACK and the DM stays failed.

    Returns True when the ACK matched a message, False when it was buffered.
    """
    dm_ack_tracker.cleanup_expired_acks()

    message_id = dm_ack_tracker.pop_pending_ack(ack_code)
    if message_id is None:
        message_id = dm_ack_tracker.pop_failed_ack(ack_code)
        if message_id is not None:
            logger.info("Late ACK %s recovered failed message %d", ack_code, message_id)
    if message_id is None:
        dm_ack_tracker.buffer_unmatched_ack(ack_code)
        return False

    dm_ack_tracker.clear_pending_acks_for_message(message_id)
    await dm_path_outcomes.record_ack(message_id)
    await increment_ack_and_broadcast(message_id=message_id, broadcast_fn=broadcast_fn)
    return True
