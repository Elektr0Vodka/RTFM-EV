# OpenHop Remaining Management Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six OpenHop REST-management panes (Update/OTA, CAD calibration, System/Hardware, Transport keys + neighbor scopes, MQTT config, and a read-only Analytics section) to RTFM-EV's detection-gated OpenHop settings, completing plan 20's Phase 4 + Phase 5.

**Architecture:** Every pane is an additive REST proxy. The backend adds one typed async method per OpenHop endpoint to `OpenHopClient`, and one gated FastAPI route per method in `app/routers/openhop.py` (JSON via the existing `_relay_upstream`; two new SSE passthroughs cloned from `plugin_progress`). The frontend adds `api.ts` methods + `types.ts` shapes and one self-contained pane component per group, surfaced through a two-row sub-nav. No database migration; the API URL + token already exist (migration `_087`, PR #108). Fail-closed: everything is hidden/409 unless the node is detected as OpenHop and a URL + token are configured.

**Tech Stack:** FastAPI, httpx (async, `X-API-Key` auth, `httpx.MockTransport` for tests), pytest; React + TypeScript, EventSource for SSE, vitest + @testing-library, i18n via `t()` (EN/NL/DE).

---

## Conventions (read once)

- **Auth header:** the OpenHop client authenticates with `X-API-Key: <token>` (NOT bearer). Never log or return the token.
- **Envelopes are mixed** across OpenHop: some endpoints return `{success, data:{...}}`, some return flat `{success, ...}`. Client methods return the raw parsed dict; the frontend reads defensively (optional chaining, fallbacks).
- **Backend tests:** `httpx.MockTransport(handler)` supplied to `OpenHopClient(..., transport=...)`; router tests import the handler function directly, set the model with the `_set_model(monkeypatch, OPENHOP_MODEL)` helper, use the `test_db` fixture, and patch `AppSettingsRepository`.
- **SSE tests:** `monkeypatch.setattr(mod, "_stream_transport", httpx.MockTransport(handler), raising=False)` then call the handler and consume `resp.body_iterator`.
- **Frontend calls** go through the `api` object in `frontend/src/api.ts` and never hit the OpenHop host directly — always `/api/openhop/*`.
- **Run backend tests in the container** per project convention (`docs/agents/run-backend-tests`): pytest via the `rtfm-ev-local` image's `/app/.venv`, worktree bind-mounted to `/work`. Frontend tests run locally with `npm --prefix frontend`.
- **Commits:** the project forbids committing unless the user instructs it. Each task ends with a `git commit` STEP for the executor, but **do not run it unless the user has said to commit**. If commits are disallowed at execution time, stage nothing and just tick the box.
- **i18n:** every new user-facing string needs a key in `frontend/src/i18n/en.ts`, `nl.ts`, `de.ts` (a parity test enforces all three). Reuse existing `openhop_*` keys where present.
- **CI-equivalent before finishing:** backend `ruff check .` + `ruff format --check .`; frontend `npm --prefix frontend run lint` + `format:check` + `test:run` + `build`. See `docs/agents/ci-checks.md`.

---

## File Structure

**Backend (modify):**
- `app/services/openhop_api.py` — add one async method per new endpoint + a `_put` helper.
- `app/routers/openhop.py` — add pydantic request bodies + gated routes + two SSE handlers (`update_progress`, `cad_stream`).
- `tests/test_openhop_api_service.py` — client method tests (MockTransport).
- `tests/test_openhop_router.py` — route + SSE tests.

**Frontend (create):**
- `frontend/src/components/settings/openhop/update/OpenHopUpdatePane.tsx`
- `frontend/src/components/settings/openhop/update/UpdateProgressLog.tsx`
- `frontend/src/components/settings/openhop/cad/OpenHopCadPane.tsx`
- `frontend/src/components/settings/openhop/cad/CadStreamLog.tsx`
- `frontend/src/components/settings/openhop/system/OpenHopSystemPane.tsx`
- `frontend/src/components/settings/openhop/transport/OpenHopTransportPane.tsx`
- `frontend/src/components/settings/openhop/mqtt/OpenHopMqttPane.tsx`
- `frontend/src/test/openHopUpdatePane.test.tsx`, `openHopCadPane.test.tsx`, `openHopSystemPane.test.tsx`, `openHopTransportPane.test.tsx`, `openHopMqttPane.test.tsx`

**Frontend (modify):**
- `frontend/src/api.ts` — proxy methods + SSE URL builders.
- `frontend/src/types.ts` — response/event shapes.
- `frontend/src/components/settings/openhop/SettingsOpenHopSection.tsx` — two-row sub-nav, 8 tabs.
- `frontend/src/test/openHopSectionSubnav.test.tsx` — update for new tabs/rows.
- `frontend/src/i18n/{en,nl,de}.ts` — new keys.

**Docs (modify):** `CHANGELOG-DMC-EV.md`, `README_ADVANCED.md`, `docs/plans/20-openhop-integration.md`, `docs/plans/README.md`.

---

## Phase 0: Sim verification harness (do first — resolves open questions)

### Task 0: Boot the OpenHop sim with REST enabled and capture live shapes

**Files:** none (investigation). Records facts used by later tasks.

- [ ] **Step 1: Write a sim config** to the scratchpad `openhop-sim.yaml` from `config.yaml.example` with `radio_type: null`, one `repeater.companions:` entry (`identity_key` = `openssl rand -hex 32`, `tcp_port: 5000`), and the web server enabled. Determine from `repeater/web/http_server.py` (already extracted) whether REST auto-starts or needs `http start`/a config flag; set the config accordingly.

- [ ] **Step 2: Run the container**, publishing companion 5000 and REST on host port **8010** (host 8000 is taken by the live app):

```bash
docker run --rm -d --name openhop-sim-rest \
  --entrypoint python3 \
  -v "$SCRATCH/openhop-sim.yaml:/cfg.yaml" \
  -p 5000:5000 -p 8010:8000 \
  openhop-sim:local -m repeater.main --config /cfg.yaml
docker logs openhop-sim-rest 2>&1 | tail -30
```

Expected: log shows the companion server on `0.0.0.0:5000` and the CherryPy HTTP server bound. If REST is not listening, record the flag needed and fix the config.

- [ ] **Step 3: Create an API token** on the sim (the client needs `X-API-Key`). Use the sim's default admin creds from `config.yaml.example` to `POST /api/auth/login`, then `POST /api/auth/tokens`; save the token. Record the exact login/token flow.

- [ ] **Step 4: Capture live shapes** for the opaque endpoints and write them to the scratchpad for reference by later tasks:

```bash
TOK=<token>
for p in hardware_stats hardware_processes stats site_info mqtt_status broker_presets \
         transport_keys neighbor_scopes packet_stats packet_type_stats noise_floor_stats; do
  echo "=== /api/$p ==="; curl -s -H "X-API-Key: $TOK" "http://127.0.0.1:8010/api/$p" | head -c 1200; echo
done
curl -s -H "X-API-Key: $TOK" "http://127.0.0.1:8010/api/update/status" | head -c 800; echo
```

Expected: JSON for each. Record whether `hardware_stats` returns real psutil data or the `psutil may not be installed` error path (both are valid rendering cases). Note the envelope (`data`-nested vs flat) per endpoint — this drives the frontend rendering in later tasks.

- [ ] **Step 5: Record findings** in a short note at the top of the plan's "Open questions" section (REST auto-start? psutil present? envelope per endpoint?). No commit.

**TASK 0 FINDINGS (recorded 2026-09-14, live against `openhop-sim:local`, REST on host :8010, token created):**
- REST **auto-starts** by default (`http.enabled` defaults true). Config path for admin login is `repeater.security.admin_password`. Auth flow: `POST /auth/login` `{username:"admin", password, client_id}` → `{token}`; then `POST /api/auth/tokens` `{name}` (Bearer JWT) → `{token}` (the plaintext API key, shown once). API key sent as `X-API-Key`.
- psutil **is present** — `hardware_stats` returns real data. **Nested shape (NOT flat):**
  `data.cpu.{usage_percent,count,frequency,load_avg{1min,5min,15min}}`,
  `data.memory.{total,available,used,usage_percent}`,
  `data.disk.{total,used,free,usage_percent}`,
  `data.network.{bytes_sent,bytes_recv,packets_sent,packets_recv}`,
  `data.system.{uptime,boot_time,os,kernel,...}`.
- `hardware_processes`: `{success, data:{processes:[{pid,name,cpu_percent,memory_percent,memory_mb}], total_processes}}`.
- `stats`: **unwrapped bare object** (no `success`/`data`): `{local_hash, rx_count, forwarded_count, uptime_seconds, noise_floor_dbm, config{...}, ...}`.
- `site_info`: `{success, site_name}` (flat). `mqtt_status`: `{success, data:{handler_active, brokers:[], neighbors:{phase,...}}}`. `broker_presets`: `{success, data:[{id,name,brokers:[...],website}]}`.
- `transport_keys`: `{success, data:[], count}`. `neighbor_scopes`: `{success, data:{}, count, served:{scopes}}`.
- `packet_stats`: `{success, data:{total_packets, avg_rssi, avg_snr, packet_types:[], drop_reasons:[]}}`. `packet_type_stats`: `{success, data:{hours, packet_type_totals:{}, total_packets, period, data_source}}`. `noise_floor_stats`: `{success, data:{stats:{measurement_count, avg_noise_floor, min/max, hours}, hours}}`.
- `update/status`: flat `{success, current_version, latest_version, has_update, channel, last_checked, state, error, rate_limit_until}`. `update/channels`: `{success, channels:[...], current_channel}`. Both match `update_endpoints.py`.
- **Companion frame server (TCP 5000) did NOT start** from the `repeater.companions` config entry (log: "0 companion frame server(s)"). To drive `is_openhop` through RTFM-EV in Task 21, resolve the companions config schema (or connect RTFM-EV differently). REST verification is unaffected.

> The container stays up for live verification in later phases. Stop it at the end (`docker stop openhop-sim-rest`).

---

## Phase 1: Update (OTA) pane

### Task 1: Update client methods

**Files:**
- Modify: `app/services/openhop_api.py`
- Test: `tests/test_openhop_api_service.py`

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.asyncio
async def test_update_methods_use_api_key_and_paths():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[(request.method, request.url.path)] = request.headers.get("X-API-Key")
        p, m = request.url.path, request.method
        if p == "/api/update/status" and m == "GET":
            return httpx.Response(200, json={"success": True, "state": "idle",
                                             "current_version": "1.0.6.dev10", "channel": "main"})
        if p == "/api/update/check" and m == "POST":
            return httpx.Response(200, json={"success": True, "state": "checking"})
        if p == "/api/update/install" and m == "POST":
            return httpx.Response(200, json={"success": True, "state": "installing"})
        if p == "/api/update/channels" and m == "GET":
            return httpx.Response(200, json={"success": True, "channels": ["main", "dev"],
                                             "current_channel": "main"})
        if p == "/api/update/set_channel" and m == "POST":
            return httpx.Response(200, json={"success": True, "channel": "dev"})
        if p == "/api/update/changelog" and m == "GET":
            return httpx.Response(200, json={"success": True, "commits": []})
        return httpx.Response(404, json={"success": False})

    client = OpenHopClient("http://n:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await client.update_status())["state"] == "idle"
    assert (await client.update_check(force=True))["state"] == "checking"
    assert (await client.update_install(force=False))["state"] == "installing"
    assert (await client.update_channels())["channels"] == ["main", "dev"]
    assert (await client.update_set_channel("dev"))["channel"] == "dev"
    assert (await client.update_changelog(channel="main", max_commits=10))["success"] is True
    await client.aclose()
    assert all(v == "tok" for v in seen.values())
```

- [ ] **Step 2: Run to verify it fails**

Run (in container): `pytest tests/test_openhop_api_service.py::test_update_methods_use_api_key_and_paths -v`
Expected: FAIL — `AttributeError: 'OpenHopClient' object has no attribute 'update_status'`.

- [ ] **Step 3: Implement the methods** (append to `OpenHopClient`, after the config methods):

```python
    # --- Update (OTA) ---------------------------------------------------
    async def update_status(self) -> dict[str, Any]:
        return await self._get("/api/update/status")

    async def update_check(self, force: bool = False) -> dict[str, Any]:
        return await self._post("/api/update/check", {"force": force})

    async def update_install(self, force: bool = False) -> dict[str, Any]:
        return await self._post("/api/update/install", {"force": force})

    async def update_channels(self) -> dict[str, Any]:
        return await self._get("/api/update/channels")

    async def update_set_channel(self, channel: str) -> dict[str, Any]:
        return await self._post("/api/update/set_channel", {"channel": channel})

    async def update_changelog(self, channel: str | None = None, max_commits: int = 40) -> dict[str, Any]:
        params: dict[str, Any] = {"max": max_commits}
        if channel:
            params["channel"] = channel
        return await self._get_q("/api/update/changelog", params)
```

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/test_openhop_api_service.py::test_update_methods_use_api_key_and_paths -v`
Expected: PASS.

- [ ] **Step 5: Commit** (only if commits are authorized)

```bash
git add app/services/openhop_api.py tests/test_openhop_api_service.py
git commit -m "feat(openhop): update-client methods for OTA endpoints"
```

### Task 2: Update routes (JSON) + install-confirm semantics

**Files:**
- Modify: `app/routers/openhop.py`
- Test: `tests/test_openhop_router.py`

- [ ] **Step 1: Write the failing tests**

```python
class TestOpenHopUpdate:
    @pytest.mark.asyncio
    async def test_update_status_gated(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")  # not openhop
        from app.routers.openhop import update_status
        with pytest.raises(HTTPException) as ei:
            await update_status()
        assert ei.value.status_code == 409

    @pytest.mark.asyncio
    async def test_update_status_relays(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update({"openhop_api_url": "http://n:8000",
                                            "openhop_api_token": "tok"})

        def handler(request):
            assert request.url.path == "/api/update/status"
            return httpx.Response(200, json={"success": True, "state": "idle"})

        import app.routers.openhop as mod
        import httpx
        with patch.object(mod, "OpenHopClient",
                          lambda url, token: mod.OpenHopClient.__wrapped__ if False else
                          _client_with(handler, url, token)):
            from app.routers.openhop import update_status
            out = await update_status()
        assert out["state"] == "idle"
```

> Use the existing test's client-construction helper if one exists; otherwise add a module-level `_client_with(handler, url, token)` test helper mirroring how `TestOpenHopStatus` builds a client (grep the file for how policy tests inject the transport and copy that exact approach — do not invent a new injection mechanism).

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_openhop_router.py::TestOpenHopUpdate -v`
Expected: FAIL — `ImportError: cannot import name 'update_status'`.

- [ ] **Step 3: Implement the routes** (append to `app/routers/openhop.py`, after the config routes):

```python
# ---------------------------------------------------------------------------
# Update (OTA). JSON routes use _relay_upstream; install/set_channel are POST.
# ---------------------------------------------------------------------------
class UpdateActionBody(BaseModel):
    force: bool = False


class UpdateChannelBody(BaseModel):
    channel: str


@router.get("/update/status")
async def update_status() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.update_status())


@router.post("/update/check")
async def update_check(body: UpdateActionBody) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.update_check(force=body.force))


