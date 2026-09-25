"""OpenHop-style policy rules for the host repeater (pure, no I/O).

Port of the evaluation semantics of openhop_repeater ``repeater/policy_engine.py``:
rules are checked top-down, the first enabled matching rule decides, otherwise
``default_action`` applies. ``drop`` blocks the forward; ``allow`` and
``log_only`` let the packet continue to the normal forwarding gates (an allow
rule never bypasses them, same as OpenHop). Differences from OpenHop: the stored
document is validated strictly (``host_repeater_settings``), so there is no
coercion of unknown actions here, and the channel fields come from RTFM-EV's
own channel decryption instead of an inline secret list.

Host additions modelled on the jhuebert/MeshCore repeater packet filter
(``FILTER.md``): the ``matches`` regex operator, and per-rule ``prob`` /
``throttle_seconds`` gates. Both answer "does this rule get to decide the
packet it matched?"; when the answer is no the rule steps aside and evaluation
continues with the next rule, exactly as if the conditions had not matched.
``prob`` rolls deterministically per (rule, packet hash), so the same packet
always gets the same verdict; ``throttle_seconds`` keeps one budget per rule
(or per sender / channel / first hop with ``throttle_key``), lets one match per
window slip past as a ``pass`` and decides the excess. Throttle state lives in a
``PolicyState`` the caller owns (RAM only, like the firmware).
"""

from __future__ import annotations

import hashlib
import re
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from app.services.host_repeater_settings import MAX_REGEX_LENGTH, PolicyConfig, PolicyRule

_OBJECT_REF = re.compile(r"^@([a-z_]+)\.(.+)$")
_REGEX_CACHE: OrderedDict[str, re.Pattern[str] | None] = OrderedDict()
_REGEX_CACHE_MAX = 256


@dataclass(frozen=True)
class PolicyDecision:
    action: str
    matched: bool
    rule_id: str | None = None
    rule_name: str | None = None
    # Rules whose conditions matched but that let this packet slip within their
    # throttle budget (the fork's ``pass=`` counter); they did not decide it.
    passes: tuple[str, ...] = ()


class PolicyState:
    """Per-rule throttle budgets: last free-pass time keyed by (rule id, throttle key)."""

    def __init__(self, max_entries: int = 4096) -> None:
        self._last_pass: OrderedDict[tuple[str, str], float] = OrderedDict()
        self._max = max(1, max_entries)

    def __len__(self) -> int:
        return len(self._last_pass)

    def clear(self) -> None:
        self._last_pass.clear()

    def take_pass(self, rule_id: str, key: str, now: float, window_s: int) -> bool:
        """True when this match gets the window's free pass (and consumes it)."""
        slot = (rule_id, key)
        last = self._last_pass.get(slot)
        if last is not None and now - last < window_s:
            return False
        self._last_pass[slot] = now
        self._last_pass.move_to_end(slot)
        while len(self._last_pass) > self._max:
            self._last_pass.popitem(last=False)
        return True


def evaluate_policy(
    policy: PolicyConfig,
    fields: dict[str, Any],
    *,
    packet_hash: str = "",
    now: float | None = None,
    state: PolicyState | None = None,
) -> PolicyDecision:
    """Evaluate the rule list against a packet's field values.

    ``packet_hash`` seeds the deterministic ``prob`` roll; ``now`` (monotonic
    seconds) and ``state`` enable ``throttle_seconds``. Without them a throttled
    rule always decides.
    """
    if not policy.enabled:
        return PolicyDecision(action="allow", matched=False)
    passes: list[str] = []
    for rule in policy.rules:
        if not rule.enabled:
            continue
        if not _matches(rule.condition, fields, policy):
            continue
        if not _roll(rule, packet_hash):
            continue
        if _throttle_pass(rule, fields, now, state):
            passes.append(rule.id)
            continue
        return PolicyDecision(
            action=rule.then.action,
            matched=True,
            rule_id=rule.id,
            rule_name=rule.name or None,
            passes=tuple(passes),
        )
    return PolicyDecision(action=policy.default_action, matched=False, passes=tuple(passes))


