"""Reading and applying a config over a cable (plan 32, Phase 3).

The cable is plugged into the PC of the person using the app, and the
browser talks to the device (Web Serial). These routes never open a port and
never use the radio: the browser sends them the device's replies, and they
answer with the next commands to send, with the config file the replies make,
or with the ``set`` commands that make the device match a stored config.

Applying is the browser's work, one command at a time: it sends a command,
reads the setting back, asks ``/device/check`` whether both are what was
expected, and stops at the first that is not. Then it writes what happened to
the asset's log (``/configs/{id}/apply-log``).

The rules live in ``app.services.fleet_device_cli``.
"""

import logging
import time
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.config import settings
from app.repository.fleet import FleetAssetRepository, FleetEventRepository
from app.repository.fleet_vault import FleetVaultRepository
from app.routers.fleet import (
    FleetAssetEvent,
    _asset_or_404,
    _clean_text,
    _require_free_public_key,
)
from app.routers.fleet_config import (
    FleetConfigImportResult,
    _config_or_404,
    store_config,
)
from app.routers.fleet_vault import _NO_STORE, _audit
from app.services import fleet_config, fleet_device_cli, fleet_vault

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/fleet", tags=["fleet device"])

_MAX_REPLIES = 400
_MAX_COMMAND = 200
_MAX_REPLY = 4096
_TEXT_MAX = 200

Replies = dict[str, str | None]


def _checked_replies(replies: Replies) -> Replies:
    if len(replies) > _MAX_REPLIES:
        raise ValueError(f"at most {_MAX_REPLIES} replies")
    for command, reply in replies.items():
        if len(command) > _MAX_COMMAND or (reply is not None and len(reply) > _MAX_REPLY):
            raise ValueError("a command or reply is too long")
    return replies


class DeviceReplies(BaseModel):
    replies: Replies = Field(
        description="Command sent -> reply; null when the device did not answer"
    )

    @field_validator("replies")
    @classmethod
    def _limits(cls, value: Replies) -> Replies:
        return _checked_replies(value)


class DeviceIdentity(BaseModel):
    public_key: str | None
    role: str | None
    firmware_version: str | None
    board: str | None
    name: str | None


class DeviceReadPreview(BaseModel):
    identity: DeviceIdentity
    profile: str
    document: dict[str, Any] = Field(description='Each secret is {"$secret": null}')
    secrets: int = Field(description="Secret values the device gave")
    warnings: list[str] = Field(description="region_cut_off, hidden:<key>")


class DeviceReadStep(BaseModel):
    done: bool
    commands: list[str] = Field(description="Send these next, then ask again with their replies")
    read: DeviceReadPreview | None = None


class DeviceReadStore(DeviceReplies):
    label: str | None = Field(default=None, max_length=_TEXT_MAX)
    set_public_key: bool = Field(
        default=False, description="Give an asset without a public key the device's"
    )


class DeviceReadStoreResult(FleetConfigImportResult):
    identity: DeviceIdentity
    public_key_set: bool
    warnings: list[str]


class ApplyPlanRequest(DeviceReplies):
    allow_private_key: bool = Field(default=False, description="May write prv.key")
    allow_radio: bool = Field(default=False, description="May change frequency, bandwidth, SF, CR")


StepCheck = Literal["value", "reply", "public_key"]
StepSection = Literal["vars", "filter", "region", "hardware", "mqtt"]


class ApplyStepModel(BaseModel):
    section: StepSection
    path: list[str | int] = Field(max_length=8)
    command: str = Field(max_length=_MAX_COMMAND)
    display: str = Field(max_length=_MAX_COMMAND)
    secret: bool = False
    reboot: bool = False
    readback: list[str] = Field(default_factory=list, max_length=4)
    expect: Any = None
    check: StepCheck = "value"


class ApplyStepOut(ApplyStepModel):
    index: int


class ApplyRowOut(BaseModel):
    path: list[str | int]
    status: Literal["change", "same", "skip"]
    configured: str
    device: str
    reason: str | None = None


class ApplyPlanOut(BaseModel):
    identity: DeviceIdentity
    steps: list[ApplyStepOut]
    rows: list[ApplyRowOut]
    reboot: bool = Field(description="A step only takes effect after a restart of the device")
    rekey: bool = Field(description="The device takes the asset's identity (prv.key)")
    vault: Literal["off", "locked", "open"]


class StepCheckRequest(BaseModel):
    step: ApplyStepModel
    reply: str | None = Field(default=None, max_length=_MAX_REPLY)
    readback: Replies = Field(default_factory=dict)

    @field_validator("readback")
    @classmethod
    def _limits(cls, value: Replies) -> Replies:
        return _checked_replies(value)