@router.post("/update/install")
async def update_install(body: UpdateActionBody) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.update_install(force=body.force))


@router.get("/update/channels")
async def update_channels() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.update_channels())


@router.post("/update/set_channel")
async def update_set_channel(body: UpdateChannelBody) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.update_set_channel(body.channel))


@router.get("/update/changelog")
async def update_changelog(channel: str | None = None, max: int = 40) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.update_changelog(channel=channel, max_commits=max))
```

> Note: `install` performs a real pip upgrade + service restart on the node. The route itself does not confirm; the **frontend** gates it behind an explicit confirm (Task 4). Do not add auto-install anywhere.

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/test_openhop_router.py::TestOpenHopUpdate -v`
Expected: PASS.

- [ ] **Step 5: Commit** (if authorized)

```bash
git add app/routers/openhop.py tests/test_openhop_router.py
git commit -m "feat(openhop): update-proxy routes (status/check/install/channels/changelog)"
```

### Task 3: Update progress SSE passthrough

**Files:**
- Modify: `app/routers/openhop.py`
- Test: `tests/test_openhop_router.py`

- [ ] **Step 1: Write the failing test** (mirror `test_progress_relays_upstream_event_stream`):

```python
@pytest.mark.asyncio
async def test_update_progress_relays_stream(self, test_db, monkeypatch):
    import httpx
    import app.routers.openhop as mod
    _set_model(monkeypatch, OPENHOP_MODEL)
    await AppSettingsRepository.update({"openhop_api_url": "http://n:8000",
                                        "openhop_api_token": "tok"})

    def handler(request):
        assert request.url.path == "/api/update/progress"
        return httpx.Response(200, content=b"data: {\"type\": \"line\", \"line\": \"x\"}\n\n",
                              headers={"Content-Type": "text/event-stream"})

    monkeypatch.setattr(mod, "_stream_transport", httpx.MockTransport(handler), raising=False)
    from app.routers.openhop import update_progress
    resp = await update_progress()
    body = b"".join([chunk async for chunk in resp.body_iterator])
    assert b"line" in body
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_openhop_router.py -k update_progress -v`
Expected: FAIL — cannot import `update_progress`.

