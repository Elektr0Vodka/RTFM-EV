"""Host repeater settings, state and shadow statistics (plan 29, Phases 1-2).

Nothing here transmits. Arming (live forwarding) is a later phase; the API only
reports why it is not available (``arm_blockers``).
"""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from app.services.host_repeater import host_repeater
from app.services.host_repeater_link import radio_snapshot
from app.services.host_repeater_settings import HostRepeaterSettings, sub_band_duty_limit

router = APIRouter(prefix="/radio/host-repeater", tags=["radio"])

ArmBlocker = Literal[
    "not_available_yet",
    "env_switch_off",
    "admin_switch_off",
    "radio_disconnected",
    "raw_send_unsupported",
    "firmware_repeat_on",
    "openhop",
    "frequency_unknown",
]


class HostRepeaterCapabilities(BaseModel):
    connected: bool
    identity_known: bool
    firmware_ver_code: int | None
    raw_send_supported: bool | None = Field(
        description="CMD_SEND_RAW_PACKET available (companion FIRMWARE_VER_CODE >= 13)"
    )
    firmware_repeat: bool | None = Field(
        description="Firmware off-grid client repeat state (fw v9+); must stay off"
    )
    openhop: bool = Field(
        description="OpenHop node: it repeats itself; the host repeater is disabled"
    )
    freq_mhz: float | None
    sub_band_limit_percent: float | None = Field(
        description="EU sub-band duty-cycle limit for the current frequency (None outside 863-870 MHz)"
    )
    arm_blockers: list[ArmBlocker]


class HostRepeaterResponse(BaseModel):
    version: int = Field(description="Settings version; send it back on save (409 when stale)")
    settings: HostRepeaterSettings
    state: Literal["off", "shadow"]
    env_enabled: bool = Field(
        description="MESHCORE_HOST_REPEATER_ENABLED (server switch, env half)"
    )
    capabilities: HostRepeaterCapabilities


class HostRepeaterSaveRequest(BaseModel):
    version: int = Field(ge=0)
    settings: HostRepeaterSettings


class HostRepeaterValidateRequest(BaseModel):
    settings: dict[str, Any]


class ValidationIssue(BaseModel):
    loc: str
    msg: str


class HostRepeaterValidateResponse(BaseModel):
    valid: bool
    errors: list[ValidationIssue]


def _capabilities() -> HostRepeaterCapabilities:
    snap = radio_snapshot()
    freq = snap.radio.freq_mhz if snap.radio else None
    blockers: list[ArmBlocker] = ["not_available_yet"]
    if not host_repeater.env_enabled:
        blockers.append("env_switch_off")
    if not host_repeater.settings.admin_enabled:
        blockers.append("admin_switch_off")
    if not snap.connected:
        blockers.append("radio_disconnected")
    if snap.raw_send_supported is False:
        blockers.append("raw_send_unsupported")
    if snap.client_repeat:
        blockers.append("firmware_repeat_on")
    if snap.is_openhop:
        blockers.append("openhop")
    if freq is None:
        blockers.append("frequency_unknown")
    return HostRepeaterCapabilities(
        connected=snap.connected,
        identity_known=snap.public_key is not None,
        firmware_ver_code=snap.firmware_ver_code,
        raw_send_supported=snap.raw_send_supported,
        firmware_repeat=snap.client_repeat,
        openhop=snap.is_openhop,
        freq_mhz=freq,
        sub_band_limit_percent=sub_band_duty_limit(freq),
        arm_blockers=blockers,
    )


def _response() -> HostRepeaterResponse:
    return HostRepeaterResponse(
        version=host_repeater.version,
        settings=host_repeater.settings,
        state="shadow" if host_repeater.shadow_active else "off",
        env_enabled=host_repeater.env_enabled,
        capabilities=_capabilities(),
    )


@router.get("", response_model=HostRepeaterResponse)
async def get_host_repeater() -> HostRepeaterResponse:
    """Host repeater settings, version, state and capability checks."""
    await host_repeater.ensure_loaded()
    return _response()


@router.put("/settings", response_model=HostRepeaterResponse)
async def save_host_repeater_settings(request: HostRepeaterSaveRequest) -> HostRepeaterResponse:
    """Save the whole settings document. 409 when ``version`` is stale."""
    await host_repeater.ensure_loaded()
    if request.settings.shadow_enabled and radio_snapshot().is_openhop:
        raise HTTPException(
            status_code=409,
            detail="OpenHop repeats packets itself; the host repeater is disabled for OpenHop radios",
        )
    version = await host_repeater.save(request.version, request.settings)
    if version is None:
        raise HTTPException(
            status_code=409,
            detail="Host repeater settings were changed elsewhere; reload and try again",
        )
    return _response()


@router.post("/validate", response_model=HostRepeaterValidateResponse)
async def validate_host_repeater_settings(
    request: HostRepeaterValidateRequest,
) -> HostRepeaterValidateResponse:
    """Strictly validate a settings document without saving it."""
    try:
        HostRepeaterSettings.model_validate(request.settings)
    except ValidationError as exc:
        return HostRepeaterValidateResponse(
            valid=False,
            errors=[
                ValidationIssue(loc=".".join(str(p) for p in err["loc"]), msg=err["msg"])
                for err in exc.errors()
            ],
        )
    return HostRepeaterValidateResponse(valid=True, errors=[])


@router.get("/stats")
async def get_host_repeater_stats() -> dict[str, Any]:
    """Shadow-mode statistics (in memory since start or the last reset)."""
    snap = radio_snapshot()
    return host_repeater.stats_snapshot(snap.radio.freq_mhz if snap.radio else None)


@router.post("/stats/reset")
async def reset_host_repeater_stats() -> dict[str, str]:
    host_repeater.reset_stats()
    return {"status": "ok"}