class StepCheckResult(BaseModel):
    ok: bool
    reason: str | None = Field(
        description="no_reply, unexpected_reply, no_readback, readback_differs, other_public_key"
    )
    reply: str = Field(description="The reply as it may be shown; empty for a secret")


class ApplyLogResult(BaseModel):
    display: str = Field(max_length=_MAX_COMMAND)
    ok: bool
    reply: str = Field(default="", max_length=_TEXT_MAX)


class ApplyLogRequest(BaseModel):
    transport: Literal["usb_browser"]
    total: int = Field(ge=0, le=1000, description="Commands in the plan")
    results: list[ApplyLogResult] = Field(max_length=1000, description="The commands sent")
    stopped_reason: str | None = Field(default=None, max_length=64)
    reboot_needed: bool = False


_TRANSPORT_NAMES = {"usb_browser": "USB in the browser"}


def _identity(identity: fleet_device_cli.DeviceIdentity) -> dict[str, Any]:
    return {
        "public_key": identity.public_key,
        "role": identity.role,
        "firmware_version": identity.firmware_version,
        "board": identity.board,
        "name": identity.name,
    }


def _read(replies: Replies) -> fleet_device_cli.DeviceRead:
    try:
        return fleet_device_cli.read_device(replies)
    except (fleet_device_cli.DeviceCliError, fleet_config.ConfigError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/device/read-step", response_model=DeviceReadStep)
async def device_read_step(body: DeviceReplies) -> dict[str, Any]:
    """The next commands to read a device, or, once all are answered, what it holds.

    Start with no replies. The file in the answer holds no secret value; it
    is a preview. Storing it is ``POST /assets/{id}/configs/read``.
    """
    try:
        commands = fleet_device_cli.read_commands(body.replies)
    except fleet_device_cli.DeviceCliError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if commands:
        return {"done": False, "commands": commands, "read": None}
    read = _read(body.replies)
    preview, found = fleet_config.split_secrets(read.document)
    return {
        "done": True,
        "commands": [],
        "read": {
            "identity": _identity(read.identity),
            "profile": read.profile,
            "document": preview,
            "secrets": len(found),
            "warnings": read.warnings,
        },
    }


@router.post(
    "/assets/{asset_id}/configs/read",
    response_model=DeviceReadStoreResult,
    status_code=status.HTTP_201_CREATED,
)
async def store_device_read(
    asset_id: int,
    body: DeviceReadStore,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Store what was read from a device as a snapshot of this asset.

    The device must be this asset: its public key is the asset's. An asset
    without a public key takes the device's when ``set_public_key`` is on and
    no other asset has it. Secrets go to the vault as with an imported file.
    """
    asset = await _asset_or_404(asset_id, health=False)
    read = _read(body.replies)
    device_key = read.identity.public_key
    public_key_set = False
    if asset["public_key"] is None:
        if not body.set_public_key:
            raise HTTPException(
                status_code=409,
                detail=f"This asset has no public key yet. The device is {device_key}.",
            )
        await _require_free_public_key(device_key, own_id=asset_id)
        await FleetAssetRepository.update(asset_id, {"public_key": device_key})
        asset = await _asset_or_404(asset_id, health=False)
        public_key_set = True
    elif asset["public_key"] != device_key:
        raise HTTPException(
            status_code=409,
            detail=f"This device is not this asset: its public key is {device_key}.",
        )
    result = await store_config(
        asset,
        read.document,
        {
            "kind": "snapshot",
            "source": "usb_browser",
            "profile": read.profile,
            "role": read.identity.role,
            "firmware_version": read.identity.firmware_version,
            "label": _clean_text(body.label),
        },
        request,
        x_fleet_vault_token,
    )
    return {
        **result,
        "identity": _identity(read.identity),
        "public_key_set": public_key_set,
        "warnings": read.warnings,
    }


@router.post("/configs/{config_id}/apply-plan", response_model=ApplyPlanOut)
async def apply_plan(
    config_id: int,
    body: ApplyPlanRequest,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> Any:
    """The commands that make the device of ``replies`` match this config.

    Nothing is sent from here. Secrets of this asset are put into their
    commands when the vault is unlocked for this caller (written to the
    audit log); otherwise those settings are skipped. The answer holds those
    commands, so it is not cached.
    """
    config = await _config_or_404(config_id)
    if config["profile"] == "companion_v1":
        raise HTTPException(
            status_code=422, detail="A companion's file is not applied over this cable"
        )
    asset = await _asset_or_404(config["asset_id"], health=False)
    if asset["public_key"] is None:
        raise HTTPException(
            status_code=409, detail="Give this asset its public key before applying a config"
        )

    vault: Literal["off", "locked", "open"] = "off"
    values: dict[int, str] = {}
    if settings.fleet_vault_enabled:
        data_key = fleet_vault.sessions.key_for(x_fleet_vault_token)
        vault = "locked" if data_key is None else "open"
        if data_key is not None:
            for secret_id in fleet_config.secret_ids(config["document"]):
                sealed = await FleetVaultRepository.get_sealed(secret_id)
                # Only this asset's own secrets: an id in a document is not a permission.
                if sealed is None or sealed["asset_id"] != config["asset_id"]:
                    continue
                try:
                    value = fleet_vault.open_sealed(
                        data_key,
                        sealed["nonce"],
                        sealed["ciphertext"],
                        fleet_vault.secret_aad(sealed["asset_id"], sealed["kind"]),
                    )
                except fleet_vault.VaultError:
                    continue
                values[secret_id] = value.decode("utf-8")

    try:
        plan = fleet_device_cli.plan_apply(
            config["document"],
            values,
            body.replies,
            asset_public_key=asset["public_key"],
            allow_private_key=body.allow_private_key,
            allow_radio=body.allow_radio,
        )
    except fleet_device_cli.DeviceMismatchError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except (fleet_device_cli.DeviceCliError, fleet_config.ConfigError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if values:
        await _audit(
            request,
            "config_apply_planned",
            asset_id=config["asset_id"],
            detail=f"config {config_id}: {len(values)} secrets",
        )
    device = fleet_device_cli.read_device(body.replies)
    out = {
        "identity": _identity(device.identity),
        "steps": [
            {
                "index": index,
                "section": step.section,
                "path": list(step.path),
                "command": step.command,
                "display": step.display,
                "secret": step.secret,
                "reboot": step.reboot,
                "readback": step.readback,
                "expect": step.expect,
                "check": step.check,
            }
            for index, step in enumerate(plan.steps)
        ],
        "rows": [
            {
                "path": list(row.path),
                "status": row.status,
                "configured": row.configured,
                "device": row.device,
                "reason": row.reason,
            }
            for row in plan.rows
        ],
        "reboot": plan.reboot,
        "rekey": plan.rekey,
        "vault": vault,
    }
    return JSONResponse(ApplyPlanOut.model_validate(out).model_dump(), headers=_NO_STORE)


@router.post("/device/check", response_model=StepCheckResult)
async def check_device_step(body: StepCheckRequest) -> dict[str, Any]:
    """Whether a sent command's reply and read-back are what its step expects."""
    step = body.step
    if not fleet_device_cli.command_allowed(step.command) or not all(
        fleet_device_cli.command_allowed(command) for command in step.readback
    ):
        raise HTTPException(status_code=422, detail="This command is not sent over the cable")
    cli_step = fleet_device_cli.ApplyStep(
        section=step.section,
        path=tuple(step.path),
        command=step.command,
        display=step.display,
        secret=step.secret,
        reboot=step.reboot,
        readback=step.readback,
        expect=step.expect,
        check=step.check,
    )
    ok, reason = fleet_device_cli.check_step(cli_step, body.reply, body.readback)
    return {"ok": ok, "reason": reason, "reply": fleet_device_cli.reply_shown(cli_step, body.reply)}


@router.post(
    "/configs/{config_id}/apply-log",
    response_model=FleetAssetEvent,
    status_code=status.HTTP_201_CREATED,
)
async def log_apply(config_id: int, body: ApplyLogRequest) -> dict[str, Any]:
    """Write an apply's outcome to the asset's log: the commands, never a secret value."""
    config = await _config_or_404(config_id)
    sent = len(body.results)
    failed = next((index for index, result in enumerate(body.results) if not result.ok), None)
    how = _TRANSPORT_NAMES[body.transport]
    label = f"config {config_id}" + (f" ({config['label']})" if config["label"] else "")
    if failed is not None:
        summary = f"Applying {label} over {how} stopped at command {failed + 1} of {body.total}"
    elif sent < body.total:
        summary = f"Applying {label} over {how} ended after {sent} of {body.total} commands"
    else:
        summary = f"Applied {label} over {how}: {sent} of {body.total} commands"
    lines = [
        f"{'OK  ' if result.ok else 'FAIL'} {result.display}"
        + (f"  -> {result.reply}" if result.reply else "")
        for result in body.results
    ]
    if body.stopped_reason:
        lines.append(f"Stopped: {body.stopped_reason}")
    if body.reboot_needed:
        lines.append("A restart of the device is needed for some settings.")
    event = await FleetEventRepository.create(
        config["asset_id"],
        {
            "kind": "config_applied",
            "occurred_at": int(time.time()),
            "summary": summary[:_TEXT_MAX],
            "detail": "\n".join(lines)[:4000] or None,
        },
    )
    logger.info("Fleet asset %d: %s", config["asset_id"], summary)
    return event
