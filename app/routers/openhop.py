"""Gated proxy for OpenHop's REST API (Surface B).

Every endpoint here is fail-closed: it does nothing and returns 409 unless the
connected radio is detected as OpenHop AND the user has configured an OpenHop API
url + token. Non-OpenHop deployments never reach the delegating paths, and the
token is never returned to the client.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
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


async def _relay_upstream(
    action: Callable[[OpenHopClient], Awaitable[dict[str, Any]]],
) -> dict[str, Any]:
    """Like ``_relay`` but preserves the upstream HTTP status.

    Plugin endpoints need this so a 503 (plugin manager not running under
    ``container_supervisor``) reaches the client as 503, letting the UI show the
    right notice. Transport-level failures still map to 502.
    """
    client = await _require_client()
    try:
        return await action(client)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code, detail=f"OpenHop API error: {exc}"
        ) from exc
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


# ---------------------------------------------------------------------------
# Plugins (Surface B). Static ?id= query paths mirror OpenHop's own logs/settings
# style and avoid a /plugins/{id} path collision with the static subpaths.
# ---------------------------------------------------------------------------


class PluginId(BaseModel):
    id: str


class PluginInstallBody(BaseModel):
    id: str
    version: str | None = None


class PluginSettingsBody(BaseModel):
    id: str
    config: dict[str, Any]
    restart: bool = False


class PluginUninstallBody(BaseModel):
    id: str
    delete_data: bool = False


_LIFECYCLE: dict[str, str] = {
    "enable": "enable_plugin",
    "disable": "disable_plugin",
    "start": "start_plugin",
    "stop": "stop_plugin",
    "restart": "restart_plugin",
}


@router.get("/plugins")
async def list_plugins() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.list_plugins())


@router.get("/plugins/catalogue")
async def plugin_catalogue(refresh: bool = False) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.plugin_catalogue(force_refresh=refresh))


@router.get("/plugins/status")
async def plugin_status(id: str) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.plugin_status(id))


@router.get("/plugins/logs")
async def plugin_logs(id: str, tail: int = 200) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.plugin_logs(id, tail=tail))


@router.get("/plugins/settings")
async def plugin_settings_get(id: str) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.get_plugin_config(id))


@router.get("/plugins/updates")
async def plugin_updates(id: str, refresh: bool = False) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.check_plugin_update(id, force_refresh=refresh))


@router.post("/plugins/catalogue_install")
async def plugin_catalogue_install(body: PluginInstallBody) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.catalogue_install(body.id, version=body.version))


@router.post("/plugins/update")
async def plugin_update(body: PluginInstallBody) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.update_plugin(body.id, version=body.version))


@router.post("/plugins/settings")
async def plugin_settings_set(body: PluginSettingsBody) -> dict[str, Any]:
    return await _relay_upstream(
        lambda c: c.set_plugin_config(body.id, body.config, restart=body.restart)
    )


@router.post("/plugins/uninstall")
async def plugin_uninstall(body: PluginUninstallBody) -> dict[str, Any]:
    return await _relay_upstream(
        lambda c: c.uninstall_plugin(body.id, delete_data=body.delete_data)
    )


@router.post("/plugins/{verb}")
async def plugin_lifecycle(verb: str, body: PluginId) -> dict[str, Any]:
    method = _LIFECYCLE.get(verb)
    if method is None:
        raise HTTPException(status_code=400, detail=f"unknown lifecycle verb: {verb}")
    return await _relay_upstream(lambda c: getattr(c, method)(body.id))


# Injectable transport so tests can supply an httpx.MockTransport for the SSE path.
_stream_transport: httpx.AsyncBaseTransport | None = None


@router.get("/plugins/progress")
async def plugin_progress(id: str, since: int = 0, fresh: bool = False) -> StreamingResponse:
    """Re-stream OpenHop's plugin progress SSE. Stateless passthrough, fail-closed."""
    settings = await AppSettingsRepository.get()
    if not (_detect_openhop() and settings.openhop_api_url and settings.openhop_api_token):
        raise HTTPException(status_code=409, detail="OpenHop management not configured")
    base = settings.openhop_api_url.rstrip("/")
    token = settings.openhop_api_token
    params = {"id": id, "since": since, "fresh": "1" if fresh else "0"}

    async def stream():
        # No read timeout: progress can be idle between lines. Connect timeout stays bounded.
        timeout = httpx.Timeout(8.0, read=None)
        async with httpx.AsyncClient(
            base_url=base,
            headers={"X-API-Key": token},
            timeout=timeout,
            transport=_stream_transport,
        ) as client:
            try:
                async with client.stream("GET", "/api/plugins/progress", params=params) as resp:
                    async for chunk in resp.aiter_raw():
                        if chunk:
                            yield chunk
            except httpx.HTTPError as exc:
                payload = json.dumps({"type": "done", "state": "error", "error": str(exc)})
                yield f"data: {payload}\n\n".encode()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Config (Surface B). All config endpoints return HTTP 200 with a success flag,
# so _relay is sufficient (transport failures -> 502). The frontend reads the
# success flag and shows the node's error message when false.
# ---------------------------------------------------------------------------


class ConfigModeRequest(BaseModel):
    mode: str


class ConfigRadioRequest(BaseModel):
    params: dict[str, Any]


class ConfigImportRequest(BaseModel):
    config: dict[str, Any]
    restart_after: bool = False


@router.get("/config/export")
async def config_export(include_secrets: bool = False) -> dict[str, Any]:
    return await _relay(lambda c: c.config_export(include_secrets=include_secrets))


@router.get("/config/validate")
async def config_validate() -> dict[str, Any]:
    return await _relay(lambda c: c.validate_config())


@router.get("/config/hardware_options")
async def config_hardware_options() -> dict[str, Any]:
    return await _relay(lambda c: c.hardware_options())


@router.get("/config/presets")
async def config_presets() -> dict[str, Any]:
    return await _relay(lambda c: c.radio_presets())


@router.post("/config/mode")
async def config_mode(body: ConfigModeRequest) -> dict[str, Any]:
    return await _relay(lambda c: c.set_mode(body.mode))


@router.post("/config/radio")
async def config_radio(body: ConfigRadioRequest) -> dict[str, Any]:
    return await _relay(lambda c: c.update_radio_config(body.params))


@router.post("/config/import")
async def config_import(body: ConfigImportRequest) -> dict[str, Any]:
    return await _relay(lambda c: c.config_import(body.config, restart_after=body.restart_after))


@router.post("/config/restart")
async def config_restart() -> dict[str, Any]:
    return await _relay(lambda c: c.restart_service())
