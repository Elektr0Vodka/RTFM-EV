"""Host repeater settings, state, arming and statistics (plan 29, Phases 1-3).

Shadow mode never transmits. Armed mode (``POST .../mode`` with ``mode: "armed"`` and
``confirm: true``) forwards other nodes' packets on the current frequency through
``host_repeater_tx``; it needs the server switch (env), the admin switch and every
capability check to pass, and ``POST .../disarm`` is the kill switch.
"""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError

from app.services.host_repeater import host_repeater
from app.services.host_repeater_link import radio_snapshot
from app.services.host_repeater_settings import HostRepeaterSettings, sub_band_duty_limit
from app.services.host_repeater_tx import ArmBlocker, ArmRefused, host_repeater_tx

router = APIRouter(prefix="/radio/host-repeater", tags=["radio"])

HostRepeaterState = Literal["off", "shadow", "armed"]


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
    arm_blockers: list[ArmBlocker] = Field(
        description="Why arming is refused right now; empty when the repeater can be armed"
    )


class HostRepeaterResponse(BaseModel):
    version: int = Field(description="Settings version; send it back on save (409 when stale)")
    settings: HostRepeaterSettings
    state: HostRepeaterState
    env_enabled: bool = Field(
        description="MESHCORE_HOST_REPEATER_ENABLED (server switch, env half)"
    )
    armed_since: float | None = Field(description="Unix time the repeater was armed, if armed")
    disarm_reason: str | None = Field(
        description="Why the repeater last left armed mode (user, radio_disconnected, ...)"
    )
    rearm_pending: bool = Field(
        description="Disarmed by a radio disconnect and will re-arm on reconnect (opt-in)"
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


class HostRepeaterModeRequest(BaseModel):
    mode: HostRepeaterState
    confirm: bool = Field(
        default=False,
        description="Required true for mode 'armed': the operator confirmed live forwarding",
    )


def _tx():
    """The armed-mode sender, attached to the runtime this router serves.

    Tests swap ``host_repeater`` for a fresh runtime; the sender must follow it so
    blockers and arming read the same settings the rest of the router does.
    """
    if host_repeater_tx.attached_runtime is not host_repeater:
        host_repeater_tx.attach(host_repeater)
    return host_repeater_tx


def _capabilities() -> HostRepeaterCapabilities:
    snap = radio_snapshot()
    freq = snap.radio.freq_mhz if snap.radio else None
    return HostRepeaterCapabilities(
        connected=snap.connected,
        identity_known=snap.public_key is not None,
        firmware_ver_code=snap.firmware_ver_code,
        raw_send_supported=snap.raw_send_supported,
        firmware_repeat=snap.client_repeat,
        openhop=snap.is_openhop,
        freq_mhz=freq,
        sub_band_limit_percent=sub_band_duty_limit(freq),
        arm_blockers=_tx().blockers(snap),  # type: ignore[arg-type]
    )


def _response() -> HostRepeaterResponse:
    public = host_repeater.public_state()
    return HostRepeaterResponse(
        version=host_repeater.version,
        settings=host_repeater.settings,
        state=public["state"],
        env_enabled=public["env_enabled"],
        armed_since=public["armed_since"],
        disarm_reason=public["disarm_reason"],
        rearm_pending=public["rearm_pending"],
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


@router.post("/mode", response_model=HostRepeaterResponse)
async def set_host_repeater_mode(request: HostRepeaterModeRequest) -> HostRepeaterResponse:
    """Arm live forwarding (``armed`` + ``confirm``) or leave it (``shadow`` / ``off``).

    Leaving armed mode does not change the saved settings: shadow keeps running if it
    is enabled. Arming answers 409 with the blocker list when a precondition fails and
    400 when the confirmation is missing.
    """
    await host_repeater.ensure_loaded()
    if request.mode == "armed":
        try:
            _tx().arm(confirm=request.confirm)
        except ArmRefused as exc:
            if exc.confirm_missing:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "message": "Arming needs confirm=true",
                        "blockers": [],
                    },
                ) from exc
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "The host repeater cannot be armed right now",
                    "blockers": exc.blockers,
                },
            ) from exc
    else:
        _tx().disarm("user")
    return _response()


@router.post("/disarm", response_model=HostRepeaterResponse)
async def disarm_host_repeater() -> HostRepeaterResponse:
    """Kill switch: stop forwarding immediately (also cancels a pending re-arm)."""
    await host_repeater.ensure_loaded()
    _tx().disarm("user")
    return _response()


@router.get("/stats")
async def get_host_repeater_stats() -> dict[str, Any]:
    """Shadow and armed-mode statistics: session counters (in memory since start or the
    last reset) plus ``lifetime`` totals that survive restarts."""
    snap = radio_snapshot()
    return host_repeater.stats_snapshot(snap.radio.freq_mhz if snap.radio else None)


@router.post("/stats/reset")
async def reset_host_repeater_stats(
    lifetime: bool = Query(
        default=False, description="Also start the persisted lifetime totals over"
    ),
) -> dict[str, str]:
    if lifetime:
        await host_repeater.reset_lifetime()
    else:
        host_repeater.reset_stats()
    return {"status": "ok"}
