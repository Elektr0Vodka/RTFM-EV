# OpenHop Plugins Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a detection-gated OpenHop Plugins management pane (installed list + catalogue, lifecycle, settings, logs, uninstall, catalogue-install, update, with a live streaming install/update log) rendered in RTFM-EV's settings theme, and consolidate the existing OpenHop Policy pane and this Plugins pane under one OpenHop settings section with an internal sub-nav.

**Architecture:** Extend the existing fail-closed `/api/openhop` proxy + `OpenHopClient` with typed plugin methods (no new migration). Add one SSE passthrough route that re-streams OpenHop's `/api/plugins/progress` event-stream via a FastAPI `StreamingResponse`. On the frontend, refactor `SettingsOpenHopSection` into a sub-nav container (Policy | Plugins) that hosts the existing Policy pane unchanged and a new Plugins pane with Installed / Catalogue tabs; long operations render a live log via `EventSource`.

**Tech Stack:** Backend FastAPI + httpx (`OpenHopClient`, `StreamingResponse`). Frontend React + TypeScript + i18next (EN/NL/DE enforced) + Vitest + browser `EventSource`. Verified against the container sim.

**Spec:** `docs/superpowers/specs/2026-09-13-openhop-plugins-pane-design.md` (read it; it carries the verified OpenHop plugin API, the SSE event shapes, and the resolved decisions).

**Non-negotiable constraint:** Non-OpenHop nodes are unaffected. The OpenHop section only appears when `is_openhop`; the Plugins pane renders only when OpenHop AND management is configured. No existing endpoint/type/control changes shape. New user-facing strings need EN/NL/DE `t()` keys. No em dashes.

**Scope reminder:** Local `.whl` upload install is OUT of scope. Catalogue install is the only install path.

---

## File Structure

**Backend:**
- Modify `app/services/openhop_api.py` — add plugin methods (read + write).
- Modify `app/routers/openhop.py` — add gated `/openhop/plugins/*` endpoints + one SSE passthrough route.
- Tests: `tests/test_openhop_api_service.py`, `tests/test_openhop_router.py` (extend).

**Frontend:**
- Modify `frontend/src/types.ts` — plugin/catalogue/progress-event types.
- Modify `frontend/src/api.ts` — client methods (+ a progress EventSource URL helper).
- Modify `frontend/src/components/settings/openhop/SettingsOpenHopSection.tsx` — becomes the sub-nav container.
- Create `frontend/src/components/settings/openhop/OpenHopPolicyPane.tsx` — the existing Policy body, moved out of `SettingsOpenHopSection` verbatim.
- Create `frontend/src/components/settings/openhop/plugins/OpenHopPluginsPane.tsx` — Installed / Catalogue tabs + gating + load.
- Create `frontend/src/components/settings/openhop/plugins/PluginList.tsx`, `PluginCard.tsx`.
- Create `frontend/src/components/settings/openhop/plugins/PluginLogsView.tsx`, `PluginSettingsEditor.tsx`.
- Create `frontend/src/components/settings/openhop/plugins/CatalogueList.tsx`, `CatalogueCard.tsx`.
- Create `frontend/src/components/settings/openhop/plugins/PluginProgressLog.tsx`.
- Modify `frontend/src/i18n/locales/{en,nl,de}.json`.
- Tests: `frontend/src/test/openHopPluginsPane.test.tsx`, `frontend/src/test/openHopSectionSubnav.test.tsx`.

**Type shapes (reference, defined once in Task 5; optional fields where OpenHop's object is loosely typed):**
```
OpenHopPlugin = { id: string; name?: string; version?: string; enabled?: boolean;
                  state?: string; running?: boolean; update_available?: boolean;
                  latest_version?: string; [k: string]: unknown }
OpenHopCatalogueEntry = { id: string; name?: string; description?: string; repository?: string;
                          category?: string; version?: string; installed?: boolean;
                          update_available?: boolean; [k: string]: unknown }
OpenHopPluginProgressEvent =
  | { type: 'connected'; id: string }
  | { type: 'line'; line: string }
  | { type: 'status'; state: string; operation?: string | null; started?: number | null }
  | { type: 'done'; state: string; error?: string | null; started?: number | null }
  | { type: 'keepalive' }
```

> **Live-verify during Task 8/Task 10 (facts, not guesses):** confirm the exact installed-plugin object fields (`enabled` vs `state` vs `running`) and catalogue entry fields against the sim, and whether `catalogue_install`/`update` return synchronously or async-with-SSE. The types above are permissive (extra keys allowed) so UI code reads only the fields it renders; adjust the rendered fields to the observed shape.

---

## PHASE A — Backend

### Task 1: OpenHopClient plugin read methods

**Files:**
- Modify: `app/services/openhop_api.py`
- Test: `tests/test_openhop_api_service.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_openhop_api_service.py`)

```python
@pytest.mark.asyncio
async def test_plugin_read_methods_use_api_key():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[(request.method, request.url.path, request.url.query.decode())] = request.headers.get(
            "X-API-Key"
        )
        return httpx.Response(200, json={"success": True, "plugins": [], "data": {}})

    client = OpenHopClient("http://node:8000", token="tok", transport=httpx.MockTransport(handler))
    await client.list_plugins()
    await client.plugin_status("openhop.nomad")
    await client.plugin_catalogue()
    await client.plugin_catalogue(force_refresh=True)
    await client.plugin_logs("openhop.nomad", tail=50)
    await client.get_plugin_config("openhop.nomad")
    await client.check_plugin_update("openhop.nomad")
    await client.aclose()
    assert ("GET", "/api/plugins/", "") in seen
    assert ("GET", "/api/plugins/openhop.nomad", "") in seen
    assert ("GET", "/api/plugins/catalogue", "") in seen
    assert ("GET", "/api/plugins/catalogue", "refresh=1") in seen
    assert ("GET", "/api/plugins/logs", "id=openhop.nomad&tail=50") in seen
    assert ("GET", "/api/plugins/settings", "id=openhop.nomad") in seen
    assert ("GET", "/api/plugins/updates", "id=openhop.nomad") in seen
    assert all(v == "tok" for v in seen.values())
```

- [ ] **Step 2: Run to verify it fails** — `PYTHONPATH=. uv run pytest tests/test_openhop_api_service.py -k plugin_read -v` → FAIL (AttributeError: no `list_plugins`).

