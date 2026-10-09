"""Spam Guard enforcement on the host repeater.

Hands the rendered rule set to the host repeater's forwarding engine as its
managed rule layers (``ForwardingEngine.set_managed_rules``). The rules live in
memory only: the user's stored policy is never touched, and the Spam Guard
runtime re-applies them after a restart.

Whether a drop has any effect on air is the host repeater's business: it only
forwards when armed. In shadow mode the engine still judges every frame, so
the stats show what would have been dropped. This module does not import the
radio or the send path.
"""

from __future__ import annotations

from typing import Any

from app.services.host_repeater import HostRepeaterRuntime, host_repeater
from app.services.host_repeater_settings import PolicyRule
from app.spam.rules import RuleSet


class HostBackend:
    name = "host"

    def __init__(self, runtime: HostRepeaterRuntime | None = None) -> None:
        self._runtime = runtime or host_repeater
        self._expected = 0

    def apply(self, rules: RuleSet) -> None:
        """Replace the engine's managed layers with this rule set."""
        before = [PolicyRule.model_validate(rule) for rule in rules.before]
        after = [PolicyRule.model_validate(rule) for rule in rules.after]
        self._runtime.engine.set_managed_rules(before, after)
        self._expected = len(before) + len(after)

    def clear(self) -> None:
        self.apply(RuleSet())

    def status(self) -> dict[str, Any]:
        return {
            "backend": self.name,
            # off / shadow / armed: only "armed" changes what goes on air.
            "state": self._runtime.state,
            "rules_expected": self._expected,
            "rules_present": self._runtime.engine.managed_rule_count,
        }