- [ ] **Step 3: Implement** (append; clone of `plugin_progress`, no query params):

```python
@router.get("/update/progress")
async def update_progress() -> StreamingResponse:
    """Re-stream OpenHop's OTA install progress SSE. Stateless passthrough, fail-closed."""
    settings = await AppSettingsRepository.get()
    if not (_detect_openhop() and settings.openhop_api_url and settings.openhop_api_token):
        raise HTTPException(status_code=409, detail="OpenHop management not configured")
    base = settings.openhop_api_url.rstrip("/")
    token = settings.openhop_api_token

    async def stream():
        timeout = httpx.Timeout(8.0, read=None)
        async with httpx.AsyncClient(
            base_url=base, headers={"X-API-Key": token}, timeout=timeout,
            transport=_stream_transport,
        ) as client:
            try:
                async with client.stream("GET", "/api/update/progress") as resp:
                    async for chunk in resp.aiter_raw():
                        if chunk:
                            yield chunk
            except httpx.HTTPError as exc:
                payload = json.dumps({"type": "done", "state": "error", "error": str(exc)})
                yield f"data: {payload}\n\n".encode()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/test_openhop_router.py -k update_progress -v`
Expected: PASS.

- [ ] **Step 5: Commit** (if authorized)

```bash
git add app/routers/openhop.py tests/test_openhop_router.py
git commit -m "feat(openhop): OTA install-progress SSE passthrough"
```

### Task 4: Frontend api.ts + types.ts for Update

**Files:**
- Modify: `frontend/src/api.ts`, `frontend/src/types.ts`

- [ ] **Step 1: Add types** to `frontend/src/types.ts`:

```typescript
export interface OpenHopUpdateStatus {
  success: boolean;
  current_version?: string;
  latest_version?: string | null;
  has_update?: boolean;
  channel?: string;
  last_checked?: string | null;
  state?: 'idle' | 'checking' | 'installing' | 'complete' | 'error';
  error?: string | null;
  rate_limit_until?: string | null;
  message?: string;
}
export interface OpenHopUpdateChannels {
  success: boolean;
  channels: string[];
  current_channel: string;
}
export interface OpenHopChangelogCommit {
  sha: string; short_sha: string; title: string; body: string;
  author: string; date: string; url: string;
}
export interface OpenHopChangelog {
  success: boolean; channel: string; installed: string; latest: string;
  commits: OpenHopChangelogCommit[];
}
export type OpenHopUpdateEvent =
  | { type: 'connected'; message: string }
  | { type: 'line'; line: string }
  | { type: 'status'; state: string }
  | { type: 'done'; state: string; error?: string | null }
  | { type: 'keepalive' };
```

- [ ] **Step 2: Add api methods** to `frontend/src/api.ts` (follow the existing `getOpenHop*` style and the same fetch/JSON helper the file already uses):

```typescript
  getOpenHopUpdateStatus: (): Promise<OpenHopUpdateStatus> =>
    apiGet('/api/openhop/update/status'),
  openHopUpdateCheck: (force = false): Promise<OpenHopUpdateStatus> =>
    apiPost('/api/openhop/update/check', { force }),
  openHopUpdateInstall: (force = false): Promise<OpenHopUpdateStatus> =>
    apiPost('/api/openhop/update/install', { force }),
  getOpenHopUpdateChannels: (): Promise<OpenHopUpdateChannels> =>
    apiGet('/api/openhop/update/channels'),
  openHopUpdateSetChannel: (channel: string): Promise<OpenHopUpdateStatus> =>
    apiPost('/api/openhop/update/set_channel', { channel }),
  getOpenHopUpdateChangelog: (channel?: string, max = 40): Promise<OpenHopChangelog> =>
    apiGet(`/api/openhop/update/changelog?max=${max}${channel ? `&channel=${encodeURIComponent(channel)}` : ''}`),
  openHopUpdateProgressUrl: (): string => `/api/openhop/update/progress`,
```

> Use whatever the file's real GET/POST helpers are named (grep for `apiGet`/`getOpenHopPolicy`'s implementation and match it exactly, including base-URL handling and imports). Add the new type imports to the top of `api.ts` if it imports types.

- [ ] **Step 3: Typecheck**

Run: `npm --prefix frontend run build`
Expected: no type errors from `api.ts`/`types.ts`.

- [ ] **Step 4: Commit** (if authorized)

```bash
git add frontend/src/api.ts frontend/src/types.ts
git commit -m "feat(openhop): frontend api+types for update pane"
```

### Task 5: Update progress log component (SSE consumer)

**Files:**
- Create: `frontend/src/components/settings/openhop/update/UpdateProgressLog.tsx`

- [ ] **Step 1: Implement** (clone of `PluginProgressLog.tsx`, using the update URL + event type):

```tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../api';
import type { OpenHopUpdateEvent } from '../../../../types';
import { useT } from '../../../../i18n';

interface Props {
  onDone: () => void;
}

/** Streams OpenHop's OTA install progress via EventSource; closes on terminal event. */
export function UpdateProgressLog({ onDone }: Props) {
  const t = useT();
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState('running');
  const [finished, setFinished] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const es = new EventSource(api.openHopUpdateProgressUrl());
    const finish = (next: string) => {
      setState(next);
      setFinished(true);
      es.close();
      doneRef.current();
    };
    es.onmessage = (ev: MessageEvent) => {
      let evt: OpenHopUpdateEvent;
      try {
        evt = JSON.parse(ev.data) as OpenHopUpdateEvent;
      } catch {
        return;
      }
      if (evt.type === 'line') setLines((p) => [...p, evt.line]);
      else if (evt.type === 'status') setState(evt.state);
      else if (evt.type === 'done') finish(evt.state);
    };
    es.onerror = () => finish('stream_ended');
    return () => es.close();
  }, []);

  const label = finished
    ? state === 'complete'
      ? t('openhop_progress_done')
      : t('openhop_progress_error')
    : t('openhop_update_installing');

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 p-2">
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      {lines.length > 0 && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-foreground">
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit** (if authorized) — bundled with Task 6.

### Task 6: Update pane component + test

**Files:**
- Create: `frontend/src/components/settings/openhop/update/OpenHopUpdatePane.tsx`
- Test: `frontend/src/test/openHopUpdatePane.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopUpdatePane } from '../components/settings/openhop/update/OpenHopUpdatePane';
import { api } from '../api';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopUpdateStatus').mockResolvedValue({
    success: true, current_version: '1.0.6.dev10', latest_version: '1.0.6.dev20',
    has_update: true, channel: 'main', state: 'idle',
  });
  vi.spyOn(api, 'getOpenHopUpdateChannels').mockResolvedValue({
    success: true, channels: ['main', 'dev'], current_channel: 'main',
  });
});

