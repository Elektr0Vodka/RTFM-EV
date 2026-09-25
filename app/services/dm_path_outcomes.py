"""Record which route each direct-message attempt used and how it went (plan 28 item 1.15).

The firmware picks the route for ``send_msg``: the contact's learned direct path
(``out_path`` / ``out_path_len`` on the radio's contact record) or a flood when it
has none. ``message_send`` tells this module about every attempt, ``dm_ack_apply``
about the ACK that closed it and ``_mark_direct_message_failed`` about the ones
that ran out. Outcomes are upserted into ``contact_path_outcomes`` (migration
``_115``) per ``(contact, path, hop count)``; ``path_scoring`` ranks them for the
contact info view. Display only: nothing here changes how a DM is routed, and a
recording failure never fails a send.

Weights follow meshcore-open ``recordPathResult``: +0.5 per success (max 5.0),
-0.5 per failure (floor 0.1). meshcore-open deletes a path after three failures at
weight 0; RTFM-EV keeps the row so the history stays visible.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from app.path_utils import normalize_contact_route
from app.repository.contacts import ContactPathOutcomeRepository

logger = logging.getLogger(__name__)

FLOOD_PATH_LEN = -1
ATTEMPT_TTL_SECONDS = 3600.0
MAX_TRACKED_MESSAGES = 2000


@dataclass(frozen=True)
class RouteUsed:
    path_hex: str
    path_len: int  # -1 flood, 0 direct neighbour, > 0 hops

    @property
    def is_flood(self) -> bool:
        return self.path_len == FLOOD_PATH_LEN


@dataclass
class _Attempt:
    route: RouteUsed
    started: float  # monotonic seconds when the send command was issued
    public_key: str


_attempts: dict[int, list[_Attempt]] = {}


def route_from_radio_contact(radio_contact: object) -> RouteUsed:
    """The route the firmware will use for ``send_msg`` to this contact record."""
    if not isinstance(radio_contact, dict):
        return RouteUsed("", FLOOD_PATH_LEN)
    raw_path = radio_contact.get("out_path")
    if isinstance(raw_path, (bytes, bytearray)):
        raw_path = raw_path.hex()
    path_hex, path_len, _mode = normalize_contact_route(
        raw_path if isinstance(raw_path, str) else None,
        radio_contact.get("out_path_len", FLOOD_PATH_LEN),
        None,
    )
    if path_len < 0:
        return RouteUsed("", FLOOD_PATH_LEN)
    return RouteUsed(path_hex.lower(), path_len)


def _prune(now_mono: float) -> None:
    stale = [
        mid
        for mid, tries in _attempts.items()
        if now_mono - tries[-1].started > ATTEMPT_TTL_SECONDS
    ]
    for mid in stale:
        del _attempts[mid]
    while len(_attempts) > MAX_TRACKED_MESSAGES:
        del _attempts[next(iter(_attempts))]


async def record_attempt(
    message_id: int, public_key: str, radio_contact: object, started: float | None = None
) -> None:
    """One ``send_msg`` went out for ``message_id`` using the contact's current route."""
    started = time.monotonic() if started is None else started
    route = route_from_radio_contact(radio_contact)
    _prune(started)
    _attempts.setdefault(message_id, []).append(_Attempt(route, started, public_key.lower()))
    try:
        await ContactPathOutcomeRepository.record_attempt(
            public_key.lower(), route.path_hex, route.path_len, int(time.time())
        )
    except Exception:
        logger.debug("Could not record DM path attempt", exc_info=True)


async def record_ack(message_id: int, *, now: float | None = None) -> bool:
    """The DM was acknowledged: credit the last attempt's route with the trip time."""
    tries = _attempts.pop(message_id, None)
    if not tries:
        return False
    now = time.monotonic() if now is None else now
    last = tries[-1]
    trip_ms = max(0, int(round((now - last.started) * 1000.0)))
    try:
        await ContactPathOutcomeRepository.record_success(
            last.public_key, last.route.path_hex, last.route.path_len, int(time.time()), trip_ms
        )
    except Exception:
        logger.debug("Could not record DM path success", exc_info=True)
    return True


async def record_failed(message_id: int) -> bool:
    """Every route tried for the DM failed once (one failure per distinct route)."""
    tries = _attempts.pop(message_id, None)
    if not tries:
        return False
    seen: set[RouteUsed] = set()
    for attempt in tries:
        if attempt.route in seen:
            continue
        seen.add(attempt.route)
        try:
            await ContactPathOutcomeRepository.record_failure(
                attempt.public_key, attempt.route.path_hex, attempt.route.path_len, int(time.time())
            )
        except Exception:
            logger.debug("Could not record DM path failure", exc_info=True)
    return True


def forget(message_id: int) -> None:
    _attempts.pop(message_id, None)


def pending_attempts(message_id: int) -> int:
    return len(_attempts.get(message_id, ()))
