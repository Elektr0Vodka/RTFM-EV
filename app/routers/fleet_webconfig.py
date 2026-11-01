"""An observer's web config over the LAN (plan 32, Phase 4).

The server talks to the observer's web config at a LAN address the user
gives (``fleet_webconfig.lan_address`` refuses anything else), logs in with
the node's admin password from the key vault, and logs out after each call.
Before logging in it checks that the node is the asset (``/api/status`` gives
the first 8 bytes of its public key) and that the web config is in LAN mode.

Applying goes one command at a time, driven by the browser as over the
cable: ``/webconfig/plan`` gives the commands, ``/webconfig/step`` sends ONE
as a one-key save, waits for its result and reads the config back, and the
browser stops at the first that is not as expected and writes the log
(``/configs/{id}/apply-log`` with transport ``webconfig``).

Starting and stopping the web config is the only part that uses the radio:
``/webconfig/start`` and ``/webconfig/stop`` send that one CLI command to the
node over the mesh, and only when called with ``confirm`` (a button the user
presses and confirms).

The rules are in ``app.services.fleet_webconfig``, the HTTP calls in
``app.services.fleet_webconfig_client``.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.models import Contact
from app.repository import ContactRepository
from app.repository.fleet_vault import FleetVaultRepository
from app.routers.fleet import _asset_or_404, _clean_text
from app.routers.fleet_config import _config_or_404, store_config
from app.routers.fleet_device import (
    ApplyPlanOut,
    ApplyStepModel,
    StepCheckResult,
    open_config_secrets,
)
from app.routers.fleet_vault import _NO_STORE, _audit, _require_key
from app.routers.server_control import require_server_capable_contact, send_contact_cli_command
from app.services import fleet_config, fleet_vault, fleet_webconfig
from app.services.fleet_device_cli import ApplyStep
from app.services.fleet_webconfig import WebConfigError
from app.services.fleet_webconfig_client import WebConfigClient
from app.services.radio_runtime import radio_runtime as radio_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/fleet", tags=["fleet web config"])

_TEXT_MAX = 200
# Tests replace this with a client on a fake transport.
_client_factory = WebConfigClient


class LanTarget(BaseModel):
    host: str = Field(max_length=253, description="The node's LAN address or name")


class LanRead(LanTarget):
    store: bool = Field(default=False, description="Store what was read as a snapshot")
    label: str | None = Field(default=None, max_length=_TEXT_MAX)


class LanPlan(LanTarget):
    allow_radio: bool = Field(default=False, description="May change frequency, bandwidth, SF, CR")


class LanStep(LanTarget):
    step: ApplyStepModel


class LanStatus(BaseModel):
    mode: str | None = None
    name: str | None = None
    node_id: str | None = None
    fw: str | None = None
    role: str | None = None
    board: str | None = None


class LanReadResult(BaseModel):
    status: LanStatus
    document: dict[str, Any] = Field(description='Each secret is {"$secret": null}')
    secrets: int
    stored: dict[str, Any] | None = Field(description="The import answer when stored")


class WebConfigToggle(BaseModel):
    confirm: Literal[True] = Field(description="The user confirmed sending this over the radio")


class WebConfigToggleResult(BaseModel):
    reply: str
    host: str | None = Field(description="The LAN address the node gave, when it started")


def _device_error(exc: WebConfigError) -> HTTPException:
    """A problem on the node's side: 502, with a code the page translates."""
    return HTTPException(status_code=502, detail={"code": exc.code, "message": str(exc)})


def _address(host: str) -> str:
    try:
        return fleet_webconfig.lan_address(host)
    except WebConfigError as exc:
        raise HTTPException(
            status_code=422, detail={"code": exc.code, "message": str(exc)}
        ) from None