describe('OpenHopUpdatePane', () => {
  it('shows version + update-available and requires confirm before install', async () => {
    const install = vi.spyOn(api, 'openHopUpdateInstall').mockResolvedValue({
      success: true, state: 'installing',
    });
    render(<OpenHopUpdatePane />);
    await waitFor(() => expect(screen.getByText(/1\.0\.6\.dev10/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /install/i }));
    // Confirm step: install not called until confirmed
    expect(install).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(install).toHaveBeenCalledWith(false));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test:run -- openHopUpdatePane`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pane**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../../../../api';
import type { OpenHopUpdateStatus, OpenHopUpdateChannels } from '../../../../types';
import { useT } from '../../../../i18n';
import { UpdateProgressLog } from './UpdateProgressLog';

/** OpenHop OTA update pane: version, channel, changelog, confirm-gated install. */
export function OpenHopUpdatePane() {
  const t = useT();
  const [status, setStatus] = useState<OpenHopUpdateStatus | null>(null);
  const [channels, setChannels] = useState<OpenHopUpdateChannels | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setStatus(await api.getOpenHopUpdateStatus());
      setChannels(await api.getOpenHopUpdateChannels());
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const doCheck = async () => {
    setError(null);
    try {
      await api.openHopUpdateCheck(true);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  const doInstall = async () => {
    setConfirming(false);
    setError(null);
    try {
      await api.openHopUpdateInstall(false);
      setInstalling(true);
    } catch (e) {
      setError(String(e));
    }
  };
  const changeChannel = async (ch: string) => {
    setError(null);
    try {
      await api.openHopUpdateSetChannel(ch);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-muted-foreground">{t('openhop_update_installed')}:</span>
          <span className="font-mono">{status?.current_version ?? '—'}</span>
          <span className="text-muted-foreground">{t('openhop_update_latest')}:</span>
          <span className="font-mono">{status?.latest_version ?? '—'}</span>
          {status?.has_update && (
            <span className="rounded bg-primary/20 px-2 py-0.5 text-xs text-primary">
              {t('openhop_update_available')}
            </span>
          )}
        </div>
        {status?.error && <div className="mt-1 text-xs text-destructive">{status.error}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-muted-foreground">{t('openhop_update_channel')}:</label>
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          value={channels?.current_channel ?? ''}
          onChange={(e) => void changeChannel(e.target.value)}
        >
          {(channels?.channels ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-xs"
          onClick={() => void doCheck()}
        >
          {t('openhop_update_check')}
        </button>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
          onClick={() => setConfirming(true)}
        >
          {t('openhop_update_install')}
        </button>
      </div>

      {confirming && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <div className="mb-2 text-xs">{t('openhop_update_confirm_prompt')}</div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-destructive px-3 py-1 text-xs text-destructive-foreground"
              onClick={() => void doInstall()}
            >
              {t('openhop_update_confirm')}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1 text-xs"
              onClick={() => setConfirming(false)}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {installing && <UpdateProgressLog onDone={() => void refresh()} />}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend run test:run -- openHopUpdatePane`
Expected: PASS.

- [ ] **Step 5: Add i18n keys** — add these to `en.ts`, and translated equivalents to `nl.ts` and `de.ts` (reuse existing `cancel`, `openhop_progress_done`, `openhop_progress_error` if present):

```
openhop_tab_update, openhop_update_installed, openhop_update_latest, openhop_update_available,
openhop_update_channel, openhop_update_check, openhop_update_install, openhop_update_installing,
openhop_update_confirm_prompt, openhop_update_confirm
```

- [ ] **Step 6: Commit** (if authorized)

```bash
git add frontend/src/components/settings/openhop/update frontend/src/test/openHopUpdatePane.test.tsx frontend/src/i18n
git commit -m "feat(openhop): OTA update pane (version, channel, changelog, confirm-gated install)"
```

---

## Phase 2: CAD Calibration pane

### Task 7: CAD client methods

**Files:** Modify `app/services/openhop_api.py`; Test `tests/test_openhop_api_service.py`.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_cad_methods():
    def handler(request):
        p, m = request.url.path, request.method
        if p == "/api/cad_calibration_start" and m == "POST":
            return httpx.Response(200, json={"success": True})
        if p == "/api/cad_calibration_stop" and m == "POST":
            return httpx.Response(200, json={"success": True})
        if p == "/api/cad_manual_check" and m == "POST":
            return httpx.Response(200, json={"success": True, "data": {"detected": False,
                                             "detection_rate": 0.0, "attempts": 1}})
        if p == "/api/save_cad_settings" and m == "POST":
            return httpx.Response(200, json={"success": True})
        return httpx.Response(404, json={"success": False})

    c = OpenHopClient("http://n:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await c.cad_start(samples=8, delay=100))["success"]
    assert (await c.cad_stop())["success"]
    assert (await c.cad_manual_check({"samples": 1}))["data"]["attempts"] == 1
    assert (await c.cad_save(peak=127, min_val=64, cad_symbol_num=2))["success"]
    await c.aclose()
```

- [ ] **Step 2: Run — expect FAIL** (`no attribute 'cad_start'`).

Run: `pytest tests/test_openhop_api_service.py::test_cad_methods -v`

- [ ] **Step 3: Implement**

```python
    # --- CAD calibration ------------------------------------------------
    async def cad_start(self, samples: int = 8, delay: int = 100) -> dict[str, Any]:
        return await self._post("/api/cad_calibration_start", {"samples": samples, "delay": delay})

    async def cad_stop(self) -> dict[str, Any]:
        return await self._post("/api/cad_calibration_stop", {})

    async def cad_manual_check(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/cad_manual_check", params)

    async def cad_save(self, peak: int, min_val: int, cad_symbol_num: int = 2) -> dict[str, Any]:
        return await self._post(
            "/api/save_cad_settings",
            {"peak": peak, "min_val": min_val, "cad_symbol_num": cad_symbol_num},
        )
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** (if authorized): `feat(openhop): CAD calibration client methods`.

### Task 8: CAD routes + stream SSE

**Files:** Modify `app/routers/openhop.py`; Test `tests/test_openhop_router.py`.

- [ ] **Step 1: Write the failing tests** (one gating test, one relay test, one SSE test mirroring Task 3's `test_update_progress_relays_stream` but asserting `request.url.path == "/api/cad_calibration_stream"`).

```python
class TestOpenHopCad:
    @pytest.mark.asyncio
    async def test_cad_manual_check_gated(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        from app.routers.openhop import cad_manual_check, CadManualCheckBody
        with pytest.raises(HTTPException) as ei:
            await cad_manual_check(CadManualCheckBody())
        assert ei.value.status_code == 409
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `pytest tests/test_openhop_router.py::TestOpenHopCad -v`

- [ ] **Step 3: Implement routes + SSE**

```python
# ---------------------------------------------------------------------------
# CAD calibration.
# ---------------------------------------------------------------------------
class CadStartBody(BaseModel):
    samples: int = 8
    delay: int = 100


class CadManualCheckBody(BaseModel):
    samples: int | None = None
    det_peak: int | None = None
    det_min: int | None = None
    cad_symbol_num: int | None = None
    cad_timeout_ms: int | None = None
    apply_live: bool | None = None


class CadSaveBody(BaseModel):
    peak: int
    min_val: int
    cad_symbol_num: int = 2


@router.post("/cad/start")
async def cad_start(body: CadStartBody) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.cad_start(samples=body.samples, delay=body.delay))


@router.post("/cad/stop")
async def cad_stop() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.cad_stop())


@router.post("/cad/manual_check")
async def cad_manual_check(body: CadManualCheckBody) -> dict[str, Any]:
    params = {k: v for k, v in body.model_dump().items() if v is not None}
    return await _relay_upstream(lambda c: c.cad_manual_check(params))


@router.post("/cad/save")
async def cad_save(body: CadSaveBody) -> dict[str, Any]:
    return await _relay_upstream(
        lambda c: c.cad_save(peak=body.peak, min_val=body.min_val, cad_symbol_num=body.cad_symbol_num)
    )


@router.get("/cad/stream")
async def cad_stream() -> StreamingResponse:
    """Re-stream OpenHop's CAD calibration SSE. Stateless passthrough, fail-closed."""
    settings = await AppSettingsRepository.get()
    if not (_detect_openhop() and settings.openhop_api_url and settings.openhop_api_token):
        raise HTTPException(status_code=409, detail="OpenHop management not configured")
    base = settings.openhop_api_url.rstrip("/")
    token = settings.openhop_api_token

    async def stream():
        timeout = httpx.Timeout(8.0, read=None)
        async with httpx.AsyncClient(
            base_url=base, headers={"X-API-Key": token}, timeout=timeout,
            transport=_stream_transport,
        ) as client:
            try:
                async with client.stream("GET", "/api/cad_calibration_stream") as resp:
                    async for chunk in resp.aiter_raw():
                        if chunk:
                            yield chunk
            except httpx.HTTPError as exc:
                payload = json.dumps({"type": "done", "state": "error", "error": str(exc)})
                yield f"data: {payload}\n\n".encode()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** (if authorized): `feat(openhop): CAD calibration routes + SSE passthrough`.

### Task 9: CAD frontend (api + types + pane + stream log + test)

**Files:** Modify `frontend/src/api.ts`, `types.ts`; Create `cad/OpenHopCadPane.tsx`, `cad/CadStreamLog.tsx`, `test/openHopCadPane.test.tsx`.

- [ ] **Step 1: Add types** to `types.ts`:

```typescript
export interface OpenHopCadResult {
  success: boolean;
  data?: {
    det_peak?: number; det_min?: number; cad_symbol_num?: number; cad_timeout_ms?: number;
    apply_live?: boolean; samples?: number; attempts?: number; detections?: number;
    non_detections?: number; timeouts?: number; errors?: number; cad_done_count?: number;
    detection_rate?: number; detected?: boolean;
  };
  error?: string;
}
export interface OpenHopCadManualCheckParams {
  samples?: number; det_peak?: number; det_min?: number;
  cad_symbol_num?: number; cad_timeout_ms?: number; apply_live?: boolean;
}
```

- [ ] **Step 2: Add api methods** to `api.ts`:

```typescript
  openHopCadStart: (samples = 8, delay = 100) =>
    apiPost('/api/openhop/cad/start', { samples, delay }),
  openHopCadStop: () => apiPost('/api/openhop/cad/stop', {}),
  openHopCadManualCheck: (p: OpenHopCadManualCheckParams): Promise<OpenHopCadResult> =>
    apiPost('/api/openhop/cad/manual_check', p),
  openHopCadSave: (peak: number, min_val: number, cad_symbol_num = 2) =>
    apiPost('/api/openhop/cad/save', { peak, min_val, cad_symbol_num }),
  openHopCadStreamUrl: (): string => `/api/openhop/cad/stream`,
```

- [ ] **Step 3: Implement `CadStreamLog.tsx`** — a clone of `UpdateProgressLog.tsx` using `api.openHopCadStreamUrl()` and rendering `line` events; terminal on `done`/error. (Same structure as Task 5; use CAD-specific i18n label `openhop_cad_streaming`.)

- [ ] **Step 4: Write the failing pane test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopCadPane } from '../components/settings/openhop/cad/OpenHopCadPane';
import { api } from '../api';

beforeEach(() => vi.restoreAllMocks());

describe('OpenHopCadPane', () => {
  it('runs a manual check and shows detection metrics', async () => {
    vi.spyOn(api, 'openHopCadManualCheck').mockResolvedValue({
      success: true, data: { attempts: 4, detections: 1, detection_rate: 0.25, detected: true },
    });
    render(<OpenHopCadPane />);
    await userEvent.click(screen.getByRole('button', { name: /manual check/i }));
    await waitFor(() => expect(screen.getByText(/25%|0\.25|1 \/ 4/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 5: Run — expect FAIL, then implement the pane** with: a manual-check form (samples, det_peak, det_min, cad_symbol_num select `[1,2,4,8,16]`, cad_timeout_ms, apply_live checkbox) calling `openHopCadManualCheck`; a results block rendering `data.detection_rate`/`detections`/`attempts`/`detected`; a save form (peak, min_val, cad_symbol_num) behind an explicit confirm calling `openHopCadSave`; Start/Stop buttons calling `openHopCadStart`/`openHopCadStop` that mount `<CadStreamLog/>`. Render defensively (all `data` fields optional). Show a one-line note (`openhop_cad_hw_note`) that meaningful metrics require real RF hardware.

- [ ] **Step 6: Run — expect PASS.** `npm --prefix frontend run test:run -- openHopCadPane`

- [ ] **Step 7: Add i18n keys** (`openhop_tab_cad`, `openhop_cad_manual_check`, `openhop_cad_start`, `openhop_cad_stop`, `openhop_cad_save`, `openhop_cad_streaming`, `openhop_cad_hw_note`, `openhop_cad_peak`, `openhop_cad_min`, `openhop_cad_symbols`, `openhop_cad_apply_live`, plus field labels) in en/nl/de.

- [ ] **Step 8: Commit** (if authorized): `feat(openhop): CAD calibration pane`.

---

## Phase 3: System / Hardware pane (+ Analytics section)

### Task 10: System + analytics client methods

**Files:** Modify `app/services/openhop_api.py`; Test `tests/test_openhop_api_service.py`.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_system_and_analytics_methods():
    def handler(request):
        return httpx.Response(200, json={"success": True, "data": {"ok": request.url.path}})
    c = OpenHopClient("http://n:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await c.hardware_stats())["data"]["ok"] == "/api/hardware_stats"
    assert (await c.hardware_processes())["data"]["ok"] == "/api/hardware_processes"
    assert (await c.node_stats())["data"]["ok"] == "/api/stats"
    assert (await c.packet_stats(hours=24))["data"]["ok"] == "/api/packet_stats"
    assert (await c.packet_type_stats(hours=24))["data"]["ok"] == "/api/packet_type_stats"
    assert (await c.noise_floor_stats(hours=24))["data"]["ok"] == "/api/noise_floor_stats"
    await c.aclose()
```

> `get_site_info` already exists — reuse it; do not re-add.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```python
    # --- System / hardware ----------------------------------------------
    async def hardware_stats(self) -> dict[str, Any]:
        return await self._get("/api/hardware_stats")

    async def hardware_processes(self) -> dict[str, Any]:
        return await self._get("/api/hardware_processes")

    async def node_stats(self) -> dict[str, Any]:
        return await self._get("/api/stats")

    # --- Analytics (read-only) ------------------------------------------
    async def packet_stats(self, hours: int = 24) -> dict[str, Any]:
        return await self._get_q("/api/packet_stats", {"hours": hours})

    async def packet_type_stats(self, hours: int = 24) -> dict[str, Any]:
        return await self._get_q("/api/packet_type_stats", {"hours": hours})

    async def noise_floor_stats(self, hours: int = 24) -> dict[str, Any]:
        return await self._get_q("/api/noise_floor_stats", {"hours": hours})
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** (if authorized): `feat(openhop): system + analytics client methods`.

### Task 11: System + analytics routes

**Files:** Modify `app/routers/openhop.py`; Test `tests/test_openhop_router.py`.

- [ ] **Step 1: Write the failing test** (gating + relay for `system_hardware`).

```python
class TestOpenHopSystem:
    @pytest.mark.asyncio
    async def test_hardware_gated(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        from app.routers.openhop import system_hardware
        with pytest.raises(HTTPException) as ei:
            await system_hardware()
        assert ei.value.status_code == 409
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement routes**

```python
# ---------------------------------------------------------------------------
# System / hardware + read-only analytics.
# ---------------------------------------------------------------------------
@router.get("/system/hardware")
async def system_hardware() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.hardware_stats())


@router.get("/system/processes")
async def system_processes() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.hardware_processes())


@router.get("/system/stats")
async def system_stats() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.node_stats())


@router.get("/system/site_info")
async def system_site_info() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.get_site_info())


@router.get("/analytics/packet_stats")
async def analytics_packet_stats(hours: int = 24) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.packet_stats(hours=hours))


@router.get("/analytics/packet_type_stats")
async def analytics_packet_type_stats(hours: int = 24) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.packet_type_stats(hours=hours))


@router.get("/analytics/noise_floor_stats")
async def analytics_noise_floor_stats(hours: int = 24) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.noise_floor_stats(hours=hours))
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** (if authorized): `feat(openhop): system + analytics proxy routes`.

### Task 12: System pane frontend (api + types + pane + test)

**Files:** Modify `api.ts`, `types.ts`; Create `system/OpenHopSystemPane.tsx`, `test/openHopSystemPane.test.tsx`.

- [ ] **Step 1: Add types** (defensive — `hardware_stats` psutil keys vary; keep them optional and index-signature friendly):

```typescript
export interface OpenHopHardwareStats {
  success: boolean;
  data?: Record<string, unknown>;  // psutil keys vary; render known ones defensively
  error?: string;
}
```

- [ ] **Step 2: Add api methods**

```typescript
  getOpenHopHardware: (): Promise<OpenHopHardwareStats> => apiGet('/api/openhop/system/hardware'),
  getOpenHopProcesses: () => apiGet('/api/openhop/system/processes'),
  getOpenHopNodeStats: () => apiGet('/api/openhop/system/stats'),
  getOpenHopSiteInfo: () => apiGet('/api/openhop/system/site_info'),
  getOpenHopPacketStats: (hours = 24) => apiGet(`/api/openhop/analytics/packet_stats?hours=${hours}`),
  getOpenHopPacketTypeStats: (hours = 24) => apiGet(`/api/openhop/analytics/packet_type_stats?hours=${hours}`),
  getOpenHopNoiseFloorStats: (hours = 24) => apiGet(`/api/openhop/analytics/noise_floor_stats?hours=${hours}`),
```

- [ ] **Step 3: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopSystemPane } from '../components/settings/openhop/system/OpenHopSystemPane';
import { api } from '../api';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopHardware').mockResolvedValue({
    success: true,
    data: {
      cpu: { usage_percent: 12.5, count: 4, load_avg: { '1min': 0.5, '5min': 0.4, '15min': 0.3 } },
      memory: { total: 16000000000, used: 6400000000, usage_percent: 40 },
      disk: { total: 1000000000000, free: 450000000000, usage_percent: 55 },
      system: { uptime: 3600, os: 'Debian GNU/Linux 12' },
    },
  });
});

