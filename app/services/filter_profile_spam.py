"""Spam Guard as a kind of filter profile.

A profile holds the mode, the sensitivity and the changed tunables. It never
holds the channels, their keys, the exception lists or the pause, and it
leaves this installation's evidence log settings alone. Applying a profile
goes through ``SpamGuardRuntime.save_config``, the same path as the settings
form. Nothing here transmits.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.filter_profiles.format import first_problem
from app.filter_profiles.kinds import ProfileError
from app.services import spam_guard as spam_guard_module
from app.services.spam_guard import SpamGuardRuntime
from app.spam.settings import PRESETS, Mode, Sensitivity, SpamConfig, SpamTunables, effective

KIND = "spam_guard"
# Whether message data is kept here is this installation's choice, not a profile's.
LOCAL_KEYS = frozenset({"evidence_log", "evidence_days"})


class SpamProfilePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Mode
    sensitivity: Sensitivity
    overrides: dict[str, Any] = Field(default_factory=dict)


def _values(config: SpamConfig) -> dict[str, Any]:
    """The tunables in force, without the ones a profile leaves alone."""
    values = effective(config).model_dump(mode="json")
    return {key: value for key, value in values.items() if key not in LOCAL_KEYS}


class SpamGuardProfiles:
    kind = KIND

    def __init__(self, runtime: SpamGuardRuntime | None = None) -> None:
        self._given = runtime

    @property
    def _runtime(self) -> SpamGuardRuntime:
        # Looked up on use: tests replace the module's runtime.
        return self._given or spam_guard_module.spam_guard

    def _parse(self, payload: dict[str, Any]) -> SpamProfilePayload:
        try:
            parsed = SpamProfilePayload.model_validate(payload)
        except ValidationError as exc:
            raise ValueError(first_problem(exc)) from exc
        local = sorted(LOCAL_KEYS & set(parsed.overrides))
        if local:
            raise ValueError(f"overrides: a profile does not carry {', '.join(local)}")
        try:
            # The tunables first: their own error names the setting ("similarity: ...").
            # Through SpamConfig alone the same problem arrives as a nested report.
            tunables = SpamTunables(**{**PRESETS[parsed.sensitivity], **parsed.overrides})
            # Then the settings document itself, with every check it has.
            SpamConfig(mode=parsed.mode, sensitivity=parsed.sensitivity, overrides=parsed.overrides)
        except ValidationError as exc:
            raise ValueError(first_problem(exc)) from exc
        # Keep the values as the settings read them, not as the file wrote them:
        # a hand-edited 1 for a switch is on, and has to be stored as true.
        read = tunables.model_dump(mode="json")
        return parsed.model_copy(update={"overrides": {key: read[key] for key in parsed.overrides}})

    def validate(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._parse(payload).model_dump(mode="json")

    async def _live(self) -> SpamConfig:
        runtime = self._runtime
        await runtime.ensure_loaded()
        return runtime.config

    @staticmethod
    def _target(live: SpamConfig, parsed: SpamProfilePayload) -> SpamConfig:
        """The live settings with the profile's values in place."""
        kept = {key: value for key, value in live.overrides.items() if key in LOCAL_KEYS}
        return SpamConfig.model_validate(
            {
                **live.model_dump(mode="json"),
                "mode": parsed.mode,
                "sensitivity": parsed.sensitivity,
                "overrides": {**parsed.overrides, **kept},
            }
        )

    async def capture(self) -> dict[str, Any]:
        live = await self._live()
        return {
            "mode": live.mode,
            "sensitivity": live.sensitivity,
            "overrides": {
                key: value for key, value in live.overrides.items() if key not in LOCAL_KEYS
            },
        }

    async def changes(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        parsed = self._parse(payload)
        live = await self._live()
        target = self._target(live, parsed)
        found: list[dict[str, Any]] = []
        if live.mode != target.mode:
            found.append({"key": "mode", "from": live.mode, "to": target.mode})
        if live.sensitivity != target.sensitivity:
            found.append({"key": "sensitivity", "from": live.sensitivity, "to": target.sensitivity})
        before, after = _values(live), _values(target)
        found.extend(
            {"key": key, "from": before[key], "to": after[key]}
            for key in before
            if before[key] != after[key]
        )
        return found

    async def matches(self, payload: dict[str, Any]) -> bool:
        parsed = self._parse(payload)
        live = await self._live()
        target = self._target(live, parsed)
        return live.mode == target.mode and _values(live) == _values(target)

    async def apply(self, payload: dict[str, Any], *, confirmed: bool) -> None:
        parsed = self._parse(payload)
        runtime = self._runtime
        live = await self._live()
        if parsed.mode == "protect" and live.mode != "protect" and not confirmed:
            # Protect makes a shared repeater drop traffic: never without a yes.
            raise ProfileError("needs_confirm", status=409)
        target = self._target(live, parsed)
        refusal = runtime.refusal(target)
        if refusal is not None:
            raise ProfileError(refusal, status=409)
        if await runtime.save_config(runtime.version, target) is None:
            raise ProfileError("conflict", status=409)
