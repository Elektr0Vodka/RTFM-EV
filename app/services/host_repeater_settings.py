"""Host repeater settings model (plan 29, Phases 1-2).

RTFM-EV can act as the repeater for its companion radio (firmware client repeat
stays off): every received frame is judged by a server-side policy and, once a
later phase arms it, re-sent with the raw-packet command. This module holds the
typed, strictly validated settings document for that policy. It has no I/O.

Where the defaults come from:
- Delay factors, the 5 s delay cap, the 60 s duty-cycle window and
  ``max_airtime_per_minute`` 3600 ms, and the seen-table TTL follow OpenHop
  (``openhop_repeater/repeater/engine.py``, ``airtime.py``).
- ``flood_max*`` and ``loop_detect`` follow the stock repeater firmware
  (MeshCore ``examples/simple_repeater/MyMesh.cpp``, ``src/helpers/RoutingPolicy.h``).
- The ``filter_*`` block ports the DMC ``dmc-dev`` repeater RF packet filter
  (``examples/simple_repeater/Filter.{h,cpp}``, ``Limiter.h``).
- ``policy`` uses the OpenHop policy-engine rule format (``repeater/policy_engine.py``).
- ``regions``, ``home_region`` and ``dc_gate*`` follow the DMC ``dmc-dev`` repeater
  region map and duty-cycle region gating (``src/helpers/RegionMap.{h,cpp}``,
  ``examples/simple_repeater/MyMesh.cpp``).
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# MeshCore payload types (src/Packet.h), keyed by the names the DMC filter uses.
PAYLOAD_TYPE_NAMES: dict[int, str] = {
    0x00: "REQ",
    0x01: "RESPONSE",
    0x02: "TXT_MSG",
    0x03: "ACK",
    0x04: "ADVERT",
    0x05: "GRP_TXT",
    0x06: "GRP_DATA",
    0x07: "ANON_REQ",
    0x08: "PATH",
    0x09: "TRACE",
    0x0A: "MULTIPART",
    0x0B: "CONTROL",
}
PAYLOAD_TYPE_BY_NAME: dict[str, int] = {name: code for code, name in PAYLOAD_TYPE_NAMES.items()}

LoopDetectMode = Literal["off", "minimal", "moderate", "strict"]
PolicyAction = Literal["allow", "drop", "log_only"]
AclBypass = Literal["off", "contacts", "favorites"]

# OpenHop policy fields a companion host can evaluate. OpenHop's rx_radio_id,
# local_transmission and mode have no meaning here and are left out.
POLICY_FIELDS: tuple[str, ...] = (
    "route_type",
    "payload_type",
    "payload_length",
    "path_hash_size",
    "hop_count",
    "rssi",
    "snr",
    "channel_hash",
    "channel_sender",
    "channel_message_body",
    "channel_decryptable",
    "path_hashes",
    "transport_code_0",
    "transport_code_1",
    "payload_hex",
)
# Canonical OpenHop operator names (policy_engine._compare also accepts short aliases;
# the stored document only uses these).
POLICY_OPERATORS: tuple[str, ...] = (
    "equals",
    "not_equals",
    "greater_than",
    "greater_or_equal",
    "less_than",
    "less_or_equal",
    "contains",
    "in",
    "intersects",
    "starts_with",
    "ends_with",
)
POLICY_OBJECT_GROUPS: tuple[str, ...] = ("channel_hash_groups", "pubkey_groups")
MAX_POLICY_RULES = 100
MAX_CONDITION_DEPTH = 4
MAX_FILTER_CHANNELS = 16  # DMC FILTER_CHANNEL_COUNT
MAX_REGIONS = 32  # RegionMap MAX_REGION_ENTRIES
MAX_REGION_NAME = 30  # RegionEntry name[31]

_HEX_BYTE = re.compile(r"^[0-9a-f]{2}$")
_OBJECT_REF = re.compile(r"^@([a-z_]+)\.(.+)$")


class DmcTypeLimits(BaseModel):
    """Per-payload-type DMC limits: ``filter hops`` and ``filter rate``."""

    model_config = ConfigDict(extra="forbid")

    hops_max: int = Field(ge=0, le=64, description="Drop floods with hop count >= this")
    rate_limit: int = Field(ge=0, le=65535, description="Max forwards per window (0 = no limit)")
    rate_secs: int = Field(ge=1, le=86400, description="Rate window in seconds")
    soft: int = Field(
        default=0,
        ge=0,
        le=65535,
        description="Soft cutoff: forward probability ramps down between soft and rate_limit",
    )


def default_filter_types() -> dict[str, DmcTypeLimits]:
    """DMC ``FilterPrefs`` defaults (Filter.h)."""
    custom = {
        "TXT_MSG": (8, 20),
        "ADVERT": (8, 10),
        "GRP_TXT": (32, 20),
    }
    result: dict[str, DmcTypeLimits] = {}
    for name in PAYLOAD_TYPE_BY_NAME:
        hops, rate = custom.get(name, (8, 5))
        result[name] = DmcTypeLimits(hops_max=hops, rate_limit=rate, rate_secs=60, soft=0)
    return result


def _is_region_name(name: str) -> bool:
    """Firmware ``RegionMap::is_name_char`` for every character (``-``, ``$``, digits, >= 'A')."""
    return bool(name) and all(c in "-$0123456789" or ord(c) >= 0x41 for c in name)


class RegionConfig(BaseModel):
    """One entry of the host repeater region map (firmware ``RegionEntry``).

    The name is stored without the leading ``#`` (the firmware hashes ``"#" + name``
    either way). ``parent`` None means a child of the wildcard ``*``.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    parent: str | None = None
    deny_flood: bool = False

    @field_validator("name", "parent")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().removeprefix("#")
        if not _is_region_name(value) or len(value) > MAX_REGION_NAME:
            raise ValueError(
                f"region names are 1-{MAX_REGION_NAME} characters: letters, digits, '-' or '$'"
            )
        return value