describe('OpenHopSystemPane', () => {
  it('renders hardware stat tiles from the nested live shape', async () => {
    render(<OpenHopSystemPane />);
    await waitFor(() => expect(screen.getByText(/12\.5/)).toBeInTheDocument()); // CPU %
    expect(screen.getByText(/40/)).toBeInTheDocument(); // memory %
    expect(screen.getByText(/55/)).toBeInTheDocument(); // disk %
  });
});
```

- [ ] **Step 4: Run — expect FAIL, then implement the pane.** The pane fetches `getOpenHopHardware` on mount + on an interval (e.g. 5s, cleared on unmount, pausable). Read the **nested** shape confirmed in Task 0: CPU tile = `data.cpu.usage_percent` (+ `data.cpu.load_avg['1min']`), Memory tile = `data.memory.usage_percent` (+ `used`/`total` formatted as bytes), Disk tile = `data.disk.usage_percent` (+ `free`/`total`), Uptime tile = `data.system.uptime` (format seconds → d/h/m). Access each via optional chaining and skip any tile whose value is absent. Handle the psutil-absent path (`success:false` + `error`) by showing the node's message. Include a collapsible "Analytics" `<details>` section that lazy-loads `getOpenHopPacketStats`/`getOpenHopPacketTypeStats`/`getOpenHopNoiseFloorStats` and renders their `data` objects as simple key/value rows (defensive; no chart dependency).

> The `hardware_stats` shape is nested (`data.cpu`, `data.memory`, `data.disk`, `data.system`) — NOT flat — confirmed live in Task 0. Never assume a key exists; optional-chain everything. `getOpenHopNodeStats` (`/stats`) returns an **unwrapped** bare object (no `success`/`data`) — if you surface any of it, read top-level keys directly.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Add i18n keys** (`openhop_tab_system`, `openhop_sys_cpu`, `openhop_sys_memory`, `openhop_sys_disk`, `openhop_sys_uptime`, `openhop_sys_load`, `openhop_sys_temp`, `openhop_sys_analytics`, `openhop_sys_no_psutil`) in en/nl/de.

- [ ] **Step 7: Commit** (if authorized): `feat(openhop): system/hardware pane with analytics section`.

---

## Phase 4: Transport keys + neighbor scopes pane

### Task 13: Transport + scopes client methods

**Files:** Modify `app/services/openhop_api.py` (add `_put` helper); Test `tests/test_openhop_api_service.py`.

- [ ] **Step 1: First read** openapi.yaml lines 1705–1780 (already extracted to scratchpad) to confirm the exact `PUT /transport_key` and `DELETE /transport_key` query params + body. Adjust the method signatures below to match what you read (the `key_id` query param is confirmed; the PUT body shape must be read, not assumed).

- [ ] **Step 2: Write the failing test**

```python
@pytest.mark.asyncio
async def test_transport_and_scope_methods():
    seen = {}

    def handler(request):
        seen[(request.method, request.url.path)] = dict(request.url.params)
        p, m = request.url.path, request.method
        if p == "/api/transport_keys" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": []})
        if p == "/api/transport_keys" and m == "POST":
            return httpx.Response(200, json={"success": True})
        if p == "/api/transport_key" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": {"id": "k1"}})
        if p == "/api/transport_key" and m == "DELETE":
            return httpx.Response(200, json={"success": True})
        if p == "/api/neighbor_scopes" and m == "GET":
            return httpx.Response(200, json={"success": True, "count": 0, "data": {}})
        if p == "/api/query_neighbor_scopes" and m == "POST":
            return httpx.Response(200, json={"success": True, "data": {"status": "timeout"}})
        return httpx.Response(404, json={"success": False})

    c = OpenHopClient("http://n:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await c.transport_keys())["data"] == []
    assert (await c.create_transport_key("home"))["success"]
    assert (await c.transport_key("k1"))["data"]["id"] == "k1"
    assert (await c.delete_transport_key("k1"))["success"]
    assert (await c.neighbor_scopes())["count"] == 0
    assert (await c.query_neighbor_scopes("ab" * 32))["data"]["status"] == "timeout"
    await c.aclose()
    assert seen[("GET", "/api/transport_key")] == {"key_id": "k1"}
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** (add `_put` helper next to `_delete`, then the methods):

```python
    async def _put(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.put(path, json=body)
        r.raise_for_status()
        return r.json()

    # --- Transport keys + neighbor scopes -------------------------------
    async def transport_keys(self) -> dict[str, Any]:
        return await self._get("/api/transport_keys")

    async def create_transport_key(self, name: str) -> dict[str, Any]:
        return await self._post("/api/transport_keys", {"name": name})

    async def transport_key(self, key_id: str) -> dict[str, Any]:
        return await self._get_q("/api/transport_key", {"key_id": key_id})

    async def delete_transport_key(self, key_id: str) -> dict[str, Any]:
        r = await self._client.request("DELETE", "/api/transport_key", params={"key_id": key_id})
        r.raise_for_status()
        return r.json()

    async def neighbor_scopes(self) -> dict[str, Any]:
        return await self._get("/api/neighbor_scopes")

    async def query_neighbor_scopes(self, pubkey: str) -> dict[str, Any]:
        return await self._post("/api/query_neighbor_scopes", {"pubkey": pubkey})
```

> If Step 1 revealed a PUT-update endpoint you intend to expose, add `update_transport_key(self, key_id, body)` using `_put` with the confirmed body; otherwise omit it (YAGNI).

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit** (if authorized): `feat(openhop): transport-key + neighbor-scope client methods`.

### Task 14: Transport + scopes routes

**Files:** Modify `app/routers/openhop.py`; Test `tests/test_openhop_router.py`.

- [ ] **Step 1: Write the failing test** (gating on `transport_keys_list`).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```python
# ---------------------------------------------------------------------------
# Transport keys + neighbor scopes.
# ---------------------------------------------------------------------------
class TransportKeyCreate(BaseModel):
    name: str


class QueryScopeBody(BaseModel):
    pubkey: str


@router.get("/transport/keys")
async def transport_keys_list() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.transport_keys())


@router.post("/transport/keys")
async def transport_key_create(body: TransportKeyCreate) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.create_transport_key(body.name))


@router.get("/transport/key")
async def transport_key_get(key_id: str) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.transport_key(key_id))


@router.delete("/transport/key")
async def transport_key_delete(key_id: str) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.delete_transport_key(key_id))


@router.get("/scopes/neighbors")
async def scopes_neighbors() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.neighbor_scopes())


@router.post("/scopes/query")
async def scopes_query(body: QueryScopeBody) -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.query_neighbor_scopes(body.pubkey))
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** (if authorized): `feat(openhop): transport-key + neighbor-scope proxy routes`.

### Task 15: Transport pane frontend (api + types + pane + test)

**Files:** Modify `api.ts`, `types.ts`; Create `transport/OpenHopTransportPane.tsx`, `test/openHopTransportPane.test.tsx`.

- [ ] **Step 1: Add types**

```typescript
export interface OpenHopNeighborScopeRecord {
  scopes?: string; status?: string; queried_at?: number | null; responded_at?: number | null;
}
export interface OpenHopNeighborScopes {
  success: boolean; count?: number; served?: { scopes?: string };
  data?: Record<string, OpenHopNeighborScopeRecord>; error?: string;
}
```

- [ ] **Step 2: Add api methods**

```typescript
  getOpenHopTransportKeys: () => apiGet('/api/openhop/transport/keys'),
  openHopCreateTransportKey: (name: string) => apiPost('/api/openhop/transport/keys', { name }),
  getOpenHopTransportKey: (key_id: string) =>
    apiGet(`/api/openhop/transport/key?key_id=${encodeURIComponent(key_id)}`),
  openHopDeleteTransportKey: (key_id: string) =>
    apiDelete(`/api/openhop/transport/key?key_id=${encodeURIComponent(key_id)}`),
  getOpenHopNeighborScopes: (): Promise<OpenHopNeighborScopes> => apiGet('/api/openhop/scopes/neighbors'),
  openHopQueryNeighborScopes: (pubkey: string) => apiPost('/api/openhop/scopes/query', { pubkey }),
```

> Use the file's existing DELETE helper name; if none exists, add a small `apiDelete` mirroring `apiGet`/`apiPost`.

- [ ] **Step 3: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopTransportPane } from '../components/settings/openhop/transport/OpenHopTransportPane';
import { api } from '../api';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopTransportKeys').mockResolvedValue({ success: true, data: [{ id: 'k1', name: 'home' }] });
  vi.spyOn(api, 'getOpenHopNeighborScopes').mockResolvedValue({
    success: true, count: 1, served: { scopes: 'nl' },
    data: { ['ab'.repeat(32)]: { scopes: 'nl', status: 'responded' } },
  });
});

describe('OpenHopTransportPane', () => {
  it('lists keys and requires confirm to delete', async () => {
    const del = vi.spyOn(api, 'openHopDeleteTransportKey').mockResolvedValue({ success: true });
    render(<OpenHopTransportPane />);
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('k1'));
  });
});
```

- [ ] **Step 4: Run — expect FAIL, then implement the pane.** Sections: (a) transport keys — list with name + delete (confirm-gated) + a create form (name → `openHopCreateTransportKey` → refresh); (b) neighbor scopes — show `served.scopes`, a table of `data` keyed by pubkey (short pubkey, scopes, status, freshness from `responded_at`), and a query form (64-hex pubkey → `openHopQueryNeighborScopes` → refresh). Render defensively; the list may be `data: []` (array) or `{}` — handle both.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Add i18n keys** (`openhop_tab_transport`, `openhop_tk_title`, `openhop_tk_create`, `openhop_tk_name`, `openhop_tk_delete`, `openhop_scopes_title`, `openhop_scopes_served`, `openhop_scopes_query`, `openhop_scopes_pubkey`, `openhop_scopes_status`) in en/nl/de.

- [ ] **Step 7: Commit** (if authorized): `feat(openhop): transport keys + neighbor scopes pane`.

---

## Phase 5: MQTT config pane

### Task 16: MQTT client methods

**Files:** Modify `app/services/openhop_api.py`; Test `tests/test_openhop_api_service.py`.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_mqtt_methods():
    body_seen = {}

    def handler(request):
        p, m = request.url.path, request.method
        if p == "/api/mqtt_status" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": {"connected": False}})
        if p == "/api/broker_presets" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": []})
        if p == "/api/update_mqtt_config" and m == "POST":
            import json as _j
            body_seen.update(_j.loads(request.content))
            return httpx.Response(200, json={"success": True})
        if p == "/api/publish_neighbors" and m == "POST":
            return httpx.Response(200, json={"success": True})
        return httpx.Response(404, json={"success": False})

    c = OpenHopClient("http://n:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await c.mqtt_status())["data"]["connected"] is False
    assert (await c.broker_presets())["data"] == []
    assert (await c.update_mqtt_config({"owner": "Callsign"}))["success"]
    assert (await c.publish_neighbors())["success"]
    await c.aclose()
    assert body_seen == {"owner": "Callsign"}
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```python
    # --- MQTT config ----------------------------------------------------
    async def mqtt_status(self) -> dict[str, Any]:
        return await self._get("/api/mqtt_status")

    async def broker_presets(self) -> dict[str, Any]:
        return await self._get("/api/broker_presets")

    async def update_mqtt_config(self, config: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/update_mqtt_config", config)

    async def publish_neighbors(self) -> dict[str, Any]:
        return await self._post("/api/publish_neighbors", {})
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** (if authorized): `feat(openhop): MQTT config client methods`.

### Task 17: MQTT routes

**Files:** Modify `app/routers/openhop.py`; Test `tests/test_openhop_router.py`.

- [ ] **Step 1: Write the failing test** (gating on `mqtt_status`).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```python
# ---------------------------------------------------------------------------
# MQTT config. update_mqtt_config accepts a whitelisted partial body upstream;
# we forward whatever the frontend sends (frontend builds the whitelist).
# ---------------------------------------------------------------------------
class MqttConfigBody(BaseModel):
    iata_code: str | None = None
    status_interval: int | None = None
    owner: str | None = None
    email: str | None = None
    neighbors: dict[str, Any] | None = None
    brokers: list[dict[str, Any]] | None = None


@router.get("/mqtt/status")
async def mqtt_status() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.mqtt_status())


@router.get("/mqtt/presets")
async def mqtt_presets() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.broker_presets())