async def _admin_password(asset: dict[str, Any], vault_token: str | None) -> str:
    """The node's admin password from the vault (the newest one stored)."""
    data_key = _require_key(vault_token)
    for row in reversed(await FleetVaultRepository.all_sealed(int(asset["id"]))):
        if row["kind"] != "admin_password":
            continue
        try:
            value = fleet_vault.open_sealed(
                data_key,
                row["nonce"],
                row["ciphertext"],
                fleet_vault.secret_aad(row["asset_id"], row["kind"]),
            )
        except fleet_vault.VaultError:
            continue
        return value.decode("utf-8")
    raise HTTPException(
        status_code=409,
        detail="Store the node's admin password in the key vault (kind: admin password) first",
    )


@asynccontextmanager
async def _session(
    asset: dict[str, Any], host: str, vault_token: str | None
) -> AsyncIterator[tuple[WebConfigClient, dict[str, Any]]]:
    """A logged-in web config session with the asset's node; logs out at the end.

    WebConfigError inside is left to the caller (a read answers 502, a step
    answers it as its reason).
    """
    if not asset["public_key"]:
        raise HTTPException(status_code=409, detail="This asset has no public key")
    address = _address(host)
    password = await _admin_password(asset, vault_token)
    async with _client_factory(address) as client:
        status = await client.status()
        if status.get("mode") != "lan":
            raise HTTPException(
                status_code=409,
                detail="The web config is in setup mode (its own access point), not on the LAN",
            )
        if not fleet_webconfig.identity_matches(status, asset["public_key"]):
            raise HTTPException(
                status_code=409,
                detail=f"This node is not this asset: it reports {status.get('node_id')}",
            )
        await client.login(password)
        try:
            yield client, status
        finally:
            await client.logout()


def _status_out(status: dict[str, Any]) -> dict[str, Any]:
    return {
        field: (str(status[field]) if status.get(field) is not None else None)
        for field in ("mode", "name", "node_id", "fw", "role", "board")
    }


