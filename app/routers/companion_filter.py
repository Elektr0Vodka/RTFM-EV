"""meshcomod companion receive filter: settings, live counters, history, backup.

Everything goes through the radio's own command line (``filter ...``), which
runs on the radio and never transmits. See ``app/services/companion_filter.py``.
"""

import logging
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.repository.companion_filter import (
    CompanionFilterBackupRepository,
    CompanionFilterHistoryRepository,
)
from app.services import companion_filter as cf
from app.services.meshcomod import is_meshcomod
from app.services.radio_identity import resolve_stat_scope, sample_identity
from app.services.radio_runtime import radio_runtime as radio_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/radio/meshcomod/filter", tags=["radio"])

RuleKind = Literal["sender", "text"]


class FilterRule(BaseModel):
    pattern: str
    secs: int = Field(default=0, ge=0, le=cf.SECS_MAX)
    prob: int = Field(default=100, ge=1, le=100)


class FilterConfig(BaseModel):
    enabled: bool
    malformed: bool
    age_mins: int = Field(ge=0, le=cf.AGE_MAX_MINS, description="0 = off")
    paths: list[str]
    sender_rules: list[FilterRule]
    text_rules: list[FilterRule]


class FilterRuleStats(FilterRule):
    hidden: int | None = None
    passes: int | None = None


class FilterPathStats(BaseModel):
    prefix: str
    hidden: int | None = None


class FilterBackupInfo(BaseModel):
    saved_at: int
    truncated: bool
    config: FilterConfig


class CompanionFilterState(BaseModel):
    config: FilterConfig
    counters: dict[str, int] = Field(description="Hidden since the radio started, per reason")
    malformed_reasons: dict[str, int]
    age_clock_set: bool | None = Field(
        description="False: the age limit is set but inactive until the radio clock is set"
    )
    path_hits: list[FilterPathStats]
    sender_rules: list[FilterRuleStats]
    text_rules: list[FilterRuleStats]
    truncated: dict[str, bool] = Field(
        description="A list that did not fit in the radio's 158-byte reply; entries may be missing"
    )
    backup: FilterBackupInfo | None = None


class FilterSettingsUpdate(BaseModel):
    enabled: bool | None = None
    malformed: bool | None = None
    age_mins: int | None = Field(default=None, ge=0, le=cf.AGE_MAX_MINS, description="0 = off")


class FilterPathRequest(BaseModel):
    prefix: str


class FilterRuleRemove(BaseModel):
    pattern: str


class FilterHistoryResponse(BaseModel):
    bins: list[dict[str, int]]
    totals: dict[str, int]


def _require_filter() -> None:
    radio_manager.require_connected()
    if not is_meshcomod(radio_manager.firmware_ver_code, radio_manager.firmware_version):
        raise HTTPException(
            status_code=404, detail="Connected radio is not meshcomod DMC/DMC-EV firmware"
        )
    if getattr(radio_manager, "companion_filter_supported", False) is not True:
        raise HTTPException(
            status_code=404, detail="The radio's firmware has no companion receive filter"
        )


def _active_identity_id() -> int | None:
    mc = radio_manager.meshcore
    self_info = mc.self_info if mc else None
    live_key = self_info.get("public_key") if isinstance(self_info, dict) else None
    persist, identity_id = sample_identity(live_key)
    return identity_id if persist else None


BackupMode = Literal["if_missing", "on_change", "always"]


async def _store_backup(data: dict[str, Any], mode: BackupMode) -> FilterBackupInfo | None:
    """Keep the settings just read as this radio's backup, depending on ``mode``.

    ``if_missing`` (a plain read) only creates a first backup: a radio read
    after a flash or ``filter reset`` must not wipe the backup it needs.
    ``on_change`` (an edit through RTFM-EV) refreshes it, but never lets a
    clipped read replace a complete backup. ``always`` is the explicit save.
    """
    identity_id = _active_identity_id()
    if identity_id is None:
        return None
    truncated = any(data["truncated"].values())
    existing = await CompanionFilterBackupRepository.get(identity_id)
    if mode == "if_missing":
        save = existing is None
    elif mode == "on_change":
        save = not (truncated and existing is not None and not existing["truncated"])
    else:
        save = True
    if save:
        await CompanionFilterBackupRepository.save(
            identity_id, data["config"], truncated=truncated, saved_at=int(time.time())
        )
        existing = await CompanionFilterBackupRepository.get(identity_id)
    return FilterBackupInfo(**existing) if existing else None