@router.post("/mqtt/config")
async def mqtt_config(body: MqttConfigBody) -> dict[str, Any]:
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    return await _relay_upstream(lambda c: c.update_mqtt_config(payload))


@router.post("/mqtt/publish_neighbors")
async def mqtt_publish_neighbors() -> dict[str, Any]:
    return await _relay_upstream(lambda c: c.publish_neighbors())
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** (if authorized): `feat(openhop): MQTT config proxy routes`.

### Task 18: MQTT pane frontend (api + types + pane + test)

**Files:** Modify `api.ts`, `types.ts`; Create `mqtt/OpenHopMqttPane.tsx`, `test/openHopMqttPane.test.tsx`.

- [ ] **Step 1: Add types**

```typescript
export interface OpenHopMqttConfigBody {
  iata_code?: string; status_interval?: number; owner?: string; email?: string;
  neighbors?: Record<string, unknown>; brokers?: Record<string, unknown>[];
}
```

- [ ] **Step 2: Add api methods**

```typescript
  getOpenHopMqttStatus: () => apiGet('/api/openhop/mqtt/status'),
  getOpenHopMqttPresets: () => apiGet('/api/openhop/mqtt/presets'),
  openHopUpdateMqttConfig: (body: OpenHopMqttConfigBody) => apiPost('/api/openhop/mqtt/config', body),
  openHopPublishNeighbors: () => apiPost('/api/openhop/mqtt/publish_neighbors', {}),
```