def _roll(rule: PolicyRule, packet_hash: str) -> bool:
    """Deterministic ``prob`` roll: the same packet always gets the same verdict."""
    prob = rule.then.prob
    if prob is None or prob >= 100:
        return True
    digest = hashlib.sha256(f"{rule.id}:{packet_hash}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100 < prob


def _throttle_pass(
    rule: PolicyRule, fields: dict[str, Any], now: float | None, state: PolicyState | None
) -> bool:
    window = rule.then.throttle_seconds
    if window is None or now is None or state is None:
        return False
    key_field = {
        "sender": "channel_sender",
        "channel": "channel_name",
        "path_first": "path_first",
    }.get(rule.then.throttle_key)
    key = ""
    if key_field is not None:
        value = fields.get(key_field)
        if key_field == "channel_name" and value is None:
            value = fields.get("channel_hash")
        key = "" if value is None else str(value)
    return state.take_pass(rule.id, key, now, window)


def _regex(pattern: str) -> re.Pattern[str] | None:
    if pattern in _REGEX_CACHE:
        _REGEX_CACHE.move_to_end(pattern)
        return _REGEX_CACHE[pattern]
    compiled: re.Pattern[str] | None
    try:
        compiled = re.compile(pattern) if len(pattern) <= MAX_REGEX_LENGTH else None
    except re.error:
        compiled = None
    _REGEX_CACHE[pattern] = compiled
    while len(_REGEX_CACHE) > _REGEX_CACHE_MAX:
        _REGEX_CACHE.popitem(last=False)
    return compiled


def _matches(cond: dict[str, Any], fields: dict[str, Any], policy: PolicyConfig) -> bool:
    if not cond:
        return False
    if "all" in cond:
        return all(_matches(c, fields, policy) for c in cond["all"])
    if "any" in cond:
        return any(_matches(c, fields, policy) for c in cond["any"])
    field = cond.get("field")
    expected = _resolve_value(cond.get("value"), policy)
    actual = fields.get(field) if isinstance(field, str) else None
    if cond.get("op") == "matches":
        if not isinstance(actual, str) or not isinstance(expected, str):
            return False
        pattern = _regex(expected)
        return pattern is not None and pattern.search(actual) is not None
    if field == "path_hashes":
        actual = _normalize_hex(actual)
        expected = _normalize_hex(expected)
    elif field == "channel_hash":
        actual = _normalize_channel_hash(actual)
        expected = _normalize_channel_hash(expected)
    else:
        expected = _coerce_like(actual, expected)
    return _compare(actual, str(cond.get("op", "equals")), expected)


def _coerce_like(actual: Any, expected: Any) -> Any:
    """Convert form-entered strings to the packet field's type ("3" -> 3, "true" -> True)."""
    if isinstance(expected, list):
        return [_coerce_like(actual, v) for v in expected]
    if not isinstance(expected, str):
        return expected
    text = expected.strip()
    if isinstance(actual, bool):
        if text.lower() in ("true", "1", "yes"):
            return True
        if text.lower() in ("false", "0", "no"):
            return False
        return expected
    if isinstance(actual, (int, float)):
        try:
            return int(text) if text.lstrip("-").isdigit() else float(text)
        except ValueError:
            return expected
    return expected


def _resolve_value(value: Any, policy: PolicyConfig) -> Any:
    if isinstance(value, str):
        match = _OBJECT_REF.match(value)
        if match:
            group, name = match.groups()
            return getattr(policy.objects, group, {}).get(name)
    return value


def _normalize_hex(value: Any) -> Any:
    if isinstance(value, (list, tuple, set)):
        return [str(v).strip().lower() for v in value]
    if isinstance(value, str):
        return value.strip().lower()
    return value


def _normalize_channel_hash(value: Any) -> Any:
    if isinstance(value, (list, tuple, set)):
        return [_normalize_channel_hash(v) for v in value]
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return f"{value & 0xFF:02x}"
    if isinstance(value, str):
        text = value.strip().lower()
        if text.startswith("0x"):
            text = text[2:]
        return text.zfill(2) if len(text) == 1 else text
    return value


def _compare(actual: Any, op: str, expected: Any) -> bool:
    """OpenHop ``PolicyEngine._compare`` semantics (canonical operator names)."""
    try:
        if op == "equals":
            return actual == expected
        if op == "not_equals":
            return actual != expected
        if op == "greater_than":
            return actual is not None and expected is not None and actual > expected
        if op == "greater_or_equal":
            return actual is not None and expected is not None and actual >= expected
        if op == "less_than":
            return actual is not None and expected is not None and actual < expected
        if op == "less_or_equal":
            return actual is not None and expected is not None and actual <= expected
        if op == "contains":
            if isinstance(actual, (list, tuple, set)):
                return expected in actual
            if isinstance(actual, str) and expected is not None:
                return str(expected) in actual
            return False
        if op == "in":
            if isinstance(expected, (list, tuple, set)):
                return actual in expected
            if isinstance(expected, str) and actual is not None:
                return str(actual) in expected
            return False
        if op == "intersects":
            if isinstance(actual, (list, tuple, set)) and isinstance(expected, (list, tuple, set)):
                return bool(set(actual) & set(expected))
            return False
        if op == "starts_with":
            return (
                isinstance(actual, str)
                and isinstance(expected, str)
                and actual.startswith(expected)
            )
        if op == "ends_with":
            return (
                isinstance(actual, str) and isinstance(expected, str) and actual.endswith(expected)
            )
    except TypeError:
        return False
    return False
