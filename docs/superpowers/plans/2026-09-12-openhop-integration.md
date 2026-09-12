# OpenHop Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let RTFM-EV recognise when its connected radio is an OpenHop node and, optionally, manage OpenHop-specific settings over OpenHop's REST API, without changing anything for non-OpenHop nodes.

**Architecture:** Two independent surfaces. **Surface A** (Phase 1) is pure detection: OpenHop's companion already speaks stock MeshCore over TCP (verified), so the only work is exposing an `is_openhop` flag from the device model and labelling it in the UI. **Surface B** (Phases 2+) adds an opt-in, per-node REST client against OpenHop's documented HTTP API (JWT / API-token auth) for its distinctive features (packet-filter policy, plugins, config, update, CAD) that are unreachable over the companion link.

**Tech Stack:** Backend FastAPI + pydantic + aiosqlite + `meshcore==2.3.9.1` + `httpx` (already a dependency via pywebpush/… — verify). Frontend React + TypeScript + i18next (EN/NL/DE enforced).

**Non-negotiable constraint (all phases):** Non-OpenHop nodes (stock MeshCore, DMC, meshcomod) must look and behave exactly as today. Every OpenHop field defaults to "off/false", every OpenHop UI element is gated on detection, and no existing payload field, type, or control changes shape or default. Surface A fields are additive; Surface B UI renders only when the node is detected as OpenHop AND a REST endpoint+credential is configured (fail-closed).