- [ ] **Step 3: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopMqttPane } from '../components/settings/openhop/mqtt/OpenHopMqttPane';
import { api } from '../api';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopMqttStatus').mockResolvedValue({ success: true, data: { connected: true } });
  vi.spyOn(api, 'getOpenHopMqttPresets').mockResolvedValue({ success: true, data: [] });
});

describe('OpenHopMqttPane', () => {
  it('saves whitelisted config fields', async () => {
    const save = vi.spyOn(api, 'openHopUpdateMqttConfig').mockResolvedValue({ success: true });
    render(<OpenHopMqttPane />);
    await waitFor(() => expect(screen.getByLabelText(/owner/i)).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/owner/i), 'Callsign');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ owner: 'Callsign' })));
  });
});
```

- [ ] **Step 4: Run — expect FAIL, then implement the pane.** Show `mqtt_status` (connected + any known fields, defensive) and broker presets read-only. A config form with the whitelisted fields (iata_code, status_interval, owner, email) that on save (confirm-gated, since it writes node config) sends only the changed/non-empty fields via `openHopUpdateMqttConfig`. A "Publish neighbours now" button behind an explicit confirm (outward RF action) calling `openHopPublishNeighbors`, with a note that the cycle takes minutes. Broker array editing is out of scope for v1 — render existing brokers read-only.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Add i18n keys** (`openhop_tab_mqtt`, `openhop_mqtt_status`, `openhop_mqtt_presets`, `openhop_mqtt_owner`, `openhop_mqtt_email`, `openhop_mqtt_iata`, `openhop_mqtt_interval`, `openhop_mqtt_save`, `openhop_mqtt_publish`, `openhop_mqtt_publish_note`) in en/nl/de.

- [ ] **Step 7: Commit** (if authorized): `feat(openhop): MQTT config pane`.

---

## Phase 6: Two-row sub-nav, docs, and verification

### Task 19: Two-row sub-nav wiring

**Files:**
- Modify: `frontend/src/components/settings/openhop/SettingsOpenHopSection.tsx`
- Test: `frontend/src/test/openHopSectionSubnav.test.tsx`

- [ ] **Step 1: Update the failing test** — extend `openHopSectionSubnav.test.tsx` to assert all 8 tabs render for an OpenHop node grouped into two labelled rows ("Node" and "Mesh"), each pane mounts when its tab is clicked, and nothing renders for a non-OpenHop node. Add the new `api` spies the mounted panes need (`getOpenHopUpdateStatus`, `getOpenHopUpdateChannels`, `getOpenHopHardware`, `getOpenHopTransportKeys`, `getOpenHopNeighborScopes`, `getOpenHopMqttStatus`, `getOpenHopMqttPresets`) alongside the existing policy/plugins/config spies.

```tsx
it('shows Node and Mesh rows with all eight tabs for OpenHop', async () => {
  render(<SettingsOpenHopSection health={health(true)} appSettings={settings} onSaveAppSettings={vi.fn()} />);
  for (const label of ['Config', 'System', 'Update', 'CAD', 'Policy', 'Plugins', 'Transport', 'MQTT']) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  }
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm --prefix frontend run test:run -- openHopSectionSubnav`

- [ ] **Step 3: Implement** the two-row nav:

```tsx
import { useState } from 'react';
import type { AppSettings, AppSettingsUpdate, HealthStatus } from '../../../types';
import { useT } from '../../../i18n';
import { OpenHopPolicyPane } from './OpenHopPolicyPane';
import { OpenHopPluginsPane } from './plugins/OpenHopPluginsPane';
import { OpenHopConfigPane } from './config/OpenHopConfigPane';
import { OpenHopSystemPane } from './system/OpenHopSystemPane';
import { OpenHopUpdatePane } from './update/OpenHopUpdatePane';
import { OpenHopCadPane } from './cad/OpenHopCadPane';
import { OpenHopTransportPane } from './transport/OpenHopTransportPane';
import { OpenHopMqttPane } from './mqtt/OpenHopMqttPane';

interface Props {
  health: HealthStatus | null;
  appSettings: AppSettings;
  onSaveAppSettings: (u: AppSettingsUpdate) => Promise<void>;
}

type OpenHopTab =
  | 'policy' | 'plugins' | 'config' | 'system' | 'update' | 'cad' | 'transport' | 'mqtt';

const NODE_TABS: OpenHopTab[] = ['config', 'system', 'update', 'cad'];
const MESH_TABS: OpenHopTab[] = ['policy', 'plugins', 'transport', 'mqtt'];

export function SettingsOpenHopSection(props: Props) {
  const t = useT();
  const isOpenHop = props.health?.radio_device_info?.is_openhop ?? false;
  const [tab, setTab] = useState<OpenHopTab>('policy');
  if (!isOpenHop) return null;

  const labels: Record<OpenHopTab, string> = {
    policy: t('openhop_tab_policy'), plugins: t('openhop_tab_plugins'),
    config: t('openhop_tab_config'), system: t('openhop_tab_system'),
    update: t('openhop_tab_update'), cad: t('openhop_tab_cad'),
    transport: t('openhop_tab_transport'), mqtt: t('openhop_tab_mqtt'),
  };

  const tabBtn = (id: OpenHopTab) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={
        'rounded-md px-3 py-1 text-xs ' +
        (tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')
      }
      aria-pressed={tab === id}
    >
      {labels[id]}
    </button>
  );

  const row = (title: string, tabs: OpenHopTab[]) => (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] uppercase text-muted-foreground">{title}</span>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={title}>
        {tabs.map(tabBtn)}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {row(t('openhop_group_node'), NODE_TABS)}
        {row(t('openhop_group_mesh'), MESH_TABS)}
      </div>
      {tab === 'policy' && <OpenHopPolicyPane {...props} />}
      {tab === 'plugins' && <OpenHopPluginsPane health={props.health} />}
      {tab === 'config' && <OpenHopConfigPane health={props.health} />}
      {tab === 'system' && <OpenHopSystemPane />}
      {tab === 'update' && <OpenHopUpdatePane />}
      {tab === 'cad' && <OpenHopCadPane />}
      {tab === 'transport' && <OpenHopTransportPane />}
      {tab === 'mqtt' && <OpenHopMqttPane />}
    </div>
  );
}
```

- [ ] **Step 4: Add i18n keys** `openhop_group_node`, `openhop_group_mesh` in en/nl/de.

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Commit** (if authorized): `feat(openhop): two-row management sub-nav with all panes`.

### Task 20: Docs

**Files:** Modify `CHANGELOG-DMC-EV.md`, `README_ADVANCED.md`, `docs/plans/20-openhop-integration.md`, `docs/plans/README.md`.

- [ ] **Step 1:** Add a `CHANGELOG-DMC-EV.md` entry under the OpenHop area listing the five new panes (Update, CAD, System/Hardware, Transport/scopes, MQTT config) and the two-row sub-nav, referencing this PR.

- [ ] **Step 2:** In `README_ADVANCED.md`, extend the OpenHop management section to list the new panes and what each does; note that Update `install`, MQTT config writes, transport-key delete, and publish-neighbours are confirm-gated, and that CAD needs real RF hardware for meaningful metrics.

- [ ] **Step 3:** In `docs/plans/20-openhop-integration.md`, update the State/Status lines to mark Phase 4 (Update) and Phase 5 (CAD, transport keys/scopes, MQTT config, analytics) delivered, with the verification results from Task 21. Add the row/status to `docs/plans/README.md`'s delivery table.

- [ ] **Step 4: Commit** (if authorized): `docs(openhop): document remaining management panes`.

### Task 21: Full quality gate + live verification

**Files:** none (verification). Produces the evidence required by CLAUDE.md before any "works" claim.

- [ ] **Step 1: Backend CI-equivalent** (in container): `ruff check .` and `ruff format --check .` and `pytest tests/test_openhop_api_service.py tests/test_openhop_router.py -v`. Expected: all pass. Record output.

- [ ] **Step 2: Frontend CI-equivalent:** `npm --prefix frontend run lint`, `format:check`, `test:run`, `build`. Expected: all pass. Record output. (Note: local `format:check` may flag ~200 CRLF-only files from `core.autocrlf`; that is not real drift — verify committed content is LF and CI passes. Run `prettier --write` on the new files and confirm zero git diff.)

- [ ] **Step 2b: i18n parity:** confirm the EN/NL/DE parity test passes (all new keys present in all three). It runs as part of `test:run`; if it fails, add the missing keys.

- [ ] **Step 3: Live read-path verification** against the Task 0 sim (REST on host 8010, valid `X-API-Key`), by pointing a throwaway RTFM-EV backend at the sim's REST and hitting each proxy, OR by driving the panes in a real browser against a backend configured with the sim URL+token. Observe real responses for: `system/hardware` (+ processes/stats/site_info), `mqtt/status` + `mqtt/presets`, `transport/keys`, `scopes/neighbors`, `update/status` + `update/channels` + `update/changelog` (these hit real GitHub), and the analytics reads. Record at least two independent checks (e.g. endpoint JSON + rendered pane).

- [ ] **Step 4: Real-browser** run of the System pane (Richard's ask — confirm CPU/memory/uptime/disk render) and the Update pane (version + channel list + changelog) against the sim. Screenshot both. Send screenshots to the user.

- [ ] **Step 5: Record NOT VERIFIED** explicitly for: CAD functional calibration (no RF hardware), Update `install` (destructive; not triggered), MQTT config write against a broker, and `publish_neighbors` (outward RF). These are covered by unit tests only.

- [ ] **Step 6: Stop the sim:** `docker stop openhop-sim-rest`.

- [ ] **Step 7: Summarize** the evidence (commands run + outputs) for the user. Do not claim "works" for anything in Step 5.

---

## Verification results (Task 21, observed 2026-09-14)

All checks run and observed, not inferred.

- **Backend gate:** `ruff check app/ tests/` clean; `ruff format --check` clean; `uv run pyright`
  on the changed files 0 errors; **full backend suite 2087 passed, 0 failures** (Linux container,
  no Windows env noise); openhop suite 49 passed.
- **Frontend gate:** `npm run lint` 0 errors (4 pre-existing warnings in unrelated files);
  **full suite 1496 tests passed** (183 files) incl. i18n parity; `npm run build` (tsc + vite)
  succeeded; every changed file prettier-clean.
- **Live client vs sim REST:** all 13 new read methods succeeded against the running
  `openhop-sim:local` REST (real responses); nested `hardware_stats` shape confirmed
  (cpu.usage_percent, memory.usage_percent, disk.free, system.uptime).
- **Full gated proxy end-to-end:** ran an RTFM-EV backend connected to the sim companion
  (TCP 5000) with `is_openhop: true`, configured the REST url + token, and every proxy GET
  returned HTTP 200 with real data; the nested hardware shape flowed through intact.
- **Real browser (all six panes):** two-row Node/Mesh sub-nav rendered; System pane showed
  live CPU/Memory/Disk/Uptime tiles (Richard's ask); Update showed installed 1.0.5 + channel
  selector; Transport showed served scopes `*`; MQTT showed live status + config form; CAD
  showed the manual-check + save forms with the RF-hardware note; Policy/Plugins/Config
  (PR #108) still render.
- **Sim companion config gotcha:** companions live under `identities.companions` (not
  `repeater.companions`); the REST server auto-starts (`http.enabled` default true); admin
  login is `POST /auth/login` -> JWT -> `POST /api/auth/tokens`; API key sent as `X-API-Key`.

**NOT VERIFIED (by design):** CAD functional detection metrics (requires real LoRa RF
hardware; the `NullRadio` sim returns no detections), Update `install` (destructive pip
upgrade + service restart; never triggered), MQTT config write against a real broker, and
`publish_neighbors` (outward RF cycle). All four are covered by unit tests only.

## Self-Review notes (author)

- **Spec coverage:** Update (T1–6), CAD (T7–9), System+Analytics (T10–12), Transport+scopes (T13–15), MQTT (T16–18), two-row sub-nav (T19), docs (T20), verification incl. sim boot + CI gates (T0, T21). Safety gating (confirm on install/delete/config-write/publish) is in each pane task. `is_openhop` detection reused, not re-added.
- **Known deferred detail:** transport-key PUT/DELETE exact shapes are read live in T13 Step 1 rather than assumed (flagged, not a placeholder — the concrete `key_id` query param is confirmed; the read only refines an optional update method).
- **Type consistency:** api method names, route paths, and pydantic body classes are consistent across client/router/frontend (e.g. `/api/openhop/update/*`, `OpenHopUpdateStatus`, `UpdateActionBody`). SSE handlers reuse the single module-level `_stream_transport`.
- **Envelope risk:** every frontend render reads `data` defensively because OpenHop envelopes are mixed; Task 0 records the real envelope per endpoint to remove guesswork during frontend tasks.