@router.post("/assets/{asset_id}/webconfig/read", response_model=LanReadResult)
async def read_over_lan(
    asset_id: int,
    body: LanRead,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Read the node's settings over its web config; store them as a snapshot when asked.

    Only what the web config shows: no packet filter, region, hardware,
    alerts, guest password, private key or owner info, and no masked secret.
    """
    asset = await _asset_or_404(asset_id, health=False)
    try:
        async with _session(asset, body.host, x_fleet_vault_token) as (client, status):
            config = await client.get_config()
    except WebConfigError as exc:
        raise _device_error(exc) from None
    document = fleet_webconfig.document_from_config(config)
    preview, found = fleet_config.split_secrets(document)
    stored = None
    if body.store:
        stored = await store_config(
            asset,
            document,
            {
                "kind": "snapshot",
                "source": "webconfig",
                "profile": None,
                "role": status.get("role"),
                "firmware_version": status.get("fw"),
                "label": _clean_text(body.label),
            },
            request,
            x_fleet_vault_token,
        )
    return {
        "status": _status_out(status),
        "document": preview,
        "secrets": len(found),
        "stored": stored,
    }


@router.post("/configs/{config_id}/webconfig/plan", response_model=ApplyPlanOut)
async def plan_over_lan(
    config_id: int,
    body: LanPlan,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> Any:
    """The commands over the web config that make the node match this config.

    Nothing is sent from here. The answer holds secret values in its
    commands, so it is not cached; using the vault for them is audited.
    """
    config_row = await _config_or_404(config_id)
    if config_row["profile"] == "companion_v1":
        raise HTTPException(status_code=422, detail="A companion has no web config")
    asset = await _asset_or_404(config_row["asset_id"], health=False)
    try:
        async with _session(asset, body.host, x_fleet_vault_token) as (client, status):
            current = await client.get_config()
    except WebConfigError as exc:
        raise _device_error(exc) from None
    vault, values = await open_config_secrets(config_row, x_fleet_vault_token)
    try:
        plan = fleet_webconfig.plan_webconfig(
            config_row["document"], values, current, allow_radio=body.allow_radio
        )
    except WebConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if values:
        await _audit(
            request,
            "config_apply_planned",
            asset_id=config_row["asset_id"],
            detail=f"config {config_id}: {len(values)} secrets (web config)",
        )
    out = {
        "identity": {
            "public_key": asset["public_key"],
            "role": status.get("role"),
            "firmware_version": status.get("fw"),
            "board": status.get("board"),
            "name": status.get("name"),
        },
        "steps": [
            {
                "index": index,
                "section": step.section,
                "path": list(step.path),
                "command": step.command,
                "display": step.display,
                "secret": step.secret,
                "reboot": step.reboot,
                "readback": [],
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
        "rekey": False,
        "vault": vault,
    }
    return JSONResponse(ApplyPlanOut.model_validate(out).model_dump(), headers=_NO_STORE)


@router.post("/configs/{config_id}/webconfig/step", response_model=StepCheckResult)
async def step_over_lan(
    config_id: int,
    body: LanStep,
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Send ONE planned command as a one-key save, wait for it, read the config back.

    A problem on the node's side is answered as the step's reason, so the
    apply stops there and logs it.
    """
    step = body.step
    try:
        key, value = fleet_webconfig.step_key_value(step.command)
    except WebConfigError:
        raise HTTPException(
            status_code=422, detail="This command is not sent over the web config"
        ) from None
    config_row = await _config_or_404(config_id)
    asset = await _asset_or_404(config_row["asset_id"], health=False)
    cli_step = ApplyStep(
        section=step.section,
        path=tuple(step.path),
        command=step.command,
        display=step.display,
        secret=step.secret,
        reboot=step.reboot,
        readback=[],
        expect=step.expect,
        check=step.check,
    )
    try:
        async with _session(asset, body.host, x_fleet_vault_token) as (client, _status):
            result = await client.result(await client.save(key, value))
            after = await client.get_config() if step.check == "value" else {}
    except WebConfigError as exc:
        return {"ok": False, "reason": exc.code, "reply": ""}
    ok, reason = fleet_webconfig.check_webconfig_step(cli_step, result, after)
    return {"ok": ok, "reason": reason, "reply": fleet_webconfig.result_reply(cli_step, result)}


def _require_radio() -> None:
    radio_manager.require_connected()


async def _node_contact(asset: dict[str, Any]) -> Contact:
    if not asset["public_key"]:
        raise HTTPException(status_code=409, detail="This asset has no public key")
    contact = await ContactRepository.get_by_key(asset["public_key"])
    if contact is None:
        raise HTTPException(status_code=404, detail="This asset's node is not a contact")
    require_server_capable_contact(contact)
    return contact


async def _toggle(asset_id: int, command: str) -> dict[str, Any]:
    asset = await _asset_or_404(asset_id, health=False)
    _require_radio()
    contact = await _node_contact(asset)
    logger.info("Fleet asset %d: sending %r to its node over the mesh", asset_id, command)
    response = await send_contact_cli_command(
        contact, command, operation_name=f"fleet_{command.replace(' ', '_')}"
    )
    return {
        "reply": response.response,
        "host": fleet_webconfig.parse_start_reply(response.response),
    }


@router.post("/assets/{asset_id}/webconfig/start", response_model=WebConfigToggleResult)
async def start_webconfig(asset_id: int, body: WebConfigToggle) -> dict[str, Any]:
    """Send ``start webconfig`` to the asset's node over the mesh (a confirmed button press).

    The node must be logged in on its repeater page. On an observer without
    Wi-Fi settings this opens its setup access point, which has no login.
    """
    return await _toggle(asset_id, "start webconfig")


@router.post("/assets/{asset_id}/webconfig/stop", response_model=WebConfigToggleResult)
async def stop_webconfig(asset_id: int, body: WebConfigToggle) -> dict[str, Any]:
    """Send ``stop webconfig`` to the asset's node over the mesh (a confirmed button press)."""
    return await _toggle(asset_id, "stop webconfig")
