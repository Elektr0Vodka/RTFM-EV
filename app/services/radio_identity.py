"""Which radio is feeding this install (plan 18 Phase 1).

``register_connected_radio`` runs at the start of post-connect setup: it
records the radio's own key (``mc.self_info["public_key"]``; the keystore
public key only exists when firmware allows private key export) in
``radio_identities`` and caches the active identity in memory.

The 60 s stats sampler asks ``sample_identity`` which radio a sample belongs
to, so a sample taken from a freshly swapped radio before its registration is
skipped rather than filed under the previous radio. Chart reads resolve their
filter through ``resolve_stat_scope``. The pending connect-time question is
surfaced through the health payload (``health_view``), which every tab gets
on WS connect, on each stats tick, and from ``GET /api/health``.
"""

import logging
import time
from typing import Any

from app.models import RadioIdentity
from app.repository.radio_identities import RadioIdentityRepository, StatScope

logger = logging.getLogger(__name__)

# (identity id, lowercase public key) of the radio registered at the last connect.
_active: tuple[int, str] | None = None


def reset_state() -> None:
    """Forget the cached active radio (tests)."""
    global _active
    _active = None


def _own_key(mc: Any) -> tuple[str | None, str | None]:
    info = getattr(mc, "self_info", None)
    if not isinstance(info, dict):
        return None, None
    key = info.get("public_key")
    name = info.get("name")
    clean_key = key.strip().lower() if isinstance(key, str) and key.strip() else None
    return clean_key, name if isinstance(name, str) else None


async def register_connected_radio(mc: Any) -> RadioIdentity | None:
    """Record the connected radio in the registry and make it the active one.

    Never raises: a failure is logged and the sampler then skips persisting
    samples it cannot attribute. When the active radio changes, the
    in-memory 24 h battery / noise-floor buffers are cleared so they do not
    mix two radios' readings.
    """
    global _active
    key, name = _own_key(mc)
    if key is None:
        logger.warning("Connected radio reported no public key; radio identity not recorded")
        return None
    try:
        identity = await RadioIdentityRepository.register_connect(key, name, int(time.time()))
    except Exception:
        logger.exception("Failed to record radio identity for %s", key[:12])
        return None

    previous = _active
    _active = (identity.id, identity.public_key)
    if previous is not None and previous[0] != identity.id:
        from app.services import radio_stats

        radio_stats.clear_sample_buffers()
        logger.info(
            "Connected radio changed (identity %d -> %d); cleared in-memory stat buffers",
            previous[0],
            identity.id,
        )
    if identity.status == "pending":
        logger.info(
            "Radio %s is waiting for a radio identity answer (%s)",
            key[:12],
            identity.pending_reason,
        )
    return identity


def sample_identity(live_public_key: str | None) -> tuple[bool, int | None]:
    """``(persist, radio_identity_id)`` for a stats sample from ``live_public_key``.

    Nothing registered in this process yet: persist unassigned (as before the
    registry). Registered radio matches: persist under its id. Otherwise the
    radio changed and is not registered yet: skip the sample.
    """
    if _active is None:
        return True, None
    if isinstance(live_public_key, str) and live_public_key.strip().lower() == _active[1]:
        return True, _active[0]
    return False, None


async def resolve_stat_scope(radio_id: int | None, unassigned: bool) -> StatScope:
    """Filter for a chart read.

    ``unassigned``: samples recorded before radio tracking. ``radio_id``: that
    radio plus the radios it inherits stats from. Neither: the active radio's
    lineage, or every sample when no radio was ever registered.
    Raises ``RadioIdentityNotFound`` for an unknown ``radio_id``.
    """
    if unassigned:
        return StatScope(unassigned=True)
    if radio_id is None:
        active = await RadioIdentityRepository.get_active()
        if active is None:
            return StatScope()
        radio_id = active.id
    return StatScope(ids=await RadioIdentityRepository.lineage_ids(radio_id, "stats"))


async def health_view() -> dict | None:
    """The active radio for the health payload, or None before any radio connected.

    ``owned_keys`` are the keys whose owned nodes count as this radio's (the
    Owned sidebar section): the radio itself plus predecessors linked with
    ``carry_owned``.
    """
    active = await RadioIdentityRepository.get_active()
    if active is None:
        return None
    return {
        "id": active.id,
        "public_key": active.public_key,
        "name": active.name,
        "status": active.status,
        "pending_reason": active.pending_reason,
        "owned_keys": await RadioIdentityRepository.lineage_keys(active.id, "owned"),
    }