- [ ] **Step 3: Implement** (add to `OpenHopClient`, after `get_plugin`/`get_policy` region; add a `_get_q` helper for query params to keep paths exact)

```python
    async def _get_q(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.get(path, params=params)
        r.raise_for_status()
        return r.json()

    async def list_plugins(self) -> dict[str, Any]:
        return await self._get("/api/plugins/")

    async def plugin_status(self, plugin_id: str) -> dict[str, Any]:
        return await self._get(f"/api/plugins/{plugin_id}")

    async def plugin_catalogue(self, force_refresh: bool = False) -> dict[str, Any]:
        return await self._get("/api/plugins/catalogue" + ("?refresh=1" if force_refresh else ""))

    async def plugin_logs(self, plugin_id: str, tail: int = 200) -> dict[str, Any]:
        return await self._get_q("/api/plugins/logs", {"id": plugin_id, "tail": tail})

    async def get_plugin_config(self, plugin_id: str) -> dict[str, Any]:
        return await self._get_q("/api/plugins/settings", {"id": plugin_id})

    async def check_plugin_update(self, plugin_id: str, force_refresh: bool = False) -> dict[str, Any]:
        params: dict[str, Any] = {"id": plugin_id}
        if force_refresh:
            params["refresh"] = 1
        return await self._get_q("/api/plugins/updates", params)
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS. Also `uv run pyright app/services/openhop_api.py` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/services/openhop_api.py tests/test_openhop_api_service.py
git commit -m "feat(openhop): add plugin read client methods"
```

### Task 2: OpenHopClient plugin write methods

**Files:**
- Modify: `app/services/openhop_api.py`
- Test: `tests/test_openhop_api_service.py`

- [ ] **Step 1: Write the failing test** (append)

```python
@pytest.mark.asyncio
async def test_plugin_write_methods_send_expected_bodies():
    bodies = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json

        body = _json.loads(request.content.decode() or "{}")
        bodies[request.url.path] = (request.method, body, request.headers.get("X-API-Key"))
        return httpx.Response(200, json={"success": True})

    client = OpenHopClient("http://node:8000", token="tok", transport=httpx.MockTransport(handler))
    await client.enable_plugin("p1")
    await client.disable_plugin("p1")
    await client.start_plugin("p1")
    await client.stop_plugin("p1")
    await client.restart_plugin("p1")
    await client.catalogue_install("p1", version="2.0.0")
    await client.update_plugin("p1")
    await client.set_plugin_config("p1", {"k": 1}, restart=True)
    await client.uninstall_plugin("p1", delete_data=True)
    await client.aclose()
    assert bodies["/api/plugins/enable"] == ("POST", {"id": "p1"}, "tok")
    assert bodies["/api/plugins/catalogue_install"][1] == {"id": "p1", "version": "2.0.0"}
    assert bodies["/api/plugins/update"][1] == {"id": "p1"}
    assert bodies["/api/plugins/settings"][1] == {"id": "p1", "config": {"k": 1}, "restart": True}
    assert bodies["/api/plugins/uninstall"][1] == {"id": "p1", "delete_data": True}
```

- [ ] **Step 2: Run to verify it fails** — `PYTHONPATH=. uv run pytest tests/test_openhop_api_service.py -k plugin_write -v` → FAIL.

- [ ] **Step 3: Implement** (add to `OpenHopClient`)

```python
    async def enable_plugin(self, plugin_id: str) -> dict[str, Any]:
        return await self._post("/api/plugins/enable", {"id": plugin_id})

    async def disable_plugin(self, plugin_id: str) -> dict[str, Any]:
        return await self._post("/api/plugins/disable", {"id": plugin_id})

    async def start_plugin(self, plugin_id: str) -> dict[str, Any]:
        return await self._post("/api/plugins/start", {"id": plugin_id})

    async def stop_plugin(self, plugin_id: str) -> dict[str, Any]:
        return await self._post("/api/plugins/stop", {"id": plugin_id})

    async def restart_plugin(self, plugin_id: str) -> dict[str, Any]:
        return await self._post("/api/plugins/restart", {"id": plugin_id})

    async def catalogue_install(self, plugin_id: str, version: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"id": plugin_id}
        if version:
            body["version"] = version
        return await self._post("/api/plugins/catalogue_install", body)

    async def update_plugin(self, plugin_id: str, version: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"id": plugin_id}
        if version:
            body["version"] = version
        return await self._post("/api/plugins/update", body)

    async def set_plugin_config(
        self, plugin_id: str, config: dict[str, Any], restart: bool = False
    ) -> dict[str, Any]:
        return await self._post(
            "/api/plugins/settings", {"id": plugin_id, "config": config, "restart": restart}
        )

    async def uninstall_plugin(self, plugin_id: str, delete_data: bool = False) -> dict[str, Any]:
        return await self._post(
            "/api/plugins/uninstall", {"id": plugin_id, "delete_data": delete_data}
        )
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS. `uv run pyright app/services/openhop_api.py` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/services/openhop_api.py tests/test_openhop_api_service.py
git commit -m "feat(openhop): add plugin write client methods"
```

### Task 3: Router plugin endpoints (non-SSE)

**Files:**
- Modify: `app/routers/openhop.py`
- Test: `tests/test_openhop_router.py`

