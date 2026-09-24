"""New-node notification batching (plan 28 item 1.5).

A "new node" is a public key never stored in ``contacts`` before - the first
advert this install has ever heard for it, whether observed directly on the
advert packet path (``packet_processor._process_advertisement``) or via the
radio's own auto-add (``event_handlers.on_new_contact``, MeshCore
``EventType.NEW_CONTACT``). Both call sites decide "new" against a fresh
``ContactRepository.get_by_key`` read immediately before creating the row, so
a race where both fire for the same key just collapses onto one queued entry
here (dict keyed by public key) instead of double-counting.

This module only decides *whether and when* to broadcast a WS ``new_node``
event; it does not touch contact storage. The frontend decides whether to
show an OS notification for it (per-browser preference, off by default -
see ``useNewNodeNotifications.ts``).

Rate limiting:
- Busy mesh: new nodes are batched. Each call resets a quiet-period timer;
  the batch flushes ``BATCH_QUIET_SECONDS`` after the last new node, or after
  ``BATCH_MAX_WAIT_SECONDS`` from the first one in the batch, whichever comes
  first, so continuous churn cannot delay every notification indefinitely.
  A batch of exactly one node broadcasts full contact detail; more than one
  broadcasts a summary (count + per-type breakdown) only.
- Startup warm-up: if the contacts table was empty when this process started
  (first run, or a fresh/restored database), the initial catch-up burst of
  "never seen before" adverts is not a meaningful signal, so notifications
  are suppressed for ``STARTUP_WARMUP_SECONDS`` after startup. Advert
  intervals for existing mesh nodes are commonly minutes to hours apart, so
  the window is deliberately generous (1 hour) rather than tuned to the
  batching window above. This does not cover an in-place bulk contact import
  performed without a process restart - there is no such feature today
  (``POST /contacts/import-uri`` imports one contact at a time); a future
  bulk-import endpoint should call ``suppress_for()`` itself.
"""

import asyncio
import logging
import time
from dataclasses import dataclass

from app.websocket import broadcast_event

logger = logging.getLogger(__name__)

# Contact type codes that map to a user-facing notification checkbox
# (1=Client/Companion, 2=Repeater, 3=Room, 4=Sensor). Type 0 (unknown/no
# advertised role) never notifies - matches discovery_blocked_types' codes.
_NOTIFIABLE_TYPES = frozenset({1, 2, 3, 4})

BATCH_QUIET_SECONDS = 3.0
BATCH_MAX_WAIT_SECONDS = 15.0
STARTUP_WARMUP_SECONDS = 3600.0


@dataclass(frozen=True)
class _PendingNode:
    public_key: str
    name: str
    type: int


_pending: dict[str, _PendingNode] = {}
_batch_started_at: float | None = None
_flush_task: "asyncio.Task[None] | None" = None
_warmup_until: float = 0.0
_warmup_armed = False


async def arm_startup_warmup() -> None:
    """Arm the startup warm-up window if the contacts table is empty.

    Call once during app startup, after the database connects and before the
    radio connects/syncs. Safe to call more than once (a no-op after the
    first call) so tests and reconnect paths cannot re-arm it mid-session.
    """
    global _warmup_until, _warmup_armed
    if _warmup_armed:
        return
    _warmup_armed = True

    from app.repository import ContactRepository

    try:
        existing = await ContactRepository.get_all(limit=1)
    except Exception:
        logger.debug("Could not check contact count for new-node warm-up", exc_info=True)
        return

    if not existing:
        _warmup_until = time.monotonic() + STARTUP_WARMUP_SECONDS
        logger.info(
            "Contacts table is empty; suppressing new-node notifications for %d minutes",
            int(STARTUP_WARMUP_SECONDS // 60),
        )


def suppress_for(seconds: float) -> None:
    """Suppress new-node notifications for ``seconds`` from now.

    For future use by a bulk contact-import flow that runs without a process
    restart (no such endpoint exists today).
    """
    global _warmup_until
    _warmup_until = max(_warmup_until, time.monotonic() + seconds)


def notify_new_node(public_key: str, name: str, contact_type: int) -> None:
    """Queue a freshly-created contact for a (possibly batched) notification.

    No-op during the startup warm-up window or for a contact type with no
    notification preference (0/unknown).
    """
    if contact_type not in _NOTIFIABLE_TYPES:
        return
    if time.monotonic() < _warmup_until:
        logger.debug("Suppressing new-node notification for %s (startup warm-up)", public_key[:12])
        return

    _queue(public_key.lower(), name, contact_type)


def _queue(public_key: str, name: str, contact_type: int) -> None:
    global _batch_started_at, _flush_task

    _pending[public_key] = _PendingNode(public_key=public_key, name=name, type=contact_type)

    now = time.monotonic()
    if _batch_started_at is None:
        _batch_started_at = now

    if _flush_task is not None and not _flush_task.done():
        _flush_task.cancel()

    remaining_to_cap = max(0.0, BATCH_MAX_WAIT_SECONDS - (now - _batch_started_at))
    delay = min(BATCH_QUIET_SECONDS, remaining_to_cap)

    if delay <= 0:
        _flush_pending()
    else:
        _flush_task = asyncio.create_task(_flush_after_delay(delay))


async def _flush_after_delay(delay: float) -> None:
    try:
        await asyncio.sleep(delay)
    except asyncio.CancelledError:
        return
    _flush_pending()


def _flush_pending() -> None:
    global _pending, _batch_started_at, _flush_task

    if not _pending:
        return

    nodes = list(_pending.values())
    _pending = {}
    _batch_started_at = None
    _flush_task = None

    if len(nodes) == 1:
        node = nodes[0]
        broadcast_event(
            "new_node",
            {
                "batched": False,
                "count": 1,
                "public_key": node.public_key,
                "name": node.name,
                "type": node.type,
                "types": {str(node.type): 1},
            },
        )
    else:
        types: dict[str, int] = {}
        for node in nodes:
            types[str(node.type)] = types.get(str(node.type), 0) + 1
        broadcast_event(
            "new_node",
            {
                "batched": True,
                "count": len(nodes),
                "public_key": None,
                "name": None,
                "type": None,
                "types": types,
            },
        )


def reset_state() -> None:
    """Reset all module state. Test-only."""
    global _pending, _batch_started_at, _flush_task, _warmup_until, _warmup_armed
    if _flush_task is not None and not _flush_task.done():
        _flush_task.cancel()
    _pending = {}
    _batch_started_at = None
    _flush_task = None
    _warmup_until = 0.0
    _warmup_armed = False