async def _run(name: str, change=None, backup: BackupMode = "on_change") -> CompanionFilterState:
    """Apply ``change`` (if any), then read the filter back and store the backup."""
    _require_filter()
    async with radio_manager.radio_operation(name) as mc:
        try:
            if change is not None:
                await change(mc)
            data = await cf.read_filter(mc)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except cf.CompanionFilterError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    backup_info = await _store_backup(data, backup)
    return CompanionFilterState(**data, backup=backup_info)


@router.get("", response_model=CompanionFilterState)
async def get_companion_filter() -> CompanionFilterState:
    """Settings and live counters of the radio's companion receive filter."""
    return await _run("companion_filter_read", backup="if_missing")


@router.post("/backup", response_model=CompanionFilterState)
async def save_companion_filter_backup() -> CompanionFilterState:
    """Save the radio's current filter settings as this radio's backup."""
    return await _run("companion_filter_backup", backup="always")


@router.patch("", response_model=CompanionFilterState)
async def update_companion_filter(update: FilterSettingsUpdate) -> CompanionFilterState:
    """Turn the filter, the malformed scan or the age limit on or off."""

    async def change(mc):
        await cf.apply_settings(
            mc, enabled=update.enabled, malformed=update.malformed, age_mins=update.age_mins
        )

    return await _run("companion_filter_update", change)


@router.post("/paths", response_model=CompanionFilterState)
async def add_companion_filter_path(request: FilterPathRequest) -> CompanionFilterState:
    """Block floods relayed by a repeater whose ID starts with ``prefix``."""
    return await _run("companion_filter_path_add", lambda mc: cf.add_path(mc, request.prefix))


@router.post("/paths/remove", response_model=CompanionFilterState)
async def remove_companion_filter_path(request: FilterPathRequest) -> CompanionFilterState:
    return await _run("companion_filter_path_remove", lambda mc: cf.remove_path(mc, request.prefix))


@router.post("/rules/{kind}", response_model=CompanionFilterState)
async def add_companion_filter_rule(kind: RuleKind, rule: FilterRule) -> CompanionFilterState:
    """Add a sender or text rule (``secs`` 0 hides every match, else throttles)."""
    return await _run(
        "companion_filter_rule_add",
        lambda mc: cf.add_rule(mc, kind, rule.pattern, rule.secs, rule.prob),
    )


@router.post("/rules/{kind}/remove", response_model=CompanionFilterState)
async def remove_companion_filter_rule(
    kind: RuleKind, request: FilterRuleRemove
) -> CompanionFilterState:
    return await _run(
        "companion_filter_rule_remove", lambda mc: cf.remove_rule(mc, kind, request.pattern)
    )


@router.post("/restore", response_model=CompanionFilterState)
async def restore_companion_filter() -> CompanionFilterState:
    """Write the saved backup of this radio's filter settings back to the radio."""
    _require_filter()
    identity_id = _active_identity_id()
    backup = await CompanionFilterBackupRepository.get(identity_id) if identity_id else None
    if backup is None:
        raise HTTPException(status_code=404, detail="No filter backup for this radio")
    config = FilterConfig(**backup["config"]).model_dump()
    logger.info("Restoring companion filter settings from the backup of %s", backup["saved_at"])
    return await _run("companion_filter_restore", lambda mc: cf.restore_config(mc, config))


@router.get("/history", response_model=FilterHistoryResponse)
async def get_companion_filter_history(
    start_ts: int = Query(..., description="Start timestamp (Unix seconds)"),
    end_ts: int = Query(..., description="End timestamp (Unix seconds)"),
    bin_count: int = Query(48, ge=1, le=500, description="Number of output bins"),
) -> FilterHistoryResponse:
    """Messages hidden per bin, from the stored counter samples of the active radio.

    Not gated on the radio being connected: the history stays readable.
    """
    if end_ts <= start_ts:
        raise HTTPException(status_code=422, detail="end_ts must be after start_ts")
    scope = await resolve_stat_scope(None, False)
    samples = await CompanionFilterHistoryRepository.get_range(start_ts, end_ts, scope)
    bins = cf.bin_deltas(cf.counter_deltas(samples), start_ts, end_ts, bin_count)
    totals = {key: sum(b[key] for b in bins) for key in cf.COUNTER_KEYS}
    return FilterHistoryResponse(bins=bins, totals=totals)
