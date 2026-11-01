"""The wardrive audit log: who did what and when, for the owner's Drivers tab.

Logged: logins (and refused ones, by the username typed), logouts,
registrations, radios added or removed, the owner's user, group and config
changes, password sets, and drive edits. Never a password, token or packet.
Writing the log never fails the action it records."""

import logging
import time
from typing import Any, Literal

from app.repository.wardrive import WardriveAuditRepository

logger = logging.getLogger(__name__)

MAX_ROWS = 10000

Actor = Literal["owner", "driver"]


async def record(
    actor_kind: Actor,
    actor_id: int | None,
    action: str,
    target_kind: str | None = None,
    target_id: str | int | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    try:
        await WardriveAuditRepository.add(
            int(time.time()),
            actor_kind,
            actor_id,
            action,
            target_kind,
            None if target_id is None else str(target_id),
            detail,
        )
        await WardriveAuditRepository.prune(MAX_ROWS)
    except Exception:
        logger.exception("Wardrive audit write failed for %s", action)


async def recent(limit: int = 100) -> list[dict[str, Any]]:
    return await WardriveAuditRepository.recent(limit)
