"""The multi-radio gateway app (plan 30).

The only listener on the public port in multi-radio mode. It owns the radio
list, runs one worker per radio, and forwards ``/r/<key>/...`` to the worker of
that radio. Paths in redirects and in the ``url`` field are relative, so the
gateway also works behind an outer reverse proxy that adds a sub-path.
"""

from __future__ import annotations

import asyncio
import contextlib
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from app.config import settings as default_settings
from app.gateway.keys import assign_url_keys, resolve
from app.gateway.proxy import WORKER_UNAVAILABLE, proxy_http, proxy_websocket
from app.gateway.registry import RadioEntry, RadioRegistry, RegistryError, Transport
from app.gateway.supervisor import WorkerSupervisor
from app.security import add_optional_basic_auth_middleware

LAST_RADIO_COOKIE = "rtfm_last_radio"
_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]


class RadioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    transport: Transport
    enabled: bool = True
    env: dict[str, str] = Field(default_factory=dict)


class RadioUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    transport: Transport | None = None
    enabled: bool | None = None
    env: dict[str, str] | None = None


def create_gateway_app(
    *,
    settings=None,
    registry: RadioRegistry | None = None,
    supervisor=None,
    client: httpx.AsyncClient | None = None,
) -> FastAPI:
    settings = settings or default_settings
    registry = registry or RadioRegistry(Path(settings.database_path).parent / "radios.json")
    owns_client = client is None
    # No read timeout: radio operations behind a worker can take minutes.
    client = client or httpx.AsyncClient(
        timeout=httpx.Timeout(5.0, read=None, write=None, pool=None)
    )

    async def on_health(radio_id: int, health: dict) -> None:
        identity = health.get("radio_identity") or {}
        public_key = identity.get("public_key")
        if public_key and registry.get(radio_id) is not None:
            registry.set_public_key(radio_id, public_key)

    supervisor = supervisor or WorkerSupervisor(registry, client=client, on_health=on_health)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        registry.load()
        registry.bootstrap_from_settings(settings)
        for entry in registry.radios:
            if entry.enabled:
                await supervisor.start(entry.id)
        monitor = asyncio.create_task(supervisor.run())
        try:
            yield
        finally:
            monitor.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await monitor
            await supervisor.shutdown()
            if owns_client:
                await client.aclose()

    app = FastAPI(title="RTFM-EV gateway", docs_url=None, redoc_url=None, lifespan=lifespan)
    add_optional_basic_auth_middleware(app, settings)

    def radio_view(entry: RadioEntry) -> dict:
        url_key = assign_url_keys(registry.radios).get(entry.id)
        return {
            "id": entry.id,
            "name": entry.name,
            "enabled": entry.enabled,
            # The BLE PIN is a secret and never leaves the gateway.
            "transport": entry.transport.model_dump(exclude={"pin"}),
            "database_path": entry.database_path,
            "env": entry.env,
            "public_key": entry.public_key,
            "url_key": url_key,
            # Relative to the gateway root.
            "url": f"r/{url_key}/" if url_key else None,
            **supervisor.view(entry.id),
        }

    def require_radio(radio_id: int) -> RadioEntry:
        entry = registry.get(radio_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Unknown radio")
        return entry

    @app.get("/")
    async def root(request: Request):
        keys = assign_url_keys(registry.radios)
        last = request.cookies.get(LAST_RADIO_COOKIE, "")
        target = keys.get(int(last)) if last.isdigit() else None
        if target is None and keys:
            target = keys[min(keys)]
        return RedirectResponse(f"r/{target}/" if target else "gateway/api/radios", status_code=307)

    @app.get("/gateway/api/radios")
    async def list_radios() -> list[dict]:
        return [radio_view(entry) for entry in registry.radios]

    @app.post("/gateway/api/radios", status_code=201)
    async def add_radio(body: RadioCreate) -> dict:
        try:
            entry = registry.add(
                name=body.name, transport=body.transport, enabled=body.enabled, env=body.env
            )
        except RegistryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if entry.enabled:
            await supervisor.start(entry.id)
        return radio_view(entry)

    @app.patch("/gateway/api/radios/{radio_id}")
    async def update_radio(radio_id: int, body: RadioUpdate) -> dict:
        before = require_radio(radio_id)
        try:
            entry = registry.update(
                radio_id,
                name=body.name,
                transport=body.transport,
                enabled=body.enabled,
                env=body.env,
            )
        except RegistryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        connection_changed = entry.transport != before.transport or entry.env != before.env
        if not entry.enabled:
            if before.enabled:
                await supervisor.stop(radio_id)
        elif connection_changed or not before.enabled:
            await supervisor.restart(radio_id)
        return radio_view(entry)

    @app.delete("/gateway/api/radios/{radio_id}")
    async def delete_radio(radio_id: int, delete_data: bool = False) -> dict:
        entry = require_radio(radio_id)
        await supervisor.stop(radio_id)
        supervisor.forget(radio_id)
        registry.remove(radio_id)
        if delete_data:
            # Only the directory the gateway created for this radio. Radio 1 of an
            # upgraded install lives in the shared data directory and is kept.
            own_dir = (registry.path.parent / "radios" / str(radio_id)).resolve()
            if Path(entry.database_path).resolve().parent == own_dir and own_dir.is_dir():
                shutil.rmtree(own_dir)
        return {"status": "ok"}

    @app.post("/gateway/api/radios/{radio_id}/start")
    async def start_radio(radio_id: int) -> dict:
        entry = require_radio(radio_id)
        await supervisor.start(radio_id)
        return radio_view(entry)

    @app.post("/gateway/api/radios/{radio_id}/stop")
    async def stop_radio(radio_id: int) -> dict:
        entry = require_radio(radio_id)
        await supervisor.stop(radio_id)
        return radio_view(entry)

    @app.post("/gateway/api/radios/{radio_id}/restart")
    async def restart_radio(radio_id: int) -> dict:
        entry = require_radio(radio_id)
        await supervisor.restart(radio_id)
        return radio_view(entry)

    @app.get("/gateway/api/radios/{radio_id}/log")
    async def radio_log(radio_id: int, limit: int = 200) -> dict:
        require_radio(radio_id)
        return {"lines": supervisor.log_lines(radio_id, limit)}

    def _query(request) -> str:
        return f"?{request.url.query}" if request.url.query else ""

    @app.get("/r/{segment}")
    async def add_trailing_slash(segment: str, request: Request):
        return RedirectResponse(f"{segment}/{_query(request)}", status_code=307)

    @app.api_route("/r/{segment}/{path:path}", methods=_HTTP_METHODS)
    async def workspace_http(segment: str, path: str, request: Request):
        found = resolve(segment, registry.radios)
        if found is None:
            raise HTTPException(status_code=404, detail="Unknown radio")
        if found.redirect_key is not None:
            up = "../" * (path.count("/") + 1)
            return RedirectResponse(
                f"{up}{found.redirect_key}/{path}{_query(request)}", status_code=307
            )
        worker = supervisor.worker(found.radio_id)
        if worker.state != "running":
            return JSONResponse(WORKER_UNAVAILABLE, status_code=503)
        response = await proxy_http(
            request,
            client=client,
            port=worker.port,
            token=worker.token,
            prefix=f"/r/{segment}",
            path=path,
        )
        if path == "" and request.method == "GET" and response.status_code < 400:
            cookie = f"{LAST_RADIO_COOKIE}={found.radio_id}; Path=/; Max-Age=31536000; SameSite=Lax"
            response.raw_headers.append((b"set-cookie", cookie.encode("ascii")))
        return response

    @app.websocket("/r/{segment}/{path:path}")
    async def workspace_ws(websocket: WebSocket, segment: str, path: str):
        found = resolve(segment, registry.radios)
        if found is None or found.redirect_key is not None:
            await websocket.close(code=1008)
            return
        worker = supervisor.worker(found.radio_id)
        if worker.state != "running":
            await websocket.close(code=1013)
            return
        await proxy_websocket(
            websocket, port=worker.port, token=worker.token, prefix=f"/r/{segment}", path=path
        )

    return app