class BlockedChannel(BaseModel):
    """One DMC channel blocklist entry, matched on the 1-byte channel hash."""

    model_config = ConfigDict(extra="forbid")

    hash: str = Field(description="Channel hash byte, 2 lowercase hex chars")
    label: str = Field(default="", max_length=64)

    @field_validator("hash")
    @classmethod
    def _check_hash(cls, value: str) -> str:
        value = value.strip().lower()
        if not _HEX_BYTE.match(value):
            raise ValueError("channel hash must be one byte as 2 hex characters")
        return value


class PolicyObjects(BaseModel):
    """Named value groups a rule can reference as ``@<group>.<name>``."""

    model_config = ConfigDict(extra="forbid")

    channel_hash_groups: dict[str, list[str]] = Field(default_factory=dict)
    pubkey_groups: dict[str, list[str]] = Field(default_factory=dict)


class PolicyRuleThen(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: PolicyAction


class PolicyRule(BaseModel):
    """OpenHop rule: ``{id, name, enabled, if: <condition>, then: {action}}``."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=64)
    name: str = Field(default="", max_length=128)
    enabled: bool = True
    condition: dict[str, Any] = Field(alias="if")
    then: PolicyRuleThen


class PolicyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    default_action: PolicyAction = "allow"
    rules: list[PolicyRule] = Field(default_factory=list, max_length=MAX_POLICY_RULES)
    objects: PolicyObjects = Field(default_factory=PolicyObjects)

    @model_validator(mode="after")
    def _check_rules(self) -> PolicyConfig:
        seen_ids: set[str] = set()
        for index, rule in enumerate(self.rules):
            if rule.id in seen_ids:
                raise ValueError(f"rules[{index}]: duplicate rule id '{rule.id}'")
            seen_ids.add(rule.id)
            if rule.condition == {}:
                continue  # no condition yet: never matches (OpenHop behaviour)
            _validate_condition(rule.condition, self.objects, f"rules[{index}].if", 1)
        return self


def _validate_condition(cond: Any, objects: PolicyObjects, where: str, depth: int) -> None:
    if depth > MAX_CONDITION_DEPTH:
        raise ValueError(f"{where}: conditions nested deeper than {MAX_CONDITION_DEPTH}")
    if not isinstance(cond, dict):
        raise ValueError(f"{where}: condition must be an object")
    keys = set(cond)
    if keys in ({"all"}, {"any"}):
        (key,) = keys
        children = cond[key]
        if not isinstance(children, list) or not children:
            raise ValueError(f"{where}.{key}: must be a non-empty list")
        for i, child in enumerate(children):
            _validate_condition(child, objects, f"{where}.{key}[{i}]", depth + 1)
        return
    if keys != {"field", "op", "value"}:
        raise ValueError(
            f"{where}: expected {{field, op, value}} or {{all: [...]}} or {{any: [...]}}"
        )
    if cond["field"] not in POLICY_FIELDS:
        raise ValueError(f"{where}.field: unknown field '{cond['field']}'")
    if cond["op"] not in POLICY_OPERATORS:
        raise ValueError(f"{where}.op: unknown operator '{cond['op']}'")
    value = cond["value"]
    if isinstance(value, str):
        match = _OBJECT_REF.match(value)
        if match:
            group, name = match.groups()
            if group not in POLICY_OBJECT_GROUPS:
                raise ValueError(f"{where}.value: unknown object group '{group}'")
            if name not in getattr(objects, group):
                raise ValueError(f"{where}.value: '{value}' does not exist")
    elif isinstance(value, list):
        if not all(isinstance(v, (str, int, float, bool)) for v in value):
            raise ValueError(f"{where}.value: list items must be scalars")
    elif value is not None and not isinstance(value, (int, float, bool)):
        raise ValueError(f"{where}.value: must be a scalar, a list of scalars or @group.name")


class HostRepeaterSettings(BaseModel):
    """The whole host repeater settings document (versioned as one unit)."""

    model_config = ConfigDict(extra="forbid")

    # Server switch, admin half. Arming (a later phase) also needs the
    # MESHCORE_HOST_REPEATER_ENABLED env var. Both default off.
    admin_enabled: bool = False
    # Shadow mode: judge every received frame and keep statistics, never transmit.
    # Opt-in; it runs whenever the repeater is not armed.
    shadow_enabled: bool = False
    # Stored for the armed phase: re-arm after a radio reconnect (opt-in).
    auto_rearm_after_reconnect: bool = False

    # Timing (OpenHop defaults). Delay = random [0, 5 * airtime * factor], capped.
    tx_delay_factor: float = Field(default=1.0, ge=0.0, le=10.0)
    direct_tx_delay_factor: float = Field(default=0.5, ge=0.0, le=10.0)
    max_tx_delay_ms: int = Field(default=5000, ge=0, le=30000)
    # A forward whose receive-to-decision time is already past this is dropped as too late.
    max_forward_latency_ms: int = Field(default=5000, ge=100, le=60000)
    # LoRa preamble symbols for the airtime model (MeshCore radio init uses 16).
    preamble_symbols: int = Field(default=16, ge=6, le=65535)

    # Duty cycle (OpenHop): rolling 60 s window.
    duty_cycle_enforced: bool = True
    max_airtime_per_minute_ms: int = Field(default=3600, ge=0, le=60000)

    # Repeater firmware parity (flood packets only).
    flood_max: int = Field(default=64, ge=0, le=64)
    flood_max_unscoped: int = Field(default=64, ge=0, le=64)
    flood_max_advert: int = Field(default=8, ge=0, le=64)
    loop_detect: LoopDetectMode = "minimal"
    unscoped_flood_allow: bool = True
    # Region map: only region-scoped floods matching a listed, non-denied region are
    # forwarded (firmware RegionMap::findMatch). The home region is never duty-gated.
    regions: list[RegionConfig] = Field(default_factory=list, max_length=MAX_REGIONS)
    home_region: str | None = None
    seen_ttl_seconds: int = Field(default=3600, ge=300, le=86400)

    # DMC RF packet filter (flood packets only).
    filter_enabled: bool = False
    filter_acl_bypass: AclBypass = "favorites"
    filter_min_hash_bytes: int = Field(default=1, ge=1, le=3)
    filter_malformed: bool = False
    filter_types: dict[str, DmcTypeLimits] = Field(default_factory=default_filter_types)
    filter_channels: list[BlockedChannel] = Field(
        default_factory=list, max_length=MAX_FILTER_CHANNELS
    )

    # DMC duty-cycle region gating: above threshold % of the airtime budget in use,
    # shed flood regions from the outside in; recover below threshold - hysteresis.
    dc_gate_enabled: bool = False
    dc_gate_threshold: int = Field(default=70, ge=1, le=100)
    dc_gate_hysteresis: int = Field(default=10, ge=0, le=50)

    # Armed mode (Phase 3). Arming also needs the env switch, the admin switch and an
    # explicit confirmation; these bound what the scheduler may hold and send.
    # Refuse to arm when the sub-band duty-cycle limit is below this (0.1 % bands).
    arm_min_sub_band_percent: float = Field(default=1.0, ge=0.1, le=100.0)
    # Forwards held on the host waiting for their delay (oldest dropped past the cap).
    max_pending_forwards: int = Field(default=20, ge=1, le=200)
    # Forwards handed to the firmware and not yet assumed transmitted.
    max_in_flight: int = Field(default=2, ge=1, le=16)

    # OpenHop policy rules (all packets, evaluated first).
    policy: PolicyConfig = Field(default_factory=PolicyConfig)

    @model_validator(mode="before")
    @classmethod
    def _convert_legacy_region_rules(cls, data: Any) -> Any:
        """Documents saved before the region map stored ``region_rules`` (name -> allow/deny)."""
        if isinstance(data, dict) and "region_rules" in data:
            data = dict(data)
            rules = data.pop("region_rules") or {}
            if "regions" not in data and isinstance(rules, dict):
                data["regions"] = [
                    {"name": name, "deny_flood": action == "deny"} for name, action in rules.items()
                ]
        return data

    @field_validator("filter_types")
    @classmethod
    def _check_filter_types(cls, value: dict[str, DmcTypeLimits]) -> dict[str, DmcTypeLimits]:
        unknown = sorted(set(value) - set(PAYLOAD_TYPE_BY_NAME))
        if unknown:
            raise ValueError(f"unknown payload type(s): {', '.join(unknown)}")
        merged = default_filter_types()
        merged.update(value)
        return merged

    @field_validator("home_region")
    @classmethod
    def _check_home(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return value.strip().removeprefix("#")

    @model_validator(mode="after")
    def _check_region_tree(self) -> HostRepeaterSettings:
        by_name: dict[str, RegionConfig] = {}
        for index, region in enumerate(self.regions):
            if region.name in by_name:
                raise ValueError(f"regions[{index}]: duplicate region '{region.name}'")
            by_name[region.name] = region
        for index, region in enumerate(self.regions):
            seen = {region.name}
            parent = region.parent
            while parent is not None:
                if parent not in by_name:
                    raise ValueError(f"regions[{index}]: parent '{parent}' is not in the list")
                if parent in seen:
                    raise ValueError(f"regions[{index}]: parent chain loops back")
                seen.add(parent)
                parent = by_name[parent].parent
        if self.home_region is not None and self.home_region not in by_name:
            raise ValueError(f"home_region '{self.home_region}' is not in the list")
        return self


# ETSI EN 300 220-2 sub-bands as encoded by DMC (origin/dmc-dev
# src/helpers/DutyCycleLimits.cpp): (low MHz, high MHz, duty-cycle percent).
EU_SUB_BANDS: tuple[tuple[float, float, float], ...] = (
    (863.0, 865.0, 0.1),
    (865.0, 868.0, 1.0),
    (868.0, 868.6, 1.0),
    (868.7, 869.2, 0.1),
    (869.4, 869.65, 10.0),
    (869.7, 870.0, 1.0),
)
EU_BAND = (863.0, 870.0)
EU_FALLBACK_DUTY_PERCENT = 0.1


def sub_band_duty_limit(freq_mhz: float | None) -> float | None:
    """Duty-cycle percent for a frequency in the EU 863-870 MHz band, else None."""
    if freq_mhz is None:
        return None
    for low, high, percent in EU_SUB_BANDS:
        if low <= freq_mhz <= high:
            return percent
    if EU_BAND[0] <= freq_mhz <= EU_BAND[1]:
        return EU_FALLBACK_DUTY_PERCENT
    return None
