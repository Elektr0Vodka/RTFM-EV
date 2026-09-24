"""OpenHop-style policy rules for the host repeater (pure, no I/O).

Port of the evaluation semantics of openhop_repeater ``repeater/policy_engine.py``:
rules are checked top-down, the first enabled matching rule decides, otherwise
``default_action`` applies. ``drop`` blocks the forward; ``allow`` and
``log_only`` let the packet continue to the normal forwarding gates (an allow
rule never bypasses them, same as OpenHop). Differences from OpenHop: the stored
document is validated strictly (``host_repeater_settings``), so there is no
coercion of unknown actions here, and the channel fields come from RTFM-EV's
own channel decryption instead of an inline secret list.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.services.host_repeater_settings import PolicyConfig

_OBJECT_REF = re.compile(r"^@([a-z_]+)\.(.+)$")


@dataclass(frozen=True)
class PolicyDecision:
    action: str
    matched: bool
    rule_id: str | None = None
    rule_name: str | None = None


def evaluate_policy(policy: PolicyConfig, fields: dict[str, Any]) -> PolicyDecision:
    """Evaluate the rule list against a packet's field values."""
    if not policy.enabled:
        return PolicyDecision(action="allow", matched=False)
    for rule in policy.rules:
        if not rule.enabled:
            continue
        if _matches(rule.condition, fields, policy):
            return PolicyDecision(
                action=rule.then.action,
                matched=True,
                rule_id=rule.id,
                rule_name=rule.name or None,
            )
    return PolicyDecision(action=policy.default_action, matched=False)


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
