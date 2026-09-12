"""Gated proxy for OpenHop's REST API (Surface B).

Every endpoint here is fail-closed: it does nothing and returns 409 unless the
connected radio is detected as OpenHop AND the user has configured an OpenHop API
url + token. Non-OpenHop deployments never reach the delegating paths, and the
token is never returned to the client.
"""

import logging
from collections.abc import Awaitable, Callable
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.repository.settings import AppSettingsRepository
from app.services.openhop import is_openhop
from app.services.openhop_api import OpenHopClient
from app.services.radio_runtime import radio_runtime as radio_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/openhop", tags=["openhop"])


class OpenHopStatus(BaseModel):
    configured: bool
    is_openhop: bool
    base_url: str | None


class OpenHopCliRequest(BaseModel):
    command: str


Kind = Literal["channel_hashes", "pubkeys"]


class PolicyDoc(BaseModel):
    policy: dict[str, Any]


class GroupCreate(BaseModel):
    kind: Kind
    group_id: str
    friendly_name: str = ""
    description: str = ""


class GroupDelete(BaseModel):
    kind: Kind
    group_id: str


class EntryCreate(BaseModel):
    kind: Kind
    group_id: str
    value: str


class EntryDelete(BaseModel):
    kind: Kind
    group_id: str
    value: str | None = None
    entry_id: str | None = None


def _detect_openhop() -> bool:
    """True when the connected radio identifies as an OpenHop node."""
    return is_openhop(getattr(radio_manager, "device_model", None))


async def _require_client() -> OpenHopClient:
    """Build a client only when OpenHop is detected AND a url + token are set.

    Fail-closed: raises 409 otherwise. The caller must ``aclose()`` the client.
    """
    settings = await AppSettingsRepository.get()
    if not (_detect_openhop() and settings.openhop_api_url and settings.openhop_api_token):
        raise HTTPException(status_code=409, detail="OpenHop management not configured")
    return OpenHopClient(settings.openhop_api_url, settings.openhop_api_token)


async def _relay(action: Callable[[OpenHopClient], Awaitable[dict[str, Any]]]) -> dict[str, Any]:
    """Run a gated OpenHop call, mapping transport failures to 502 and closing the client."""
    client = await _require_client()
    try:
        return await action(client)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OpenHop API error: {exc}") from exc
    finally:
        await client.aclose()


@router.get("/status", response_model=OpenHopStatus)
async def get_status() -> OpenHopStatus:
    """Report whether OpenHop management is available. Never returns the token."""
    settings = await AppSettingsRepository.get()
    openhop = _detect_openhop()
    configured = bool(openhop and settings.openhop_api_url and settings.openhop_api_token)
    return OpenHopStatus(
        configured=configured,
        is_openhop=openhop,
        base_url=settings.openhop_api_url,
    )


@router.get("/policy")
async def get_policy() -> dict[str, Any]:
    """Delegate to the OpenHop node's policy endpoint (read-only)."""
    client = await _require_client()
    try:
        return await client.get_policy()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OpenHop API error: {exc}") from exc
    finally:
        await client.aclose()


@router.post("/cli")
async def run_cli(body: OpenHopCliRequest) -> dict[str, Any]:
    """Relay a CLI command to the OpenHop node (foundation: read-only verbs)."""
    client = await _require_client()
    try:
        return await client.cli(body.command)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OpenHop API error: {exc}") from exc
    finally:
        await client.aclose()


@router.post("/policy")
async def update_policy(body: PolicyDoc) -> dict[str, Any]:
    """Replace the node's policy_engine config (gated)."""
    return await _relay(lambda c: c.update_policy(body.policy))


@router.post("/policy/validate")
async def validate_policy(body: PolicyDoc) -> dict[str, Any]:
    """Validate a policy payload without saving it (gated)."""
    return await _relay(lambda c: c.validate_policy(body.policy))


@router.get("/policy/groups")
async def list_policy_groups(kind: Kind | None = None) -> dict[str, Any]:
    return await _relay(lambda c: c.list_policy_groups(kind))


@router.post("/policy/groups")
async def create_policy_group(body: GroupCreate) -> dict[str, Any]:
    return await _relay(
        lambda c: c.create_policy_group(
            body.kind,
            body.group_id,
            friendly_name=body.friendly_name,
            description=body.description,
        )
    )


@router.delete("/policy/groups")
async def delete_policy_group(body: GroupDelete) -> dict[str, Any]:
    return await _relay(lambda c: c.delete_policy_group(body.kind, body.group_id))


@router.post("/policy/groups/entries")
async def add_group_entry(body: EntryCreate) -> dict[str, Any]:
    return await _relay(lambda c: c.add_group_entry(body.kind, body.group_id, body.value))


@router.delete("/policy/groups/entries")
async def delete_group_entry(body: EntryDelete) -> dict[str, Any]:
    return await _relay(
        lambda c: c.delete_group_entry(
            body.kind, body.group_id, value=body.value, entry_id=body.entry_id
        )
    )
