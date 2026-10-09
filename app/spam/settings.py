"""Spam Guard settings (pure, no I/O).

``SpamTunables`` holds every detection tunable with its bounds; the defaults
are the ``balanced`` preset. ``SpamConfig`` is the stored document: mode,
sensitivity, the user's overrides on top of the preset, the protected channels
and the exception lists. ``effective()`` layers them: defaults, then preset,
then overrides.

Names, defaults and bounds follow openhop-spamguard so its documentation and
tuning advice carry over.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Sensitivity = Literal["relaxed", "balanced", "strict"]
Mode = Literal["monitor", "protect"]
# ``starts_at`` (first hop equals the repeater) only exists on the host
# repeater; OpenHop has no field for it.
HopMatch = Literal["contains_known", "exact_paths", "contains", "starts_at"]
HoldLinks = Literal["campaign", "always", "off"]

# "Stays until removed".
PERMANENT_SECONDS = 10 * 365 * 86400
MAX_NAME_PATTERNS = 16
MAX_NAME_PATTERN_LENGTH = 128
MAX_EXCEPTIONS = 500

PRESETS: dict[str, dict[str, int]] = {
    "relaxed": {
        "rotate_first_hops": 4,
        "hop_random_senders": 5,
        "hop_new_senders": 10,
        "hop_campaign_senders": 5,
        "hop_random_senders_long": 8,
        "text_distinct_senders": 4,
        "similarity": 80,
        "dedupe_seconds": 600,
        "dedupe_min_chars": 40,
        "name_score_threshold": 4,
    },
    "balanced": {
        "rotate_first_hops": 3,
        "hop_random_senders": 3,
        "hop_new_senders": 6,
        "hop_campaign_senders": 3,
        "hop_random_senders_long": 5,
        "text_distinct_senders": 3,
        "similarity": 65,
        "dedupe_seconds": 900,
        "dedupe_min_chars": 30,
        "name_score_threshold": 3,
    },
    "strict": {
        "rotate_first_hops": 2,
        "hop_random_senders": 2,
        "hop_new_senders": 4,
        "hop_campaign_senders": 2,
        "hop_random_senders_long": 3,
        "text_distinct_senders": 2,
        "similarity": 55,
        "dedupe_seconds": 1800,
        "dedupe_min_chars": 24,
        "name_score_threshold": 2,
    },
}

_HOP = re.compile(r"(?:[0-9A-F]{2}){1,3}")
_CHANNEL_KEY = re.compile(r"[0-9A-F]{32}|[0-9A-F]{64}")


def normalise_hop(value: str) -> str:
    """Upper-case hop hash of 1 to 3 bytes; raises ValueError otherwise."""
    hop = value.strip().upper()
    if hop.startswith("0X"):
        hop = hop[2:]
    if not _HOP.fullmatch(hop):
        raise ValueError("a repeater hash is 2, 4 or 6 hex characters, e.g. 27")
    return hop


class SpamTunables(BaseModel):
    """Every detection tunable. Defaults are the ``balanced`` preset."""

    model_config = ConfigDict(extra="forbid")

    # Blocking by source repeater
    enable_hop_rules: bool = True
    hop_match_mode: HopMatch = "contains_known"
    hop_random_senders: int = Field(default=3, ge=1, le=100)
    hop_new_senders: int = Field(default=6, ge=2, le=200)
    hop_campaign_senders: int = Field(default=3, ge=2, le=100)
    hop_random_senders_long: int = Field(default=5, ge=2, le=500)
    enable_rotation_guard: bool = True
    rotate_first_hops: int = Field(default=3, ge=2, le=50)
    route_memory_days: int = Field(default=7, ge=1, le=60)
    max_paths_per_hop: int = Field(default=50, ge=1, le=500)
    max_origins_per_route: int = Field(default=60, ge=1, le=500)
    # Blocking by message text
    enable_text_rules: bool = True
    text_distinct_senders: int = Field(default=3, ge=2, le=50)
    similarity: int = Field(default=65, ge=30, le=100)
    min_rule_chars: int = Field(default=14, ge=8, le=80)
    # Duplicate suppression
    dedupe_enabled: bool = True
    dedupe_seconds: int = Field(default=900, ge=30, le=86400)
    dedupe_min_chars: int = Field(default=30, ge=10, le=150)
    text_rule_chars: int = Field(default=40, ge=10, le=150)
    # Known people
    known_min_msgs: int = Field(default=1, ge=1, le=20)
    known_days: int = Field(default=30, ge=1, le=365)
    hold_links: HoldLinks = "campaign"
    # Sender names
    name_score_threshold: int = Field(default=3, ge=1, le=6)
    random_name_patterns: list[str] = Field(
        default_factory=lambda: [r"(?=.*\d)(?=.*[a-z])[a-z0-9]{8}"],
        max_length=MAX_NAME_PATTERNS,
    )
    # Timing
    window_seconds: int = Field(default=600, ge=60, le=86400)
    long_window_seconds: int = Field(default=7200, ge=600, le=86400)
    block_ttl_seconds: int = Field(default=6 * 3600, ge=300, le=PERMANENT_SECONDS)
    hop_block_ttl_seconds: int = Field(default=2 * 3600, ge=600, le=PERMANENT_SECONDS)
    spam_text_days: int = Field(default=7, ge=0, le=60)
    max_total_rules: int = Field(default=300, ge=20, le=2000)
    # Evidence log
    evidence_log: bool = False
    evidence_days: int = Field(default=7, ge=1, le=30)

    @field_validator("random_name_patterns")
    @classmethod
    def _check_patterns(cls, value: list[str]) -> list[str]:
        for pattern in value:
            if not 1 <= len(pattern) <= MAX_NAME_PATTERN_LENGTH:
                raise ValueError(
                    f"a name pattern is 1 to {MAX_NAME_PATTERN_LENGTH} characters long"
                )
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ValueError(f"invalid name pattern '{pattern}': {exc}") from exc
        return value


class ProtectedChannel(BaseModel):
    """A channel the detector reads: its key (hex) and display name."""

    model_config = ConfigDict(extra="forbid")

    key: str
    name: str = Field(default="", max_length=64)

    @field_validator("key")
    @classmethod
    def _check_key(cls, value: str) -> str:
        key = value.strip().upper()
        if not _CHANNEL_KEY.fullmatch(key):
            raise ValueError("a channel key is 32 or 64 hex characters")
        return key


class SpamConfig(BaseModel):
    """The stored Spam Guard document."""

    model_config = ConfigDict(extra="forbid")

    mode: Mode = "monitor"
    paused: bool = False
    sensitivity: Sensitivity = "balanced"
    # Tunables the user changed; everything else follows the sensitivity preset.
    overrides: dict[str, Any] = Field(default_factory=dict)
    channels: list[ProtectedChannel] = Field(default_factory=list)
    # Exceptions: repeaters never blocked automatically, trusted sender names,
    # and texts that never count as spam.
    allow_hops: list[str] = Field(default_factory=list, max_length=MAX_EXCEPTIONS)
    allow_senders: list[str] = Field(default_factory=list, max_length=MAX_EXCEPTIONS)
    allow_texts: list[str] = Field(default_factory=list, max_length=MAX_EXCEPTIONS)

    @field_validator("allow_hops")
    @classmethod
    def _check_hops(cls, value: list[str]) -> list[str]:
        return [normalise_hop(hop) for hop in value]

    @field_validator("allow_texts")
    @classmethod
    def _check_texts(cls, value: list[str]) -> list[str]:
        texts = [text.strip() for text in value]
        if any(len(text) < 3 for text in texts):
            raise ValueError("an allowed text is at least 3 characters")
        return texts

    @model_validator(mode="after")
    def _check_overrides(self) -> SpamConfig:
        unknown = sorted(set(self.overrides) - set(SpamTunables.model_fields))
        if unknown:
            raise ValueError(f"unknown setting(s): {', '.join(unknown)}")
        effective(self)
        return self


def effective(config: SpamConfig) -> SpamTunables:
    """The tunables in force: defaults, then the preset, then the overrides."""
    return SpamTunables(**{**PRESETS[config.sensitivity], **config.overrides})
