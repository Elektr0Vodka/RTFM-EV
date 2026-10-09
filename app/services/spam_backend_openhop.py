"""Spam Guard enforcement on an OpenHop node.

An OpenHop node forwards on its own, so our rules have to live in its policy
file. This module keeps them there through the node's REST API:

- read ``/api/policy``, keep every rule that is not ours, and write
  ``ours-before + theirs + ours-after`` plus the known-people object
  (``@rtfmspam.known_senders``) when that differs from what the node has;
- write at most once per ``write_interval`` and only on a change;
- read again every ``verify_interval`` and put our rules back when they are
  missing or altered, counting each repair.

Our rules are the ones whose name starts with ``rtfm-spam:``. Nothing else in
the document is ours: the user's rules, the other objects, the groups and
``default_action`` are passed through as read. The node's policy engine is
switched on when there are rules to write and is never switched off again.

A node that carries ``spamguard:`` rules runs the real openhop-spamguard. Two
detectors writing blocks into one policy would fight, so nothing of ours is
written there and what we wrote earlier is taken out.

OpenHop rules do not expire by themselves. A block only ends on the node when
we remove its rule, so our rules are also removed when Spam Guard is switched
off, when the radio is no longer the OpenHop node, and at shutdown.

Facts about the API, read from openhop_repeater (``repeater/policy_engine.py``,
``repeater/web/api_endpoints.py``), not observed on a live node:

- a rule id is untyped; ours are integers;
- ``POST /api/policy`` replaces ``rules``, keeps the stored ``objects`` only
  when the body carries none, and keeps the groups when the body carries none;
- a handler error is HTTP 200 with ``{"success": false, "error": ...}``;
- ``/api/policy_validate`` only normalises the four top-level keys, so it
  cannot reject a rule and is not used as a gate here.

Nothing here transmits, and this module does not import the radio.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from app.spam.rules import OPENHOP_KNOWN_SENDERS, OPENHOP_OBJECT_GROUP, OPENHOP_PREFIX, RuleSet

logger = logging.getLogger(__name__)

# Rule names of flackrat/openhop-spamguard.
SPAMGUARD_PREFIX = "spamguard:"
WRITE_INTERVAL_SECONDS = 2.0
VERIFY_INTERVAL_SECONDS = 60.0
RETRY_INTERVAL_SECONDS = 30.0
# Health turns bad after this many failed syncs in a row.
FAILURES_BAD = 3
# How long shutdown waits for our rules to be taken off the node.
STOP_TIMEOUT_SECONDS = 5.0
_KNOWN_REF = f"@{OPENHOP_OBJECT_GROUP}.{OPENHOP_KNOWN_SENDERS}"


class PolicyClient(Protocol):
    async def get_policy(self) -> dict[str, Any]: ...

    async def update_policy(self, policy: dict[str, Any]) -> dict[str, Any]: ...

    async def aclose(self) -> None: ...


# ``known_node``: we wrote rules to the configured node in this process, so it
# may be asked to give them up even when the radio is no longer that node.
ClientFactory = Callable[..., Awaitable[PolicyClient | None]]


async def client_from_settings(*, known_node: bool) -> PolicyClient | None:
    """A client for the configured OpenHop node, or None when there is none.

    Fail-closed like the OpenHop router: a url and token must be set, and the
    connected radio must be the OpenHop node unless our rules are known to be
    on it.
    """
    from app.repository import AppSettingsRepository
    from app.services.host_repeater_link import radio_snapshot
    from app.services.openhop_api import OpenHopClient

    settings = await AppSettingsRepository.get()
    if not (settings.openhop_api_url and settings.openhop_api_token):
        return None
    if not (known_node or radio_snapshot().is_openhop):
        return None
    return OpenHopClient(settings.openhop_api_url, settings.openhop_api_token)


def _named(rule: Any, prefix: str) -> bool:
    return isinstance(rule, dict) and str(rule.get("name") or "").startswith(prefix)


def _refers_to_known(rules: list[dict[str, Any]]) -> bool:
    return any(
        condition.get("value") == _KNOWN_REF
        for rule in rules
        for condition in rule.get("if", {}).get("all", [])
    )


def _fingerprint(rules: RuleSet) -> str:
    return json.dumps(
        [rules.before, rules.after, rules.known_senders], sort_keys=True, ensure_ascii=False
    )


def _data(response: Any) -> dict[str, Any]:
    """The ``data`` of a ``{success, data}`` envelope; raises on ``success: false``."""
    if not isinstance(response, dict) or not response.get("success", False):
        error = response.get("error") if isinstance(response, dict) else None
        raise RuntimeError(str(error or "the OpenHop node did not accept the request"))
    data = response.get("data")
    return data if isinstance(data, dict) else {}


class OpenHopBackend:
    name = "openhop"

    def __init__(
        self,
        *,
        client_factory: ClientFactory | None = None,
        clock: Callable[[], float] = time.monotonic,
        write_interval: float = WRITE_INTERVAL_SECONDS,
        verify_interval: float = VERIFY_INTERVAL_SECONDS,
        retry_interval: float = RETRY_INTERVAL_SECONDS,
    ) -> None:
        self._client_factory = client_factory or client_from_settings
        self._clock = clock
        self.write_interval = write_interval
        self.verify_interval = verify_interval
        self.retry_interval = retry_interval
        # Called after a sync changed what ``status()`` reports.
        self.on_change: Callable[[], None] | None = None

        self._desired = RuleSet()
        self._desired_fp = _fingerprint(self._desired)
        # Spam Guard is on and this node is its backend: keep verifying.
        self._active = False
        self._dirty = False
        # Rules of ours are, or may still be, on the node.
        self._maybe_present = False
        self._written_fp: str | None = None
        self._state = "idle"
        self._present = 0
        self._repairs = 0
        self._failures = 0
        self._last_error: str | None = None
        self._last_sync_at: float | None = None
        self._last_attempt = float("-inf")

        self._lock = asyncio.Lock()
        self._wake = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    # ── what should be on the node ───────────────────────────────────────

    def want(self, rules: RuleSet) -> None:
        """Keep this rule set on the node (an empty one keeps it free of our rules)."""
        self._set(rules, active=True)

    def release(self) -> None:
        """This node is no longer our backend: take our rules off it."""
        self._set(RuleSet(), active=False)

    def _set(self, rules: RuleSet, *, active: bool) -> None:
        fingerprint = _fingerprint(rules)
        if fingerprint == self._desired_fp and active == self._active:
            return
        self._desired, self._desired_fp, self._active = rules, fingerprint, active
        if not active and not self._maybe_present:
            # Nothing of ours is there, so there is nothing to ask the node.
            self._dirty = False
            self._state = "idle"
            return
        self._dirty = True
        self._state = "pending"
        self._wake.set()

    # ── worker ───────────────────────────────────────────────────────────

    def start(self) -> None:
        """Run the sync worker (idempotent). Needs a running event loop."""
        if self._task is not None and not self._task.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._task = loop.create_task(self._run())

    def _delay(self) -> float | None:
        """Seconds until the next sync is due; None waits for a change."""
        if self._state == "unconfigured":
            # The url and token may be filled in later; a change of rules wakes us sooner.
            return self.verify_interval if self._active or self._maybe_present else None
        if self._failures:
            return self.retry_interval
        if self._dirty:
            return 0.0
        if self._active and (self._maybe_present or self._desired.rules):
            return self.verify_interval
        return None

    async def _run(self) -> None:
        while True:
            delay = self._delay()
            if delay is None or delay > 0:
                try:
                    await asyncio.wait_for(self._wake.wait(), delay)
                except TimeoutError:
                    pass
            self._wake.clear()
            gap = self._last_attempt + self.write_interval - self._clock()
            if gap > 0:
                await asyncio.sleep(gap)
            try:
                await self.sync_once()
            except Exception:
                logger.exception("Spam Guard OpenHop sync failed unexpectedly")

    async def stop(self, *, remove: bool = True) -> None:
        """Stop syncing. ``remove`` takes our rules off the node first (best effort)."""
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        if not (remove and self._maybe_present):
            return
        self._desired = RuleSet()
        self._desired_fp = _fingerprint(self._desired)
        self._active = False
        try:
            await asyncio.wait_for(self.sync_once(), STOP_TIMEOUT_SECONDS)
        except Exception:
            logger.warning("Could not remove the Spam Guard rules from the OpenHop node")

    # ── one read, and one write when needed ──────────────────────────────

    async def sync_once(self) -> str:
        """Bring the node in line: ``written``, ``unchanged``, ``unconfigured`` or ``failed``."""
        async with self._lock:
            before = self.status()
            outcome = await self._sync()
            if self.on_change is not None and self.status() != before:
                try:
                    self.on_change()
                except Exception:
                    logger.exception("Spam Guard OpenHop change callback failed")
            return outcome

    async def _sync(self) -> str:
        fingerprint, desired = self._desired_fp, self._desired
        self._last_attempt = self._clock()
        client = await self._client_factory(known_node=self._maybe_present)
        if client is None:
            self._state = "unconfigured"
            self._failures = 0
            self._last_error = None
            return "unconfigured"
        try:
            outcome = await self._reconcile(client, desired, fingerprint)
        except Exception as exc:
            self._failures += 1
            self._last_error = str(exc) or type(exc).__name__
            self._state = "failed"
            logger.warning("Spam Guard could not sync its rules to OpenHop: %s", self._last_error)
            return "failed"
        finally:
            await client.aclose()
        self._failures = 0
        self._last_error = None
        self._last_sync_at = time.time()
        if self._desired_fp == fingerprint:
            self._dirty = False
        return outcome

    async def _reconcile(self, client: PolicyClient, desired: RuleSet, fingerprint: str) -> str:
        engine = _data(await client.get_policy()).get("policy_engine")
        if not isinstance(engine, dict):
            raise RuntimeError("the OpenHop node returned no policy_engine document")
        raw_rules, raw_objects = engine.get("rules"), engine.get("objects")
        current: list[Any] = raw_rules if isinstance(raw_rules, list) else []
        objects: dict[str, Any] = raw_objects if isinstance(raw_objects, dict) else {}
        enabled = bool(engine.get("enabled", False))

        theirs = [rule for rule in current if not _named(rule, OPENHOP_PREFIX)]
        present = len(current) - len(theirs)
        refused = any(_named(rule, SPAMGUARD_PREFIX) for rule in theirs)
        want = RuleSet() if refused else desired

        rules = [*want.before, *theirs, *want.after]
        target_objects = {k: v for k, v in objects.items() if k != OPENHOP_OBJECT_GROUP}
        if _refers_to_known(want.rules):
            target_objects[OPENHOP_OBJECT_GROUP] = {OPENHOP_KNOWN_SENDERS: want.known_senders}
        target_enabled = enabled or bool(want.rules)

        settled = "refused" if refused else "synced" if self._active else "idle"
        if rules == current and target_objects == objects and target_enabled == enabled:
            self._present = present
            self._maybe_present = present > 0
            self._state = settled
            if not refused:
                self._written_fp = fingerprint
            return "unchanged"

        _data(
            await client.update_policy(
                {
                    "policy_engine": {
                        "enabled": target_enabled,
                        "default_action": str(engine.get("default_action", "allow")),
                        "rules": rules,
                        "objects": target_objects,
                    }
                }
            )
        )
        if not refused and self._written_fp == fingerprint:
            # We wrote exactly this before and the node no longer had it.
            self._repairs += 1
            logger.warning("Spam Guard rules on the OpenHop node were changed; restored them")
        self._written_fp = None if refused else fingerprint
        self._present = len(want.rules)
        self._maybe_present = self._present > 0
        self._state = settled
        return "written"

    # ── reporting ────────────────────────────────────────────────────────

    def status(self) -> dict[str, Any]:
        expected = len(self._desired.rules) if self._active and self._state != "refused" else 0
        return {
            "backend": self.name,
            # idle / pending / synced / unconfigured / refused / failed
            "state": self._state,
            "rules_expected": expected,
            "rules_present": self._present,
            "repairs": self._repairs,
            "failures": self._failures,
            "last_sync_at": self._last_sync_at,
            "last_error": self._last_error,
        }