> **Routing note:** static subpaths (`/plugins`, `/plugins/catalogue`, `/plugins/status`, `/plugins/logs`, `/plugins/settings`, `/plugins/updates`, `/plugins/progress`) are used with `?id=` query params (mirroring OpenHop's own `logs?id=`/`settings?id=` style) so there is no `/plugins/{id}` path-parameter collision with the static routes. Lifecycle + install/update/uninstall are POST bodies.

- [ ] **Step 1: Write the failing test** (append; reuse the file's `_set_model`, `OPENHOP_MODEL`, `AppSettingsRepository`, `AsyncMock`, `patch`)

```python
class TestOpenHopPlugins:
    @pytest.mark.asyncio
    async def test_plugin_endpoints_409_unconfigured(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        from app.routers.openhop import list_plugins
        with pytest.raises(HTTPException) as exc:
            await list_plugins()
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_plugin_endpoints_delegate_when_configured(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        from app.routers.openhop import (
            list_plugins, plugin_status, plugin_catalogue, plugin_logs, plugin_settings_get,
            plugin_updates, plugin_lifecycle, plugin_catalogue_install, plugin_update,
            plugin_settings_set, plugin_uninstall,
            PluginId, PluginSettingsBody, PluginInstallBody, PluginUninstallBody,
        )
        fake = AsyncMock()
        for m in (
            "list_plugins", "plugin_status", "plugin_catalogue", "plugin_logs",
            "get_plugin_config", "check_plugin_update", "enable_plugin", "disable_plugin",
            "start_plugin", "stop_plugin", "restart_plugin", "catalogue_install",
            "update_plugin", "set_plugin_config", "uninstall_plugin",
        ):
            setattr(fake, m, AsyncMock(return_value={"success": True}))
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            await list_plugins()
            await plugin_status(id="p1")
            await plugin_catalogue(refresh=False)
            await plugin_logs(id="p1", tail=50)
            await plugin_settings_get(id="p1")
            await plugin_updates(id="p1", refresh=False)
            await plugin_lifecycle("enable", PluginId(id="p1"))
            await plugin_catalogue_install(PluginInstallBody(id="p1", version="2.0.0"))
            await plugin_update(PluginInstallBody(id="p1"))
            await plugin_settings_set(PluginSettingsBody(id="p1", config={"k": 1}, restart=True))
            await plugin_uninstall(PluginUninstallBody(id="p1", delete_data=True))
        fake.enable_plugin.assert_awaited_once_with("p1")
        fake.catalogue_install.assert_awaited_once_with("p1", version="2.0.0")
        fake.set_plugin_config.assert_awaited_once_with("p1", {"k": 1}, restart=True)
        fake.uninstall_plugin.assert_awaited_once_with("p1", delete_data=True)

    @pytest.mark.asyncio
    async def test_plugin_lifecycle_rejects_unknown_verb(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        from app.routers.openhop import plugin_lifecycle, PluginId
        with pytest.raises(HTTPException) as exc:
            await plugin_lifecycle("frobnicate", PluginId(id="p1"))
        assert exc.value.status_code == 400
```

- [ ] **Step 2: Run to verify it fails** — `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -k Plugins -v` → FAIL (ImportError).

- [ ] **Step 3: Implement** (add to `app/routers/openhop.py`; models near the other BaseModels, routes after the policy routes)

```python
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
    return await _relay(lambda c: c.list_plugins())


@router.get("/plugins/catalogue")
async def plugin_catalogue(refresh: bool = False) -> dict[str, Any]:
    return await _relay(lambda c: c.plugin_catalogue(force_refresh=refresh))


@router.get("/plugins/status")
async def plugin_status(id: str) -> dict[str, Any]:
    return await _relay(lambda c: c.plugin_status(id))


@router.get("/plugins/logs")
async def plugin_logs(id: str, tail: int = 200) -> dict[str, Any]:
    return await _relay(lambda c: c.plugin_logs(id, tail=tail))


@router.get("/plugins/settings")
async def plugin_settings_get(id: str) -> dict[str, Any]:
    return await _relay(lambda c: c.get_plugin_config(id))


@router.get("/plugins/updates")
async def plugin_updates(id: str, refresh: bool = False) -> dict[str, Any]:
    return await _relay(lambda c: c.check_plugin_update(id, force_refresh=refresh))


@router.post("/plugins/{verb}")
async def plugin_lifecycle(verb: str, body: PluginId) -> dict[str, Any]:
    method = _LIFECYCLE.get(verb)
    if method is None:
        raise HTTPException(status_code=400, detail=f"unknown lifecycle verb: {verb}")
    return await _relay(lambda c: getattr(c, method)(body.id))


@router.post("/plugins/catalogue_install")
async def plugin_catalogue_install(body: PluginInstallBody) -> dict[str, Any]:
    return await _relay(lambda c: c.catalogue_install(body.id, version=body.version))


@router.post("/plugins/update")
async def plugin_update(body: PluginInstallBody) -> dict[str, Any]:
    return await _relay(lambda c: c.update_plugin(body.id, version=body.version))


@router.post("/plugins/settings")
async def plugin_settings_set(body: PluginSettingsBody) -> dict[str, Any]:
    return await _relay(lambda c: c.set_plugin_config(body.id, body.config, restart=body.restart))


@router.post("/plugins/uninstall")
async def plugin_uninstall(body: PluginUninstallBody) -> dict[str, Any]:
    return await _relay(lambda c: c.uninstall_plugin(body.id, delete_data=body.delete_data))
```

> **Route-ordering note:** declare `@router.post("/plugins/{verb}")` AFTER the static POST routes (`catalogue_install`, `update`, `settings`, `uninstall`) so FastAPI matches those static paths first and `{verb}` only catches the five lifecycle verbs. The `_LIFECYCLE` allowlist rejects anything else with 400. Keep the code block's declaration order as written.

- [ ] **Step 4: Run to verify it passes** — `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -k Plugins -v` → PASS. `uv run pyright app/routers/openhop.py` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/routers/openhop.py tests/test_openhop_router.py
git commit -m "feat(openhop): gated plugin proxy endpoints (list/lifecycle/catalogue/update/settings/uninstall)"
```

### Task 4: Router SSE progress passthrough

**Files:**
- Modify: `app/routers/openhop.py`
- Test: `tests/test_openhop_router.py`

- [ ] **Step 1: Write the failing test** (append)

```python
class TestOpenHopPluginProgress:
    @pytest.mark.asyncio
    async def test_progress_409_unconfigured(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        from app.routers.openhop import plugin_progress
        with pytest.raises(HTTPException) as exc:
            await plugin_progress(id="p1", since=0, fresh=False)
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_progress_relays_upstream_event_stream(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )

        chunks = [b'data: {"type":"connected","id":"p1"}\n\n',
                  b'data: {"type":"line","line":"installing"}\n\n',
                  b'data: {"type":"done","state":"complete"}\n\n']

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/api/plugins/progress"
            assert request.headers.get("X-API-Key") == "tok"
            return httpx.Response(200, content=b"".join(chunks),
                                  headers={"Content-Type": "text/event-stream"})

        import app.routers.openhop as mod
        monkeypatch.setattr(mod, "_stream_transport", httpx.MockTransport(handler), raising=False)
        from app.routers.openhop import plugin_progress
        resp = await plugin_progress(id="p1", since=0, fresh=False)
        body = b""
        async for part in resp.body_iterator:
            body += part if isinstance(part, bytes) else part.encode()
        assert b'"type":"connected"' in body
        assert b'"type":"done"' in body
```

- [ ] **Step 2: Run to verify it fails** — `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -k Progress -v` → FAIL (ImportError `plugin_progress`).

- [ ] **Step 3: Implement** (add to `app/routers/openhop.py`; add imports `import json`, `from fastapi.responses import StreamingResponse`; add module-level `_stream_transport: httpx.AsyncBaseTransport | None = None` so tests can inject a MockTransport)

```python
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
                async with client.stream(
                    "GET", "/api/plugins/progress", params=params
                ) as resp:
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
```

- [ ] **Step 4: Run to verify it passes** — `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -k Progress -v` → PASS. Full router file: `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -v` → PASS. `uv run pyright app/routers/openhop.py` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/routers/openhop.py tests/test_openhop_router.py
git commit -m "feat(openhop): SSE passthrough for plugin install/update progress"
```

---

## PHASE B — Frontend

### Task 5: Types + api client + progress URL helper

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add types** (append near the other OpenHop types in `types.ts`)

```ts
export interface OpenHopPlugin {
  id: string;
  name?: string;
  version?: string;
  enabled?: boolean;
  state?: string;
  running?: boolean;
  update_available?: boolean;
  latest_version?: string;
  [k: string]: unknown;
}
export interface OpenHopCatalogueEntry {
  id: string;
  name?: string;
  description?: string;
  repository?: string;
  category?: string;
  version?: string;
  installed?: boolean;
  update_available?: boolean;
  [k: string]: unknown;
}
export type OpenHopPluginProgressEvent =
  | { type: 'connected'; id: string }
  | { type: 'line'; line: string }
  | { type: 'status'; state: string; operation?: string | null; started?: number | null }
  | { type: 'done'; state: string; error?: string | null; started?: number | null }
  | { type: 'keepalive' };
```

- [ ] **Step 2: Add api methods** (in `api.ts`, after the OpenHop policy methods; import the new types)

```ts
  listOpenHopPlugins: () =>
    fetchJson<OpenHopEnvelope<never> & { plugins: OpenHopPlugin[] }>('/openhop/plugins'),
  getOpenHopPluginStatus: (id: string) =>
    fetchJson<OpenHopEnvelope<OpenHopPlugin>>(`/openhop/plugins/status?id=${encodeURIComponent(id)}`),
  getOpenHopPluginCatalogue: (refresh = false) =>
    fetchJson<OpenHopEnvelope<{ plugins: OpenHopCatalogueEntry[] }>>(
      `/openhop/plugins/catalogue${refresh ? '?refresh=true' : ''}`,
    ),
  getOpenHopPluginLogs: (id: string, tail = 200) =>
    fetchJson<OpenHopEnvelope<{ lines?: string[]; log?: string }>>(
      `/openhop/plugins/logs?id=${encodeURIComponent(id)}&tail=${tail}`,
    ),
  getOpenHopPluginConfig: (id: string) =>
    fetchJson<OpenHopEnvelope<{ config?: Record<string, unknown> }>>(
      `/openhop/plugins/settings?id=${encodeURIComponent(id)}`,
    ),
  checkOpenHopPluginUpdate: (id: string, refresh = false) =>
    fetchJson<OpenHopEnvelope<{ update_available?: boolean; latest_version?: string }>>(
      `/openhop/plugins/updates?id=${encodeURIComponent(id)}${refresh ? '&refresh=true' : ''}`,
    ),
  openHopPluginLifecycle: (verb: 'enable' | 'disable' | 'start' | 'stop' | 'restart', id: string) =>
    fetchJson<OpenHopEnvelope>(`/openhop/plugins/${verb}`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
  installOpenHopCataloguePlugin: (id: string, version?: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/plugins/catalogue_install', {
      method: 'POST',
      body: JSON.stringify(version ? { id, version } : { id }),
    }),
  updateOpenHopPlugin: (id: string, version?: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/plugins/update', {
      method: 'POST',
      body: JSON.stringify(version ? { id, version } : { id }),
    }),
  setOpenHopPluginConfig: (id: string, config: Record<string, unknown>, restart = false) =>
    fetchJson<OpenHopEnvelope>('/openhop/plugins/settings', {
      method: 'POST',
      body: JSON.stringify({ id, config, restart }),
    }),
  uninstallOpenHopPlugin: (id: string, delete_data = false) =>
    fetchJson<OpenHopEnvelope>('/openhop/plugins/uninstall', {
      method: 'POST',
      body: JSON.stringify({ id, delete_data }),
    }),
  openHopPluginProgressUrl: (id: string, since = 0, fresh = true) =>
    `./api/openhop/plugins/progress?id=${encodeURIComponent(id)}&since=${since}&fresh=${fresh}`,
```

> The progress URL helper returns a same-origin URL for a browser `EventSource` (matches `API_BASE = './api'`). It is not a `fetchJson` call.

- [ ] **Step 3: Verify** — `cd frontend && npx tsc --noEmit` → no new errors. `npx prettier --check src/types.ts src/api.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(openhop): plugin types + api client methods"
```

### Task 6: Consolidate the OpenHop section into a Policy | Plugins sub-nav

**Files:**
- Create: `frontend/src/components/settings/openhop/OpenHopPolicyPane.tsx`
- Modify: `frontend/src/components/settings/openhop/SettingsOpenHopSection.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`
- Test: `frontend/src/test/openHopSectionSubnav.test.tsx`

- [ ] **Step 1: Move the existing Policy body verbatim.** Create `OpenHopPolicyPane.tsx` containing the current body of `SettingsOpenHopSection` (the policy fetch/reload + engine card + groups + rules + save). Keep the same `Props` (`health`, `appSettings`, `onSaveAppSettings`) and the same JSX; only rename the exported function to `OpenHopPolicyPane`. Do not change its behavior.

- [ ] **Step 2: i18n keys** — add to all three locales (EN shown; provide NL/DE, no em dashes): `openhop_tab_policy` ("Policy"), `openhop_tab_plugins` ("Plugins").

- [ ] **Step 3: Rewrite `SettingsOpenHopSection` as a sub-nav container** — Policy is the default tab so existing behavior/tests are preserved.

```tsx
import { useState } from 'react';
import type { AppSettings, AppSettingsUpdate, HealthStatus } from '../../../types';
import { useT } from '../../../i18n';
import { OpenHopPolicyPane } from './OpenHopPolicyPane';
import { OpenHopPluginsPane } from './plugins/OpenHopPluginsPane';

interface Props {
  health: HealthStatus | null;
  appSettings: AppSettings;
  onSaveAppSettings: (u: AppSettingsUpdate) => Promise<void>;
}

type OpenHopTab = 'policy' | 'plugins';

export function SettingsOpenHopSection(props: Props) {
  const t = useT();
  const isOpenHop = props.health?.radio_device_info?.is_openhop ?? false;
  const [tab, setTab] = useState<OpenHopTab>('policy');
  if (!isOpenHop) return null;

  const tabBtn = (id: OpenHopTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={
        'px-3 py-1 text-xs rounded-md ' +
        (tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')
      }
      aria-pressed={tab === id}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="OpenHop">
        {tabBtn('policy', t('openhop_tab_policy'))}
        {tabBtn('plugins', t('openhop_tab_plugins'))}
      </div>
      {tab === 'policy' ? <OpenHopPolicyPane {...props} /> : <OpenHopPluginsPane health={props.health} />}
    </div>
  );
}
```

- [ ] **Step 4: Failing test** — `frontend/src/test/openHopSectionSubnav.test.tsx`: with an OpenHop health, the Policy tab renders by default (assert the policy engine heading appears via the existing mocked `api.getOpenHopPolicy`), clicking the Plugins tab shows the plugins pane (assert an installed-plugins heading or the not-configured message). Mock `api.getOpenHopPolicy`, `api.listOpenHopPlugins`, `api.getOpenHopStatus`.

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsOpenHopSection } from '../components/settings/openhop/SettingsOpenHopSection';
import { api } from '../api';
import type { AppSettings, HealthStatus } from '../types';

function health(is_openhop: boolean): HealthStatus {
  return {
    status: 'ok', radio_connected: true, radio_initializing: false, connection_info: 'TCP',
    radio_device_info: {
      model: is_openhop ? 'openHop-Repeater-Companion' : 'Heltec V3',
      firmware_build: 'b', firmware_version: '13.0', max_contacts: 510, max_channels: 40,
      is_meshcomod: false, is_openhop,
    }, database_size_mb: 1,
  } as HealthStatus;
}
const settings = { openhop_api_url: 'http://n:8000', openhop_api_token: 't' } as AppSettings;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopPolicy').mockResolvedValue({
    success: true,
    data: {
      policy_file: '/p', exists: false,
      policy_engine: { enabled: false, default_action: 'allow', rules: [],
        objects: { channel_hash_groups: {}, pubkey_groups: {} } },
      groups: { channel_hashes: [], pubkeys: [] },
    },
  });
  vi.spyOn(api, 'listOpenHopPlugins').mockResolvedValue({ success: true, plugins: [] });
});

