"""The multi-radio gateway app (plan 30).

The only listener on the public port in multi-radio mode. It owns the radio
list, runs one worker per radio, and forwards ``/r/<key>/...`` to the worker of
that radio. Paths in redirects and in the ``url`` field are relative, so the
gateway also works behind an outer reverse proxy that adds a sub-path.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field

from app.config import settings as default_settings
from app.gateway.channel_sync import ChannelSync, changes_channels, deleted_keys
from app.gateway.keys import assign_url_keys, resolve
from app.gateway.proxy import WORKER_UNAVAILABLE, proxy_http, proxy_websocket
from app.gateway.registry import RadioEntry, RadioRegistry, RegistryError, Transport
from app.gateway.supervisor import PROJECT_ROOT, WorkerSupervisor
from app.security import add_optional_basic_auth_middleware

LAST_RADIO_COOKIE = "rtfm_last_radio"
_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
DEFAULT_FRONTEND_DIRS = [
    PROJECT_ROOT / "frontend" / "dist",
    PROJECT_ROOT / "frontend" / "prebuilt",
]
CONTEXT_SCRIPT = "radio-context.js"


def _context_script(context: dict) -> Response:
    """The page context as a classic script, so the frontend has it before its bundle runs.

    index.html loads ./radio-context.js first. In single-radio mode that is a
    static no-op file from the build; here the gateway answers it instead.
    """
    # "</" is escaped so the value stays harmless if it is ever inlined into HTML.
    payload = json.dumps(context).replace("</", "<\\/")
    body = f"window.__RTFM_GATEWAY__ = {payload};\n"
    return Response(body, media_type="text/javascript", headers={"Cache-Control": "no-store"})


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
    frontend_dirs: list[Path] | None = None,
) -> FastAPI:
    settings = settings or default_settings
    frontend_dir = next(
        (
            candidate.resolve()
            for candidate in (frontend_dirs or DEFAULT_FRONTEND_DIRS)
            if (candidate / "index.html").is_file()
        ),
        None,
    )
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
        channel_sync.note_worker_alive(radio_id)

    supervisor = supervisor or WorkerSupervisor(registry, client=client, on_health=on_health)
    channel_sync = ChannelSync(registry, supervisor, client)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        registry.load()
        registry.bootstrap_from_settings(settings)
        for entry in registry.radios:
            if entry.enabled:
                await supervisor.start(entry.id)
        background = [
            asyncio.create_task(supervisor.run()),
            asyncio.create_task(channel_sync.run()),
        ]
        try:
            yield
        finally:
            for task in background:
                task.cancel()
            for task in background:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
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
        # No workspace yet (no radio has connected): the radios page.
        return RedirectResponse(f"r/{target}/" if target else "gateway/", status_code=307)

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

    @app.get("/gateway")
    async def radios_page_add_slash():
        return RedirectResponse("gateway/", status_code=307)

    @app.get(f"/gateway/{CONTEXT_SCRIPT}")
    async def radios_page_context():
        return _context_script({"page": "radios", "base": "./", "radio": None})

    @app.get("/gateway/{path:path}")
    async def radios_page(path: str):
        """The same frontend build as the workspaces; it renders the radios page here."""
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        if frontend_dir is None:
            return JSONResponse({"detail": "Frontend build not found"}, status_code=503)
        index_file = frontend_dir / "index.html"
        candidate = (frontend_dir / path).resolve()
        if not candidate.is_relative_to(frontend_dir):
            raise HTTPException(status_code=404, detail="Not found")
        if path and candidate.is_file() and candidate != index_file:
            return FileResponse(candidate)
        return FileResponse(index_file, headers={"Cache-Control": "no-store"})

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
        if path == CONTEXT_SCRIPT and request.method == "GET":
            entry = registry.get(found.radio_id)
            return _context_script(
                {
                    "page": "workspace",
                    "base": "../../gateway/",
                    "radio": {
                        "id": found.radio_id,
                        "name": entry.name if entry else "",
                        "urlKey": segment,
                    },
                }
            )
        worker = supervisor.worker(found.radio_id)
        if worker.state != "running":
            return JSONResponse(WORKER_UNAVAILABLE, status_code=503)
        # Channels are shared by all radios: note what this request changes.
        watch_channels = changes_channels(request.method, path)
        # Reading the body here keeps it available to the proxy as well.
        body = await request.body() if path == "api/channels/bulk-delete" else b""
        response = await proxy_http(
            request,
            client=client,
            port=worker.port,
            token=worker.token,
            prefix=f"/r/{segment}",
            path=path,
        )
        if watch_channels and response.status_code < 300:
            channel_sync.note_deleted(found.radio_id, deleted_keys(request.method, path, body))
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