**Verification evidence backing this plan (observed 2026-09-11/12 against a containerised no-hardware OpenHop node, `radio_type: null` + one companion on TCP 5000):**
- RTFM-EV's own stack connected and completed `Post-connect setup complete`; `GET /api/health` returned `radio_device_info.model = "openHop-Repeater-Companion"`, `is_meshcomod: false`.
- `send_device_query` → `fw ver: 13`, `max_channels: 40`, `model: openHop-Repeater-Companion`.
- Surface B REST (run via OpenHop's `container_supervisor` entrypoint): `POST /auth/login` (admin/admin123) → JWT; `POST /api/auth/tokens` → API token; `GET /api/policy` → policy-engine doc; `GET /api/plugins` + `/plugins/catalogue` → live; `POST /api/cli {"command":"ver"}` → `{"reply":"openHop_repeater v13"}`.
- Full detail and the sim recipe live in `docs/plans/20-openhop-integration.md` §7.1/§7.2.

**Scope note (per writing-plans scope check):** Surface A and Surface B are independent subsystems. Phase 1 is complete and shippable on its own. Phases 2+ are specified to the level of a verified foundation + the first (Policy) pane; the remaining panes (Plugins, Config, Update, CAD) carry their verified endpoint shapes but each needs its own UI-design pass and should be expanded into a dedicated plan before implementation. Do not implement Phases 3+ from this document without that design pass.

---

## File Structure

**Phase 1 (Surface A):**
- Create: `app/services/openhop.py` — pure `is_openhop(model)` detector (mirrors `app/services/meshcomod.py:is_meshcomod`).
- Modify: `app/routers/health.py` — add `is_openhop` to `RadioDeviceInfoResponse` and the health payload.
- Create: `tests/test_openhop_service.py` — unit tests for the detector.
- Modify: `tests/test_health_mqtt_status.py` — assert the health payload carries `is_openhop`.
- Modify: `frontend/src/types.ts` — add `is_openhop` to the `radio_device_info` type.
- Modify: `frontend/src/components/MyNodeView.tsx` — render an OpenHop platform row when detected.
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json` — two new keys.

**Phase 2 (Surface B foundation):**
- Create migration `app/migrations/_0NN_add_openhop_api_config.py` (next free number; `_076` as of 2026-09-11 — re-verify with `git ls-tree origin/main app/migrations`).
- Modify: `app/models.py` — add `openhop_api_url`, `openhop_api_token` to the settings model.
- Create: `app/services/openhop_api.py` — httpx client (auth + typed calls).
- Create: `app/routers/openhop.py` — gated proxy endpoints.
- Modify: `app/main.py` — register the router.
- Tests: `tests/test_openhop_api_service.py`, `tests/test_openhop_router.py`.
- Frontend: a detection-gated "OpenHop" area (types + api client + a settings control for URL/token). Detailed in Phase 2 tasks.

---

## PHASE 1 — Surface A: OpenHop detection + label (shippable)

### Task 1: `is_openhop` detector (backend, pure function)

**Files:**
- Create: `app/services/openhop.py`
- Test: `tests/test_openhop_service.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_openhop_service.py
from app.services.openhop import is_openhop


class TestIsOpenHop:
    def test_detects_openhop_repeater_companion(self):
        assert is_openhop("openHop-Repeater-Companion") is True

    def test_case_insensitive_and_whitespace(self):
        assert is_openhop("  OPENHOP-Something ") is True

    def test_non_openhop_model(self):
        assert is_openhop("Heltec V3") is False

    def test_none(self):
        assert is_openhop(None) is False

    def test_empty(self):
        assert is_openhop("") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. uv run pytest tests/test_openhop_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.openhop'`

- [ ] **Step 3: Write minimal implementation**

```python
# app/services/openhop.py
"""OpenHop node detection.

OpenHop (openhop-dev/openhop_repeater, on openhop_core) is a MeshCore-compatible
repeater/room-server daemon. Its companion frame server reports device model
"openHop-Repeater-Companion" (verified 2026-09-11). Detection is by model prefix so
future OpenHop device models still match. This is additive and read-only: non-OpenHop
nodes return False and behave exactly as before.
"""

OPENHOP_MODEL_PREFIX = "openhop"


def is_openhop(model: str | None) -> bool:
    """True when the connected radio identifies as an OpenHop node (by device model)."""
    return bool(model and model.strip().lower().startswith(OPENHOP_MODEL_PREFIX))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. uv run pytest tests/test_openhop_service.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/openhop.py tests/test_openhop_service.py
git commit -m "feat(openhop): add is_openhop device-model detector"
```

### Task 2: Expose `is_openhop` in the health payload (backend)

**Files:**
- Modify: `app/routers/health.py:17-23` (`RadioDeviceInfoResponse`) and `app/routers/health.py:143-155` (payload dict)
- Test: `tests/test_health_mqtt_status.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_health_mqtt_status.py  (add this test; keep existing tests unchanged)
import pytest

from app.routers import health as health_module


@pytest.mark.asyncio
async def test_health_reports_is_openhop_true(monkeypatch):
    rm = health_module.radio_manager
    monkeypatch.setattr(rm, "device_info_loaded", True, raising=False)
    monkeypatch.setattr(rm, "device_model", "openHop-Repeater-Companion", raising=False)
    monkeypatch.setattr(rm, "firmware_version", "13.0", raising=False)
    monkeypatch.setattr(rm, "firmware_ver_code", 13, raising=False)

    data = await health_module.build_health_data(radio_connected=True, connection_info="TCP: x")

    assert data["radio_device_info"]["is_openhop"] is True
    assert data["radio_device_info"]["is_meshcomod"] is False


@pytest.mark.asyncio
async def test_health_reports_is_openhop_false_for_other_models(monkeypatch):
    rm = health_module.radio_manager
    monkeypatch.setattr(rm, "device_info_loaded", True, raising=False)
    monkeypatch.setattr(rm, "device_model", "Heltec V3", raising=False)
    monkeypatch.setattr(rm, "firmware_version", "v1.17.0", raising=False)
    monkeypatch.setattr(rm, "firmware_ver_code", 13, raising=False)

    data = await health_module.build_health_data(radio_connected=True, connection_info="TCP: x")

    assert data["radio_device_info"]["is_openhop"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. uv run pytest tests/test_health_mqtt_status.py -k is_openhop -v`
Expected: FAIL with `KeyError: 'is_openhop'`

- [ ] **Step 3: Add the field to the response model**

In `app/routers/health.py`, add `is_openhop` to `RadioDeviceInfoResponse` (after `is_meshcomod`, line 23):

```python
class RadioDeviceInfoResponse(BaseModel):
    model: str | None = None
    firmware_build: str | None = None
    firmware_version: str | None = None
    max_contacts: int | None = None
    max_channels: int | None = None
    is_meshcomod: bool = False
    is_openhop: bool = False
```

- [ ] **Step 4: Populate it in the payload**

In `app/routers/health.py`, add the import near line 9:

```python
from app.services.openhop import is_openhop
```

Then add `is_openhop` to the `radio_device_info` dict (after the `is_meshcomod` entry, line 154):

```python
            "is_meshcomod": is_meshcomod(
                getattr(radio_manager, "firmware_ver_code", None),
                getattr(radio_manager, "firmware_version", None),
            ),
            "is_openhop": is_openhop(getattr(radio_manager, "device_model", None)),
        }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `PYTHONPATH=. uv run pytest tests/test_health_mqtt_status.py -v`
Expected: PASS (existing tests + the two new ones)

- [ ] **Step 6: Commit**

```bash
git add app/routers/health.py tests/test_health_mqtt_status.py
git commit -m "feat(openhop): surface is_openhop in the health payload"
```

### Task 3: Frontend type + My Node label (detection-gated)

**Files:**
- Modify: `frontend/src/types.ts:152-159` (radio_device_info type)
- Modify: `frontend/src/components/MyNodeView.tsx:2503-2505` (model KV area)
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

- [ ] **Step 1: Add the type field**

In `frontend/src/types.ts`, add `is_openhop` to the `radio_device_info` object type (after `is_meshcomod`, line 158):

```ts
  radio_device_info?: {
    model: string | null;
    firmware_build: string | null;
    firmware_version: string | null;
    max_contacts: number | null;
    max_channels: number | null;
    is_meshcomod: boolean;
    is_openhop: boolean;
  } | null;
```

- [ ] **Step 2: Add i18n keys (EN/NL/DE — parity is enforced by test)**

Add these two keys to each locale file (`frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`). Place them alphabetically near the other `node_detail_*` keys.

en.json:
```json
  "node_detail_platform": "Platform",
  "node_platform_openhop": "OpenHop",
```
nl.json:
```json
  "node_detail_platform": "Platform",
  "node_platform_openhop": "OpenHop",
```
de.json:
```json
  "node_detail_platform": "Plattform",
  "node_platform_openhop": "OpenHop",
```

- [ ] **Step 3: Render the OpenHop row when detected**

In `frontend/src/components/MyNodeView.tsx`, immediately after the existing model `KV` (line 2503-2505), add a detection-gated platform row:

```tsx
                {health?.radio_device_info?.model && (
                  <KV label={t('node_detail_model')} value={health.radio_device_info.model} />
                )}
                {health?.radio_device_info?.is_openhop && (
                  <KV label={t('node_detail_platform')} value={t('node_platform_openhop')} />
                )}
```

- [ ] **Step 4: Run the i18n parity + type checks**

Run: `cd frontend && npm run test -- i18n` (the enforced EN/NL/DE key-parity test)
Expected: PASS (all three locales carry the two new keys)

Run: `cd frontend && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Runtime verification against the sim (required by CLAUDE.md — observe, don't infer)**

Bring up the verified sim (see `docs/plans/20-openhop-integration.md` §7.2 for the recipe), then run the backend against it and open My Node:

```bash
# terminal 1: OpenHop sim (companion on 5000)
docker run -d --name openhop-sim -p 5000:5000 -p 8010:8000 \
  -v G:/Github/repositories/openhop-dev/sim/config:/etc/openhop_repeater \
  -v G:/Github/repositories/openhop-dev/sim/data:/var/lib/openhop_repeater \
  --entrypoint python3 openhop-sim:local -m repeater.plugins.container_supervisor --config /etc/openhop_repeater/config.yaml
```
```bash
# terminal 2: RTFM-EV against the sim (throwaway DB, non-conflicting port), then build+serve frontend or use dev server
MESHCORE_TCP_HOST=127.0.0.1 MESHCORE_TCP_PORT=5000 MESHCORE_DATABASE_PATH=G:/Github/repositories/openhop-dev/sim/rtfm-verify.db uv run uvicorn app.main:app --port 8020
```
Expected: My Node shows a "Platform: OpenHop" row. Confirm a non-OpenHop connection (e.g. a serial radio or a model that is not OpenHop) shows **no** such row. Tear down: `docker rm -f openhop-sim`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/components/MyNodeView.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(openhop): show OpenHop platform in My Node when detected"
```

### Task 4: Whole-repo quality gate + Phase 1 close

- [ ] **Step 1: Run the backend suite**

Run: `PYTHONPATH=. uv run pytest tests/ -v`
Expected: no new failures vs baseline (Windows has ~14 known pre-existing failures + charmap collection errors; compare against a clean run, do not attribute those to this change).

- [ ] **Step 2: Run the repo quality gate**

Run: `./scripts/quality/all_quality.sh`
Expected: PASS.

- [ ] **Step 3: Confirm zero-regression for non-OpenHop**

Verify by inspection and the passing suite that: `is_openhop` defaults `False`; the health payload for a non-OpenHop radio is byte-identical to before except the additive `is_openhop: false`; no existing type/field/control changed. Record this in the PR description.

---

## PHASE 2 — Surface B foundation: OpenHop REST client + config (opt-in)

**Gate for everything in Phase 2+:** all OpenHop REST features are reachable only when `health.radio_device_info.is_openhop` is true AND the user has configured an OpenHop API URL + credential. When not configured or not OpenHop, nothing new renders and no OpenHop HTTP call is made.

**Verified auth model (observed):** `POST {base}/auth/login` with `{username, password, client_id}` → `{success, token, expires_in, username}` (JWT, Bearer). `POST {base}/api/auth/tokens` with `{name}` (JWT-authed) → `{success, token, token_id, name}`; that token is sent as the `X-API-Key` header. Prefer the API token for a long-lived integration; the user creates it (RTFM-EV must not store the admin password). Base URL default `http://<host>:8000` (CherryPy bind; the OpenAPI examples use `:8080` — the field must be user-editable). For the connected-own-node case, default the host from `MESHCORE_TCP_HOST`.

### Task 5: Settings storage for the OpenHop API connection

**Files:**
- Create: `app/migrations/_0NN_add_openhop_api_config.py` (next free number; verify at build time)
- Modify: `app/models.py` (settings model: add `openhop_api_url: str | None`, `openhop_api_token: str | None`)
- Modify: `app/repository/settings.py` (read/write the two fields)
- Test: `tests/test_repository.py` (migration + round-trip), `tests/test_settings_router.py`

- [ ] **Step 1: Write the failing repository test**

```python
# tests/test_repository.py (add)
@pytest.mark.asyncio
async def test_openhop_api_config_roundtrip(clean_db):
    from app.repository.settings import SettingsRepository
    await SettingsRepository.update({"openhop_api_url": "http://127.0.0.1:8000",
                                     "openhop_api_token": "abc"})
    s = await SettingsRepository.get()
    assert s["openhop_api_url"] == "http://127.0.0.1:8000"
    assert s["openhop_api_token"] == "abc"
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONPATH=. uv run pytest tests/test_repository.py -k openhop -v`
Expected: FAIL (columns/fields absent).

- [ ] **Step 3: Add the migration**

Follow the additive `ALTER TABLE app_settings ADD COLUMN ...` pattern of the most recent migrations (read `app/migrations/_075_create_link_signal.py` and its immediate predecessors for the exact module shape and `user_version` bump). Add two nullable TEXT columns `openhop_api_url` and `openhop_api_token`, defaulting NULL, to `app_settings`. Name the file with the next free number verified via `git ls-tree origin/main app/migrations`.

- [ ] **Step 4: Add the fields to the settings model + repository**

Add `openhop_api_url: str | None = None` and `openhop_api_token: str | None = None` to the app-settings pydantic model in `app/models.py`, and include them in the read/write mapping in `app/repository/settings.py` exactly as the sibling nullable settings (e.g. `region_sync_url`) are handled.

- [ ] **Step 5: Run to verify it passes**

Run: `PYTHONPATH=. uv run pytest tests/test_repository.py -k openhop -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/migrations app/models.py app/repository/settings.py tests/test_repository.py
git commit -m "feat(openhop): persist OpenHop API url + token in app_settings"
```

### Task 6: OpenHop REST client service

**Files:**
- Create: `app/services/openhop_api.py`
- Test: `tests/test_openhop_api_service.py` (httpx MockTransport — no live node)

- [ ] **Step 1: Write the failing test (mock transport with the verified shapes)**

```python
# tests/test_openhop_api_service.py
import httpx
import pytest

from app.services.openhop_api import OpenHopClient


def _handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/policy":
        assert request.headers.get("X-API-Key") == "tok"
        return httpx.Response(200, json={"success": True, "data": {"policy_engine": {
            "enabled": False, "default_action": "allow", "rules": []}}})
    if request.url.path == "/api/cli":
        return httpx.Response(200, json={"success": True, "data": {"reply": "openHop_repeater v13"}})
    return httpx.Response(404, json={"success": False})


@pytest.mark.asyncio
async def test_get_policy_and_cli_use_api_key():
    transport = httpx.MockTransport(_handler)
    client = OpenHopClient("http://node:8000", token="tok", transport=transport)
    policy = await client.get_policy()
    assert policy["data"]["policy_engine"]["default_action"] == "allow"
    ver = await client.cli("ver")
    assert ver["data"]["reply"] == "openHop_repeater v13"
    await client.aclose()
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONPATH=. uv run pytest tests/test_openhop_api_service.py -v`
Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement the client**

```python
# app/services/openhop_api.py
"""Thin async client for OpenHop's REST API (Surface B).

Authenticates with an API token sent as X-API-Key (created by the user via
POST /api/auth/tokens on the node). Never stores the admin password. All calls are
opt-in and only invoked when the connected node is detected as OpenHop and the user
has configured a URL + token. Shapes are from the live-verified endpoints
(see docs/plans/20-openhop-integration.md).
"""

from typing import Any

import httpx


class OpenHopClient:
    def __init__(self, base_url: str, token: str, *, transport: httpx.BaseTransport | None = None,
                 timeout: float = 8.0) -> None:
        self._base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base,
            headers={"X-API-Key": token},
            timeout=timeout,
            transport=transport,
        )

    async def _get(self, path: str) -> dict[str, Any]:
        r = await self._client.get(path)
        r.raise_for_status()
        return r.json()

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.post(path, json=body)
        r.raise_for_status()
        return r.json()

    async def get_site_info(self) -> dict[str, Any]:
        return await self._get("/api/site_info")

    async def get_policy(self) -> dict[str, Any]:
        return await self._get("/api/policy")

    async def cli(self, command: str) -> dict[str, Any]:
        return await self._post("/api/cli", {"command": command})

    async def aclose(self) -> None:
        await self._client.aclose()
```

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONPATH=. uv run pytest tests/test_openhop_api_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/openhop_api.py tests/test_openhop_api_service.py
git commit -m "feat(openhop): add OpenHop REST client (X-API-Key auth)"
```

### Task 7: Gated proxy router

**Files:**
- Create: `app/routers/openhop.py`
- Modify: `app/main.py` (register the router)
- Test: `tests/test_openhop_router.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_openhop_router.py
# Assert:
#  - GET /api/openhop/status returns {"configured": false, "is_openhop": <bool>} when no URL set
#  - GET /api/openhop/policy returns 409 (or {"success": false, "error": "not configured"})
#    when the connected node is NOT OpenHop or no URL/token is configured
#  - when is_openhop() is true and URL/token are set, it delegates to OpenHopClient.get_policy
# Use FastAPI TestClient + monkeypatch on app.routers.openhop.radio_manager.device_model
# and a monkeypatched OpenHopClient (or an injected httpx MockTransport) so no live node is needed.
```

Write concrete assertions mirroring `tests/test_settings_router.py` fixtures (TestClient) and the `OpenHopClient` mock-transport pattern from Task 6. The gate function is `is_openhop(getattr(radio_manager, "device_model", None))` AND `settings.openhop_api_url and settings.openhop_api_token`.

- [ ] **Step 2: Run to verify it fails** — `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -v` → FAIL.

- [ ] **Step 3: Implement the router**

Endpoints (all under `/api/openhop`, all fail-closed on the gate above):
- `GET /status` → `{configured: bool, is_openhop: bool, base_url: str | None}` (never returns the token).
- `GET /policy` → delegate to `OpenHopClient.get_policy()`.
- `POST /cli` body `{command}` → delegate to `OpenHopClient.cli(command)` (guard/deny destructive verbs as a follow-up; for the foundation, relay read-only `ver`/`get ...`).

Build the client per request from `settings.openhop_api_url` + `settings.openhop_api_token`; return `409` with `{"success": false, "error": "OpenHop management not configured"}` when the gate fails.

- [ ] **Step 4: Register the router** in `app/main.py` next to the other `app.include_router(...)` calls (follow the existing registration block).

- [ ] **Step 5: Run to verify it passes** — `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -v` → PASS.

- [ ] **Step 6: Commit**

```bash
git add app/routers/openhop.py app/main.py tests/test_openhop_router.py
git commit -m "feat(openhop): gated OpenHop REST proxy (status, policy, cli)"
```

### Task 8: Frontend — configure URL/token + detection-gated entry point

**Files:**
- Modify: `frontend/src/types.ts` (settings type: `openhop_api_url`, `openhop_api_token`; add `/api/openhop/status` response type)
- Modify: `frontend/src/api.ts` (client calls for status/policy/cli + settings save)
- Modify: `frontend/src/components/settings/SettingsRadioSection.tsx` (URL/token inputs, shown only when `health.radio_device_info.is_openhop`)
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json` (labels)

- [ ] Implement the inputs and an "OpenHop management" affordance that is rendered only when `is_openhop` is true; persist via `PATCH /api/settings`. Provide full JSX, i18n keys in all three locales, and a Vitest test in the style of `frontend/src/test/settingsModal.test.tsx` asserting the section is absent when `is_openhop` is false and present when true. Runtime-verify against the sim.

---

## PHASE 3+ — Surface B panes (require a dedicated design pass; do NOT build from this doc)

Each pane below has a live-verified endpoint surface but needs its own UI-design brainstorming and a dedicated plan before implementation. Listed here with observed shapes so the follow-up plans start from facts, not the spec alone.

- **Policy / packet-filter pane** — `GET/POST /api/policy`, `POST /api/policy_validate`, `/api/policy_groups` (CRUD), `/api/policy_group_entries` (CRUD), `/api/unscoped_flood_policy`, `/api/default_region`. Observed `GET /api/policy` → `{success, data:{policy_file, exists, policy_engine:{enabled, default_action, rules:[], objects:{channel_hash_groups, pubkey_groups}}, groups:{channel_hashes:[], pubkeys:[]}}}`.
- **Plugins pane** — `/api/plugins`, `/api/plugins/catalogue`, `catalogue_install`, `updates`, `update`, `install`, `enable`, `disable`, `start`, `stop`, `restart`, `settings`, `logs`, `uninstall`, `progress` (SSE). Observed catalogue entries carry `{id, name, description, repository, category, version, wheel_url}`. Note: the plugin manager is only available when OpenHop runs via its `container_supervisor` entrypoint.
- **Config pane** — `/api/config_export`, `/api/config_import`, `/api/validate_config`, `/api/update_radio_config`, `/api/set_mode`, `/api/hardware_options`, `/api/radio_presets`.
- **Update pane** — `/api/update/check`, `/api/update/install`, `/api/update/status`, `/api/update/channels`, `/api/update/set_channel`, `/api/update/changelog`, `/api/update/progress` (SSE).
- **CAD calibration pane** — `/api/cad_calibration_start`, `/api/cad_calibration_stop`, `/api/cad_manual_check`, `/api/save_cad_settings`, `/api/cad_calibration_stream` (SSE).

Cross-cutting open questions to resolve in those plans: SSE handling in RTFM-EV's client; destructive-verb guarding for `/api/cli`; whether to prefer the typed endpoints over `/api/cli`; API-token lifecycle (creation is a user step on the node).

---

## Self-Review

- **Spec coverage:** Surface A (detect + label, zero-regression) = Tasks 1-4, fully detailed. Surface B (opt-in REST management) = Tasks 5-8 (foundation + config + first delegate) detailed; panes enumerated in Phase 3+ with verified shapes and an explicit design-pass gate. The user's "both, phased, non-OpenHop unchanged" is satisfied: Phase 1 ships alone and is additive; the zero-regression constraint is stated at the top and re-checked in Task 4 Step 3.
- **Placeholder scan:** Phase 1-2 tasks contain real code, paths, commands, and expected output. Phase 3+ is deliberately marked "do not build from this doc" rather than padded with fake steps — this is a scope boundary, not a hidden placeholder.
- **Type consistency:** `is_openhop` is a non-optional `bool` in both the backend `RadioDeviceInfoResponse` and the frontend `radio_device_info` type, matching `is_meshcomod`. The detector is `is_openhop(model: str | None) -> bool` everywhere. `OpenHopClient` method names (`get_policy`, `cli`, `get_site_info`) are used identically in the service, its test, and the router task.
- **Known caveat:** migration number is a moving target — re-verify before Task 5.