describe('SettingsOpenHopSection sub-nav', () => {
  it('nothing for non-OpenHop', () => {
    const { container } = render(
      <SettingsOpenHopSection health={health(false)} appSettings={settings} onSaveAppSettings={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it('policy by default, switches to plugins', async () => {
    render(<SettingsOpenHopSection health={health(true)} appSettings={settings} onSaveAppSettings={vi.fn()} />);
    expect(await screen.findByText(/policy engine/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /plugins/i }));
    expect(await screen.findByText(/installed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run** — `cd frontend && npx vitest run src/test/openHopSectionSubnav.test.tsx` → FAIL until Task 7 creates `OpenHopPluginsPane`. Create a minimal stub of `OpenHopPluginsPane` now (renders an "Installed" heading or `openhop_policy_configure_first`) so the container compiles; flesh it out in Task 7. Also run the existing `openHopPolicySection.test.tsx` → must still PASS (Policy is the default tab).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/settings/openhop/OpenHopPolicyPane.tsx frontend/src/components/settings/openhop/SettingsOpenHopSection.tsx frontend/src/components/settings/openhop/plugins/OpenHopPluginsPane.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/openHopSectionSubnav.test.tsx
git commit -m "feat(openhop): consolidate OpenHop settings into Policy | Plugins sub-nav"
```

### Task 7: Plugins pane container (Installed / Catalogue tabs, gating, load)

**Files:**
- Modify: `frontend/src/components/settings/openhop/plugins/OpenHopPluginsPane.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`
- Test: `frontend/src/test/openHopPluginsPane.test.tsx`

- [ ] **Step 1: i18n keys** (all three locales, EN shown): `openhop_plugins_configure_first` ("Configure OpenHop management in Radio settings first."), `openhop_plugins_unavailable` ("Plugin manager unavailable. OpenHop must run under container_supervisor."), `openhop_plugins_tab_installed` ("Installed"), `openhop_plugins_tab_catalogue` ("Catalogue"), `openhop_plugins_load_failed` ("Failed to load plugins."), `openhop_plugins_empty` ("No plugins installed."), `openhop_plugins_refresh` ("Refresh").

- [ ] **Step 2: Failing test** — `openHopPluginsPane.test.tsx`: not-configured (listing throws / returns success:false) shows the configure-first message; a 503-shaped failure shows the unavailable message; a successful empty list shows the Installed tab with the empty message; switching to Catalogue calls `getOpenHopPluginCatalogue`.

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopPluginsPane } from '../components/settings/openhop/plugins/OpenHopPluginsPane';
import { api } from '../api';
import type { HealthStatus } from '../types';

const oh = { radio_device_info: { is_openhop: true } } as unknown as HealthStatus;
beforeEach(() => vi.restoreAllMocks());

describe('OpenHopPluginsPane', () => {
  it('empty installed list', async () => {
    vi.spyOn(api, 'listOpenHopPlugins').mockResolvedValue({ success: true, plugins: [] });
    render(<OpenHopPluginsPane health={oh} />);
    expect(await screen.findByText(/no plugins installed/i)).toBeInTheDocument();
  });
  it('catalogue tab loads catalogue', async () => {
    vi.spyOn(api, 'listOpenHopPlugins').mockResolvedValue({ success: true, plugins: [] });
    const cat = vi.spyOn(api, 'getOpenHopPluginCatalogue').mockResolvedValue({
      success: true, data: { plugins: [] },
    });
    render(<OpenHopPluginsPane health={oh} />);
    await userEvent.click(await screen.findByRole('button', { name: /catalogue/i }));
    expect(cat).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implement** the pane:
  - Gate: `isOpenHop = health?.radio_device_info?.is_openhop ?? false`; if not, `return null`.
  - State: `tab: 'installed' | 'catalogue'` (default installed), `plugins`, `catalogue`, `loading`, `error`, `notConfigured`, `unavailable`.
  - On mount (and a manual Refresh): `api.listOpenHopPlugins()`. On thrown/`success:false`, decide: if the error indicates the proxy 409 (not configured), set `notConfigured`; if the message/looks-like 503 (manager unavailable), set `unavailable` (read `err.message`/status from the `fetchJson` error shape - check how `fetchJson` surfaces non-2xx; it throws with the response text/status). Otherwise `error = t('openhop_plugins_load_failed')`.
  - Lazy-load catalogue when the Catalogue tab is first opened.
  - Render: tab buttons (`openhop_plugins_tab_installed`/`_catalogue`) + Refresh; then either configure-first / unavailable / error message, or `<PluginList .../>` / `<CatalogueList .../>`.
  - Pass down a shared `reload` (re-run list) and an `onOperate(id)` used by cards to open the progress log (Task 11).
  - Use the existing shadcn `Button` and Tailwind classes for the tab row (mirror the Task 6 tabBtn style).

- [ ] **Step 4: Run** — `cd frontend && npx vitest run src/test/openHopPluginsPane.test.tsx` → PASS (with `PluginList`/`CatalogueList` minimal stubs if not yet built; build stubs that render the empty message and accept the props). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/plugins/ frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/openHopPluginsPane.test.tsx
git commit -m "feat(openhop): plugins pane container (installed/catalogue tabs, gating)"
```

### Task 8: Installed list + card (lifecycle, status, expand)

**Files:**
- Create/replace: `frontend/src/components/settings/openhop/plugins/PluginList.tsx`, `PluginCard.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`
- Test: extend `frontend/src/test/openHopPluginsPane.test.tsx`

- [ ] **Step 1: i18n keys** (EN shown): `openhop_plugin_enable`, `openhop_plugin_disable`, `openhop_plugin_start`, `openhop_plugin_stop`, `openhop_plugin_restart`, `openhop_plugin_update`, `openhop_plugin_logs`, `openhop_plugin_settings`, `openhop_plugin_uninstall`, `openhop_plugin_uninstall_confirm` ("Uninstall this plugin?"), `openhop_plugin_uninstall_delete_data` ("Also delete plugin data"), `openhop_plugin_state_running` ("running"), `openhop_plugin_state_stopped` ("stopped"), `openhop_plugin_state_disabled` ("disabled"), `openhop_plugin_update_available` ("update available").

- [ ] **Step 2: Failing test** — with one running plugin, assert name + version + a running badge render and the action buttons appear; clicking Disable calls `api.openHopPluginLifecycle('disable', id)` then triggers reload; clicking Uninstall opens a confirm and, on confirm, calls `api.uninstallOpenHopPlugin(id, false)`.

```tsx
it('lifecycle action calls the api and reloads', async () => {
  const plugin = { id: 'p1', name: 'MQTT Bridge', version: '1.4.2', enabled: true, state: 'running' };
  const list = vi.spyOn(api, 'listOpenHopPlugins')
    .mockResolvedValueOnce({ success: true, plugins: [plugin] })
    .mockResolvedValue({ success: true, plugins: [plugin] });
  const disable = vi.spyOn(api, 'openHopPluginLifecycle').mockResolvedValue({ success: true });
  render(<OpenHopPluginsPane health={oh} />);
  await userEvent.click(await screen.findByRole('button', { name: /disable/i }));
  expect(disable).toHaveBeenCalledWith('disable', 'p1');
  expect(list.mock.calls.length).toBeGreaterThan(1);
});
```

- [ ] **Step 3: Implement**:
  - `PluginList` maps `plugins` to `<PluginCard>`; shows `openhop_plugins_empty` when empty.
  - `PluginCard`: header (name || id, version, a status badge derived from `enabled`/`state`/`running` - render `running`/`stopped`/`disabled`; if `update_available`, a small "update available" pill). Action buttons gated by state: when disabled show Enable; when enabled show Disable + Start/Stop/Restart; always Logs, Settings, Uninstall; show Update when `update_available`. Each action: call the matching `api.*`, then `await onReload()`. Uninstall opens a confirm dialog (reuse the app's confirm/dialog pattern used by the Policy groups delete) offering an "also delete data" checkbox; on confirm call `api.uninstallOpenHopPlugin(id, deleteData)` then reload. Install/update/catalogue actions that stream open the progress log via `onOperate(id)` (wired in Task 11); for Task 8, Update can call `api.updateOpenHopPlugin(id)` then `onOperate(id)`.
  - Expand toggle (chevron) reveals a detail region with Logs / Settings sub-tabs (the child components arrive in Task 9; render a placeholder container that will host them, wired in Task 9).
  - **Live-verify:** confirm the real installed-plugin fields against the sim and map the badge/actions to the actual `enabled`/`state`/`running` values observed.

- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` + `npx prettier --check` on new files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/plugins/PluginList.tsx frontend/src/components/settings/openhop/plugins/PluginCard.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/openHopPluginsPane.test.tsx
git commit -m "feat(openhop): installed plugin list + card lifecycle actions"
```

### Task 9: Logs viewer + settings editor (expanded card sub-tabs)

**Files:**
- Create: `frontend/src/components/settings/openhop/plugins/PluginLogsView.tsx`, `PluginSettingsEditor.tsx`
- Modify: `PluginCard.tsx` (host the Logs / Settings sub-tabs)
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`
- Test: extend `frontend/src/test/openHopPluginsPane.test.tsx`

- [ ] **Step 1: i18n keys** (EN shown): `openhop_plugin_logs_tail` ("Lines"), `openhop_plugin_logs_refresh` ("Refresh"), `openhop_plugin_logs_empty` ("No log output."), `openhop_plugin_settings_save` ("Save"), `openhop_plugin_settings_save_restart` ("Save and restart"), `openhop_plugin_settings_saved` ("Saved."), `openhop_plugin_settings_invalid_json` ("Invalid JSON."), `openhop_plugin_settings_load_failed` ("Failed to load settings.").

- [ ] **Step 2: Failing test** — expanding a card and opening Settings loads config via `api.getOpenHopPluginConfig`; editing to invalid JSON disables Save and shows the invalid message; valid JSON + Save calls `api.setOpenHopPluginConfig(id, parsed, false)`; Save-and-restart passes `restart:true`. Opening Logs calls `api.getOpenHopPluginLogs(id, tail)` and renders the lines.

```tsx
it('settings editor validates and saves', async () => {
  const plugin = { id: 'p1', name: 'MQTT', version: '1', enabled: true, state: 'running' };
  vi.spyOn(api, 'listOpenHopPlugins').mockResolvedValue({ success: true, plugins: [plugin] });
  vi.spyOn(api, 'getOpenHopPluginConfig').mockResolvedValue({ success: true, data: { config: { qos: 0 } } });
  const save = vi.spyOn(api, 'setOpenHopPluginConfig').mockResolvedValue({ success: true });
  render(<OpenHopPluginsPane health={oh} />);
  await userEvent.click(await screen.findByRole('button', { name: /settings/i }));
  const editor = await screen.findByRole('textbox');
  await userEvent.clear(editor);
  await userEvent.type(editor, '{{"qos":1}');
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(save).toHaveBeenCalledWith('p1', { qos: 1 }, false);
});
```

- [ ] **Step 3: Implement**:
  - `PluginLogsView({ id })`: `tail` number input (default 200) + Refresh; fetch `api.getOpenHopPluginLogs`; render `data.lines` joined (or `data.log`) in a `<pre>` monospace block; empty message when none.
  - `PluginSettingsEditor({ id })`: on mount fetch config, `JSON.stringify(config, null, 2)` into a controlled `<textarea>`; on change try `JSON.parse` - on failure set an invalid flag (Save/Save-and-restart disabled + `openhop_plugin_settings_invalid_json`); Save calls `api.setOpenHopPluginConfig(id, parsed, false)`, Save-and-restart passes `true`; show `openhop_plugin_settings_saved` on success.
  - `PluginCard`: the expanded detail region gets a two-item sub-tab (Logs / Settings) mirroring the Task 6 tab button style; render `<PluginLogsView>` / `<PluginSettingsEditor>` for the plugin id.

- [ ] **Step 4: Run** → PASS. tsc + prettier clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/plugins/PluginLogsView.tsx frontend/src/components/settings/openhop/plugins/PluginSettingsEditor.tsx frontend/src/components/settings/openhop/plugins/PluginCard.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/openHopPluginsPane.test.tsx
git commit -m "feat(openhop): plugin logs viewer + JSON settings editor"
```

### Task 10: Catalogue list + card (install)

**Files:**
- Create/replace: `frontend/src/components/settings/openhop/plugins/CatalogueList.tsx`, `CatalogueCard.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`
- Test: extend `frontend/src/test/openHopPluginsPane.test.tsx`

- [ ] **Step 1: i18n keys** (EN shown): `openhop_catalogue_empty` ("Catalogue is empty."), `openhop_catalogue_install` ("Install"), `openhop_catalogue_installed` ("Installed"), `openhop_catalogue_category` ("Category"), `openhop_catalogue_repo` ("Repository"), `openhop_catalogue_refresh` ("Refresh catalogue").

- [ ] **Step 2: Failing test** — a catalogue with one entry renders name/description/version + an Install button; clicking Install calls `api.installOpenHopCataloguePlugin(id)` and then opens the progress log for that id (assert `onOperate`/progress open, e.g. via a spy prop or by asserting `installOpenHopCataloguePlugin` was called; the progress log render is validated in Task 11). An entry with `installed:true` shows an "Installed" state instead of Install.

- [ ] **Step 3: Implement**:
  - `CatalogueList` maps `catalogue` to `<CatalogueCard>`; empty message; a Refresh-catalogue button calling `getOpenHopPluginCatalogue(true)`.
  - `CatalogueCard`: name || id, description, version, optional category/repository line; Install button (hidden/replaced by "Installed" when `entry.installed`). Install: call `api.installOpenHopCataloguePlugin(id, version?)`, then `onOperate(id)` to open the live log (Task 11), then reload the installed list on completion.
  - **Live-verify:** confirm catalogue entry field names against the sim and whether `installed`/`update_available` are present; map rendered fields accordingly.

- [ ] **Step 4: Run** → PASS. tsc + prettier clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/plugins/CatalogueList.tsx frontend/src/components/settings/openhop/plugins/CatalogueCard.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/openHopPluginsPane.test.tsx
git commit -m "feat(openhop): plugin catalogue list + install"
```

### Task 11: Live progress log (EventSource) + wiring install/update

**Files:**
- Create: `frontend/src/components/settings/openhop/plugins/PluginProgressLog.tsx`
- Modify: `OpenHopPluginsPane.tsx` (own the "active operation" id + render the log), `PluginCard.tsx` / `CatalogueCard.tsx` (call `onOperate`)
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`
- Test: extend `frontend/src/test/openHopPluginsPane.test.tsx`

- [ ] **Step 1: i18n keys** (EN shown): `openhop_progress_installing` ("Working..."), `openhop_progress_done` ("Done."), `openhop_progress_error` ("Operation failed."), `openhop_progress_stream_ended` ("Stream ended.").

- [ ] **Step 2: Failing test** — mock `EventSource` (jsdom has none): install a global stub whose instances capture the URL and expose `onmessage`; render the pane, trigger an install, push `connected`/`line`/`done` messages, assert the lines render and the log closes + the installed list reloads on `done`.

```tsx
class MockEventSource {
  static last: MockEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  closed = false;
  constructor(url: string) { this.url = url; MockEventSource.last = this; }
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  close() { this.closed = true; }
}
// beforeEach: vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
```

- [ ] **Step 3: Implement**:
  - `PluginProgressLog({ id, onDone })`: on mount `const es = new EventSource(api.openHopPluginProgressUrl(id))`; accumulate `line` events into state; on `status` show the state; on `done` render the terminal state (`openhop_progress_done`/`_error`), call `es.close()` and `onDone()`; on `onerror` show `openhop_progress_stream_ended`, close, and `onDone()`. Cleanup closes the stream on unmount. Render a monospace log box mirroring the mockup (green-tinted). 
  - `OpenHopPluginsPane`: hold `activeOp: string | null`; `onOperate(id)` sets it; render `<PluginProgressLog id={activeOp} onDone={() => { setActiveOp(null); void reload(); }} />` inline (near the acting card / below the list). Pass `onOperate` down to `PluginCard` (Update) and `CatalogueCard` (Install).
  - **Live-verify ordering:** confirm against the sim whether the install/update POST returns before or after completion; opening the EventSource with `fresh=true` immediately after the POST handles both (an already-finished op yields a quick idle/done; an in-flight op streams). Adjust if the sim shows otherwise.

- [ ] **Step 4: Run** → PASS. tsc + prettier clean. Run the whole `openHopPluginsPane` + `openHopSectionSubnav` + existing `openHopPolicySection` suites → all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/plugins/PluginProgressLog.tsx frontend/src/components/settings/openhop/plugins/OpenHopPluginsPane.tsx frontend/src/components/settings/openhop/plugins/PluginCard.tsx frontend/src/components/settings/openhop/plugins/CatalogueCard.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/openHopPluginsPane.test.tsx
git commit -m "feat(openhop): live SSE progress log for plugin install/update"
```

---

## PHASE C — Gates + runtime verification

### Task 12: Whole-repo quality gate, runtime verification, screenshots

- [ ] **Step 1: Backend suite** — `PYTHONPATH=. uv run pytest tests/ -q`. Expected: `failed`/`errors` unchanged from the pre-existing Windows baseline (14 failed / 32 errors on this branch); `passed` up by the new tests only. Confirm no openhop/migration test is in the failure set.
- [ ] **Step 2: Frontend gates** — `cd frontend`: `npx tsc --noEmit` (0 errors), `npx vitest run` (all pass incl. the i18n EN/NL/DE parity test), `npx prettier --check src/` on touched files (clean), `npx eslint src/components/settings/openhop/` (0 errors, incl. no hardcoded-string violations).
- [ ] **Step 3: Runtime verification against the sim (required; observe, do not infer).** Bring up the sim under `container_supervisor` (needs the plugin manager), build the frontend, run the backend against it:
```bash
MSYS_NO_PATHCONV=1 docker run -d --name openhop-sim -p 5000:5000 -p 8010:8000 \
  -v G:/Github/repositories/openhop-dev/sim/config:/etc/openhop_repeater \
  -v G:/Github/repositories/openhop-dev/sim/data:/var/lib/openhop_repeater \
  --entrypoint python3 openhop-sim:local -m repeater.plugins.container_supervisor --config /etc/openhop_repeater/config.yaml
```
```bash
cd frontend && npx vite build
MESHCORE_TCP_HOST=127.0.0.1 MESHCORE_TCP_PORT=5000 MESHCORE_DATABASE_PATH=G:/Github/repositories/openhop-dev/sim/rtfm-plugins-verify.db PYTHONPATH=. uv run uvicorn app.main:app --port 8020
```
In the browser: configure OpenHop management (Radio settings) so `status.configured` is true, open the OpenHop section → Plugins tab, and confirm against the live node: installed list renders with real fields; a lifecycle action (disable/enable or stop/start) reflects in the status after reload; open Logs (tail renders) and Settings (config round-trips: edit, Save, re-open shows the change); Catalogue tab lists entries; a catalogue install streams a live log and the plugin then appears installed; an update (if any entry offers one) streams. Confirm a non-OpenHop instance shows no OpenHop section at all. Capture screenshots of: Installed tab, an expanded card (Logs + Settings), Catalogue tab, and a live install log. Tear down: `docker rm -f openhop-sim`.
- [ ] **Step 4: Confirm zero-regression for non-OpenHop** by test + the non-OpenHop instance: the OpenHop section is absent from settings when `is_openhop` is false, and the Policy pane still works (default tab) for OpenHop nodes.
- [ ] **Step 5: Update memory** — record the Plugins pane shipped state, the SSE-passthrough pattern (first SSE in the codebase), the consolidated sub-nav, and any live-verified plugin/catalogue field shapes, in `openhop-phase1-shipped` (or a new note) + `MEMORY.md`.

---

## Self-Review

- **Spec coverage:** installed list + status (Tasks 1,3,8); lifecycle enable/disable/start/stop/restart (Tasks 2,3,8); catalogue browse + install (Tasks 1,2,3,7,10); update check + apply (Tasks 1,2,3,8,11); settings read/write JSON editor (Tasks 1,2,3,9); logs tail (Tasks 1,3,9); uninstall + delete-data (Tasks 2,3,8); live SSE progress (Tasks 4,11); detection + configured gating (Tasks 3,6,7); consolidated Policy | Plugins sub-nav (Task 6); manager-unavailable (503) state (Tasks 3,7); i18n EN/NL/DE (every frontend task); runtime verification + zero-regression (Task 12). Wheel-upload correctly excluded per scope. All spec sections map to tasks.
- **Placeholder scan:** backend tasks (1-4) carry complete code and complete tests. Frontend tasks give the component contract, concrete failing tests, exact api calls, i18n keys, and reuse the existing Policy-pane/`OpenHopSettings` JSX patterns for routine markup rather than restating every line - a deliberate scaling choice for a large UI, matching the sibling Policy plan's approach; each task is pinned by a concrete failing test. No "TBD"/"add error handling"/"similar to Task N".
- **Type consistency:** `OpenHopPlugin`, `OpenHopCatalogueEntry`, `OpenHopPluginProgressEvent` defined once (Task 5) and consumed unchanged. Client method names (`list_plugins`, `plugin_status`, `plugin_catalogue`, `plugin_logs`, `get_plugin_config`, `check_plugin_update`, `enable_plugin`/`disable_plugin`/`start_plugin`/`stop_plugin`/`restart_plugin`, `catalogue_install`, `update_plugin`, `set_plugin_config`, `uninstall_plugin`) match between Task 1/2 and the router Tasks 3/4. api method names (`listOpenHopPlugins`, `getOpenHopPluginStatus`, `getOpenHopPluginCatalogue`, `getOpenHopPluginLogs`, `getOpenHopPluginConfig`, `checkOpenHopPluginUpdate`, `openHopPluginLifecycle`, `installOpenHopCataloguePlugin`, `updateOpenHopPlugin`, `setOpenHopPluginConfig`, `uninstallOpenHopPlugin`, `openHopPluginProgressUrl`) match between Task 5 and Tasks 7-11.
- **Known caveats (flagged, not placeholders):** exact installed-plugin/catalogue field names and the install/update sync-vs-async behavior are live-verified in Tasks 8/10/11 (types are permissive so UI reads only rendered fields); `fetchJson`'s non-2xx error shape must be inspected in Task 7 to distinguish 409 (not configured) from 503 (manager unavailable).
```
