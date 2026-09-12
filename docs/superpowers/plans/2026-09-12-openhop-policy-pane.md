# OpenHop Policy Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a detection-gated, top-level "OpenHop" Settings section that lets an operator view and edit a connected OpenHop node's packet-filter policy (engine toggle + default action, named channel-hash/pubkey groups + entries, and individual filter rules).

**Architecture:** Extend the existing fail-closed `/api/openhop` proxy + `OpenHopClient` with typed policy/groups methods (no new router/migration). On the frontend, add a new top-level Settings section rendered only when `is_openhop` AND management is configured; it holds an engine card, a groups manager, and a rule editor with a condition builder. All edits validate-then-save the whole `policy_engine` via `POST /policy`; groups/entries use their dedicated endpoints and refetch.

**Tech Stack:** Backend FastAPI + httpx (`OpenHopClient`). Frontend React + TypeScript + i18next (EN/NL/DE enforced) + Vitest. Verified against the container sim.

**Spec:** `docs/superpowers/specs/2026-09-12-openhop-policy-pane-design.md` (read it; it carries the authoritative rule schema and the resolved decisions).

**Non-negotiable constraint:** Non-OpenHop nodes are unaffected. The section must not appear in the settings nav, command palette, or modal for non-OpenHop nodes, and no existing endpoint/type/control changes shape.

---

## File Structure

**Backend:**
- Modify `app/services/openhop_api.py` — add `update_policy`, `validate_policy`, `list_policy_groups`, `create_policy_group`, `delete_policy_group`, `list_group_entries`, `add_group_entry`, `delete_group_entry`.
- Modify `app/routers/openhop.py` — add the matching gated endpoints under `/api/openhop`.
- Tests: `tests/test_openhop_api_service.py`, `tests/test_openhop_router.py` (extend).

**Frontend:**
- Modify `frontend/src/types.ts` — policy types.
- Modify `frontend/src/api.ts` — client methods.
- Modify `frontend/src/components/settings/settingsConstants.ts` — register the `openhop` section.
- Modify `frontend/src/components/AppShell.tsx` and `frontend/src/components/CommandPalette.tsx` — filter `openhop` out of the nav unless `is_openhop`.
- Modify `frontend/src/components/SettingsModal.tsx` — `expandedSections` init + gated render block + pass health/appSettings/onSaveAppSettings.
- Create `frontend/src/components/settings/openhop/SettingsOpenHopSection.tsx` (fetches policy draft, lays out the three units).
- Create `frontend/src/components/settings/openhop/OpenHopPolicyEngineCard.tsx`.
- Create `frontend/src/components/settings/openhop/OpenHopPolicyGroups.tsx`.
- Create `frontend/src/components/settings/openhop/OpenHopPolicyRules.tsx` (rule list) + `OpenHopRuleForm.tsx` + `OpenHopConditionBuilder.tsx`.
- Modify `frontend/src/i18n/locales/{en,nl,de}.json`.
- Tests: `frontend/src/test/openHopPolicySection.test.tsx`, `openHopConditionBuilder.test.tsx`.

**Rule schema (reference, used throughout):**
```
Action = 'allow' | 'drop' | 'log_only'
Operator = 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'in' | 'starts_with'
Field = 'channel_hash' | 'channel_sender' | 'channel_message_body' | 'channel_decryptable'
      | 'path_hashes' | 'transport_code_0' | 'transport_code_1' | 'payload_hex' | string
Condition = { field: string; op: Operator; value: string }
          | { all: Condition[] } | { any: Condition[] }
Rule = { id: string; name: string; enabled: boolean; if: Condition | Record<string, never>; then: { action: Action } }
PolicyEngine = { enabled: boolean; default_action: Action; rules: Rule[];
                 objects: { channel_hash_groups: Record<string,string[]>; pubkey_groups: Record<string,string[]> } }
```

---

## PHASE A — Backend

### Task 1: OpenHopClient policy + groups methods

**Files:**
- Modify: `app/services/openhop_api.py`
- Test: `tests/test_openhop_api_service.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_openhop_api_service.py`)

```python
@pytest.mark.asyncio
async def test_policy_and_group_methods_use_api_key():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[(request.method, request.url.path)] = request.headers.get("X-API-Key")
        if request.url.path == "/api/policy" and request.method == "POST":
            return httpx.Response(200, json={"success": True})
        if request.url.path == "/api/policy_validate":
            return httpx.Response(200, json={"success": True, "data": {"valid": True}})
        if request.url.path == "/api/policy_groups" and request.method == "GET":
            return httpx.Response(200, json={"success": True, "data": {}})
        if request.url.path == "/api/policy_groups" and request.method == "POST":
            return httpx.Response(200, json={"success": True})
        if request.url.path == "/api/policy_groups" and request.method == "DELETE":
            return httpx.Response(200, json={"success": True})
        if request.url.path == "/api/policy_group_entries" and request.method == "POST":
            return httpx.Response(200, json={"success": True})
        if request.url.path == "/api/policy_group_entries" and request.method == "DELETE":
            return httpx.Response(200, json={"success": True})
        return httpx.Response(404, json={"success": False})

    client = OpenHopClient("http://node:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await client.update_policy({"enabled": True}))["success"] is True
    assert (await client.validate_policy({"enabled": True}))["data"]["valid"] is True
    await client.list_policy_groups()
    await client.create_policy_group("channel_hashes", "g1", friendly_name="G1")
    await client.delete_policy_group("channel_hashes", "g1")
    await client.add_group_entry("channel_hashes", "g1", "0x1f")
    await client.delete_group_entry("channel_hashes", "g1", value="0x1f")
    await client.aclose()
    assert all(v == "tok" for v in seen.values())
```

- [ ] **Step 2: Run to verify it fails** — `PYTHONPATH=. uv run pytest tests/test_openhop_api_service.py -k policy_and_group -v` → FAIL (AttributeError: no `update_policy`).

- [ ] **Step 3: Implement** (add to `OpenHopClient`, alongside `get_policy`; add a `_delete` helper mirroring `_post`)

```python
    async def _delete(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.request("DELETE", path, json=body)
        r.raise_for_status()
        return r.json()

    async def update_policy(self, policy: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/policy", policy)

    async def validate_policy(self, policy: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/policy_validate", policy)

    async def list_policy_groups(self, kind: str | None = None) -> dict[str, Any]:
        return await self._get("/api/policy_groups" + (f"?kind={kind}" if kind else ""))

    async def create_policy_group(self, kind: str, group_id: str, *,
                                  friendly_name: str = "", description: str = "") -> dict[str, Any]:
        return await self._post("/api/policy_groups", {
            "kind": kind, "group_id": group_id,
            "friendly_name": friendly_name, "description": description})

    async def delete_policy_group(self, kind: str, group_id: str) -> dict[str, Any]:
        return await self._delete("/api/policy_groups", {"kind": kind, "group_id": group_id})

    async def add_group_entry(self, kind: str, group_id: str, value: str) -> dict[str, Any]:
        return await self._post("/api/policy_group_entries",
                                {"kind": kind, "group_id": group_id, "value": value})

    async def delete_group_entry(self, kind: str, group_id: str, *,
                                 value: str | None = None, entry_id: str | None = None) -> dict[str, Any]:
        body = {"kind": kind, "group_id": group_id}
        if value is not None:
            body["value"] = value
        if entry_id is not None:
            body["entry_id"] = entry_id
        return await self._delete("/api/policy_group_entries", body)
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS. Also `uv run pyright app/services/openhop_api.py` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/services/openhop_api.py tests/test_openhop_api_service.py
git commit -m "feat(openhop): add policy + group client methods"
```

### Task 2: Router policy endpoints (update, validate)

**Files:**
- Modify: `app/routers/openhop.py`
- Test: `tests/test_openhop_router.py`

- [ ] **Step 1: Write the failing test** (append; reuse the file's `_set_model`, `OPENHOP_MODEL`, `AppSettingsRepository`)

```python
class TestOpenHopPolicyWrite:
    @pytest.mark.asyncio
    async def test_update_policy_409_when_unconfigured(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        from app.routers.openhop import update_policy, PolicyDoc
        with pytest.raises(HTTPException) as exc:
            await update_policy(PolicyDoc(policy={"enabled": True}))
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_update_and_validate_delegate_when_configured(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(openhop_api_url="http://node:8000", openhop_api_token="tok")
        from app.routers.openhop import update_policy, validate_policy, PolicyDoc
        fake = AsyncMock()
        fake.update_policy = AsyncMock(return_value={"success": True})
        fake.validate_policy = AsyncMock(return_value={"success": True, "data": {"valid": True}})
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            assert (await update_policy(PolicyDoc(policy={"enabled": True})))["success"] is True
            assert (await validate_policy(PolicyDoc(policy={"enabled": True})))["data"]["valid"] is True
        fake.update_policy.assert_awaited_once_with({"enabled": True})
        fake.validate_policy.assert_awaited_once()
```

- [ ] **Step 2: Run to verify it fails** — `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -k Policy -v` → FAIL (ImportError update_policy).

- [ ] **Step 3: Implement** (add to `app/routers/openhop.py`)

```python
class PolicyDoc(BaseModel):
    policy: dict[str, Any]


@router.post("/policy")
async def update_policy(body: PolicyDoc) -> dict[str, Any]:
    client = await _require_client()
    try:
        return await client.update_policy(body.policy)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OpenHop API error: {exc}") from exc
    finally:
        await client.aclose()


@router.post("/policy/validate")
async def validate_policy(body: PolicyDoc) -> dict[str, Any]:
    client = await _require_client()
    try:
        return await client.validate_policy(body.policy)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OpenHop API error: {exc}") from exc
    finally:
        await client.aclose()
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/routers/openhop.py tests/test_openhop_router.py
git commit -m "feat(openhop): gated policy update + validate endpoints"
```

### Task 3: Router group + entry endpoints

**Files:**
- Modify: `app/routers/openhop.py`
- Test: `tests/test_openhop_router.py`

- [ ] **Step 1: Write the failing test** (append)

```python
class TestOpenHopPolicyGroups:
    @pytest.mark.asyncio
    async def test_group_and_entry_endpoints_delegate(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(openhop_api_url="http://node:8000", openhop_api_token="tok")
        from app.routers.openhop import (
            list_policy_groups, create_policy_group, delete_policy_group,
            add_group_entry, delete_group_entry, GroupCreate, GroupDelete,
            EntryCreate, EntryDelete)
        fake = AsyncMock()
        for m in ("list_policy_groups", "create_policy_group", "delete_policy_group",
                  "add_group_entry", "delete_group_entry"):
            setattr(fake, m, AsyncMock(return_value={"success": True}))
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            await list_policy_groups(kind=None)
            await create_policy_group(GroupCreate(kind="channel_hashes", group_id="g1", friendly_name="G1"))
            await add_group_entry(EntryCreate(kind="channel_hashes", group_id="g1", value="0x1f"))
            await delete_group_entry(EntryDelete(kind="channel_hashes", group_id="g1", value="0x1f"))
            await delete_policy_group(GroupDelete(kind="channel_hashes", group_id="g1"))
        fake.create_policy_group.assert_awaited_once()
        fake.add_group_entry.assert_awaited_once_with("channel_hashes", "g1", "0x1f")

    @pytest.mark.asyncio
    async def test_group_endpoints_409_unconfigured(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        from app.routers.openhop import list_policy_groups
        with pytest.raises(HTTPException) as exc:
            await list_policy_groups(kind=None)
        assert exc.value.status_code == 409
```

- [ ] **Step 2: Run to verify it fails** — `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -k Groups -v` → FAIL.

- [ ] **Step 3: Implement** (add to `app/routers/openhop.py`; `Literal` import from typing)

```python
Kind = Literal["channel_hashes", "pubkeys"]


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


async def _relay(coro_factory):
    client = await _require_client()
    try:
        return await coro_factory(client)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OpenHop API error: {exc}") from exc
    finally:
        await client.aclose()


@router.get("/policy/groups")
async def list_policy_groups(kind: Kind | None = None) -> dict[str, Any]:
    return await _relay(lambda c: c.list_policy_groups(kind))


@router.post("/policy/groups")
async def create_policy_group(body: GroupCreate) -> dict[str, Any]:
    return await _relay(lambda c: c.create_policy_group(
        body.kind, body.group_id, friendly_name=body.friendly_name, description=body.description))


@router.request("DELETE", "/policy/groups")  # see note
async def delete_policy_group(body: GroupDelete) -> dict[str, Any]:
    return await _relay(lambda c: c.delete_policy_group(body.kind, body.group_id))


@router.post("/policy/groups/entries")
async def add_group_entry(body: EntryCreate) -> dict[str, Any]:
    return await _relay(lambda c: c.add_group_entry(body.kind, body.group_id, body.value))


@router.request("DELETE", "/policy/groups/entries")  # see note
async def delete_group_entry(body: EntryDelete) -> dict[str, Any]:
    return await _relay(lambda c: c.delete_group_entry(
        body.kind, body.group_id, value=body.value, entry_id=body.entry_id))
```

> **Note (DELETE-with-body):** FastAPI's `@router.delete` supports a request body, but to keep it explicit use `@router.delete("/policy/groups")` and `@router.delete("/policy/groups/entries")` with the `body:` param. (`@router.request` is illustrative — replace with `@router.delete(...)`.) When implementing, also refactor Task 2's `update_policy`/`validate_policy` to use the shared `_relay` helper to remove duplication (update their tests remain green).

- [ ] **Step 4: Run to verify it passes** — `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -v` → all PASS. `uv run pyright app/routers/openhop.py` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/routers/openhop.py tests/test_openhop_router.py
git commit -m "feat(openhop): gated policy group + entry endpoints"
```

---

## PHASE B — Frontend types, client, section wiring

### Task 4: Types + api client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add types** (append near `OpenHopStatus` in `types.ts`)

```ts
export type OpenHopAction = 'allow' | 'drop' | 'log_only';
export type OpenHopOperator =
  | 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'in' | 'starts_with';
export type OpenHopGroupKind = 'channel_hashes' | 'pubkeys';

export interface OpenHopSimpleCondition { field: string; op: OpenHopOperator; value: string }
export type OpenHopCondition =
  | OpenHopSimpleCondition
  | { all: OpenHopCondition[] }
  | { any: OpenHopCondition[] }
  | Record<string, never>;

export interface OpenHopRule {
  id: string;
  name: string;
  enabled: boolean;
  if: OpenHopCondition;
  then: { action: OpenHopAction };
}
export interface OpenHopPolicyEngine {
  enabled: boolean;
  default_action: OpenHopAction;
  rules: OpenHopRule[];
  objects: {
    channel_hash_groups: Record<string, string[]>;
    pubkey_groups: Record<string, string[]>;
  };
}
export interface OpenHopPolicyDoc {
  policy_file: string;
  exists: boolean;
  policy_engine: OpenHopPolicyEngine;
  groups: {
    channel_hashes: OpenHopGroup[];
    pubkeys: OpenHopGroup[];
  };
}
export interface OpenHopGroupEntry { id: string; friendly_name: string; value: string }
export interface OpenHopGroup {
  id: string;
  friendly_name: string;
  description: string;
  entries: OpenHopGroupEntry[];
}
/** Loose envelope for validate results ({valid, normalized, effective}) and generic {success} replies. */
export interface OpenHopEnvelope<T = unknown> { success: boolean; data?: T; error?: string }
```

- [ ] **Step 2: Add api methods** (in `api.ts`, after `getOpenHopStatus`; import the new types)

```ts
  getOpenHopPolicy: () => fetchJson<OpenHopEnvelope<OpenHopPolicyDoc>>('/openhop/policy'),
  validateOpenHopPolicy: (policy: OpenHopPolicyEngine) =>
    fetchJson<OpenHopEnvelope<{ valid: boolean; normalized?: unknown; effective?: unknown }>>(
      '/openhop/policy/validate', { method: 'POST', body: JSON.stringify({ policy }) }),
  updateOpenHopPolicy: (policy: OpenHopPolicyEngine) =>
    fetchJson<OpenHopEnvelope>('/openhop/policy', { method: 'POST', body: JSON.stringify({ policy }) }),
  createOpenHopGroup: (kind: OpenHopGroupKind, group_id: string, friendly_name = '', description = '') =>
    fetchJson<OpenHopEnvelope>('/openhop/policy/groups',
      { method: 'POST', body: JSON.stringify({ kind, group_id, friendly_name, description }) }),
  deleteOpenHopGroup: (kind: OpenHopGroupKind, group_id: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/policy/groups',
      { method: 'DELETE', body: JSON.stringify({ kind, group_id }) }),
  addOpenHopGroupEntry: (kind: OpenHopGroupKind, group_id: string, value: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/policy/groups/entries',
      { method: 'POST', body: JSON.stringify({ kind, group_id, value }) }),
  deleteOpenHopGroupEntry: (kind: OpenHopGroupKind, group_id: string, value: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/policy/groups/entries',
      { method: 'DELETE', body: JSON.stringify({ kind, group_id, value }) }),
```

- [ ] **Step 3: Verify** — `cd frontend && npx tsc --noEmit` → no new errors (only the pre-existing set if any). No test yet (covered by component tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(openhop): policy types + api client methods"
```

### Task 5: Register + gate the top-level "OpenHop" settings section

**Files:**
- Modify: `frontend/src/components/settings/settingsConstants.ts`
- Modify: `frontend/src/components/AppShell.tsx:202`
- Modify: `frontend/src/components/CommandPalette.tsx:98`
- Modify: `frontend/src/components/SettingsModal.tsx` (`expandedSections` init ~line 123; render block after the `fanout` section; props)
- Test: `frontend/src/test/openHopPolicySection.test.tsx` (section gating)

- [ ] **Step 1: settingsConstants** — add `'openhop'` to the `SettingsSection` union; insert `'openhop'` into `SETTINGS_SECTION_ORDER` right after `'fanout'`; add `openhop: 'settings_section_openhop'` to `SETTINGS_SECTION_LABEL_KEYS`; add `openhop: ShieldAlert` to `SETTINGS_SECTION_ICONS` and import `ShieldAlert` from `lucide-react`.

- [ ] **Step 2: Gate the nav in AppShell + CommandPalette.** Both map `SETTINGS_SECTION_ORDER`. The section must be filtered out unless the connected node is OpenHop. In each consumer, derive `const isOpenHop = health?.radio_device_info?.is_openhop === true;` (health is already in scope in AppShell; in CommandPalette pass/derive it — read the file to confirm the available prop) and change `SETTINGS_SECTION_ORDER.map(...)` to `SETTINGS_SECTION_ORDER.filter((s) => s !== 'openhop' || isOpenHop).map(...)`. If `health` is not available in a consumer, add it as a prop threaded from the same place that already provides `health` to the settings modal.

- [ ] **Step 3: SettingsModal** — add `openhop: false` to the `expandedSections` initializer object. After the `fanout` section block, add (mirroring the `radio` block, gated additionally on OpenHop + configured):

```tsx
        {isOpenHopConfigured && shouldRenderSection('openhop') && (
          <section className={sectionWrapperClass}>
            {renderSectionHeader('openhop')}
            {isSectionVisible('openhop') && health && appSettings && (
              <div className={sectionContentClass}>
                <SettingsOpenHopSection
                  health={health}
                  appSettings={appSettings}
                  onSaveAppSettings={onSaveAppSettings}
                />
              </div>
            )}
          </section>
        )}
```

Add near the top of the component body:
```tsx
  const isOpenHop = health?.radio_device_info?.is_openhop === true;
  const [openHopConfigured, setOpenHopConfigured] = useState(false);
  useEffect(() => {
    if (!isOpenHop) { setOpenHopConfigured(false); return; }
    let active = true;
    api.getOpenHopStatus().then((s) => { if (active) setOpenHopConfigured(s.configured); }).catch(() => {});
    return () => { active = false; };
  }, [isOpenHop]);
  const isOpenHopConfigured = isOpenHop && openHopConfigured;
```
Import `SettingsOpenHopSection` and `api`.

> **Design note:** gating the *nav item* (AppShell/CommandPalette) on `is_openhop` keeps non-OpenHop users from ever seeing the section. Gating the *content* additionally on `configured` means an OpenHop node that has not yet had its API url/token set still shows the section (so the user can configure it via the existing OpenHop management block in Radio settings), but the policy UI inside can prompt "configure OpenHop management first". Implement that empty-state prompt in Task 6.

- [ ] **Step 4: Failing test** — `frontend/src/test/openHopPolicySection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsOpenHopSection } from '../components/settings/openhop/SettingsOpenHopSection';
import { api } from '../api';
import type { AppSettings, HealthStatus } from '../types';

function health(is_openhop: boolean): HealthStatus {
  return { status: 'ok', radio_connected: true, radio_initializing: false, connection_info: 'TCP',
    radio_device_info: { model: is_openhop ? 'openHop-Repeater-Companion' : 'Heltec V3',
      firmware_build: 'b', firmware_version: '13.0', max_contacts: 510, max_channels: 40,
      is_meshcomod: false, is_openhop }, database_size_mb: 1 } as HealthStatus;
}
const settings = { openhop_api_url: 'http://n:8000', openhop_api_token: 't' } as AppSettings;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopPolicy').mockResolvedValue({ success: true, data: {
    policy_file: '/p', exists: false,
    policy_engine: { enabled: false, default_action: 'allow', rules: [],
      objects: { channel_hash_groups: {}, pubkey_groups: {} } },
    groups: { channel_hashes: [], pubkeys: [] } } });
});

describe('SettingsOpenHopSection', () => {
  it('renders the policy engine heading when OpenHop', async () => {
    render(<SettingsOpenHopSection health={health(true)} appSettings={settings} onSaveAppSettings={vi.fn()} />);
    expect(await screen.findByText(/policy engine/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run to verify it fails** — `cd frontend && npx vitest run src/test/openHopPolicySection.test.tsx` → FAIL (module missing). Component arrives in Task 6.

- [ ] **Step 6: Commit** (after Task 6 makes it green — or commit the wiring now and let Task 6's test flip it green; prefer committing wiring + component together at the end of Task 6). Skip an isolated commit here.

### Task 6: SettingsOpenHopSection scaffold + i18n

**Files:**
- Create: `frontend/src/components/settings/openhop/SettingsOpenHopSection.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`

- [ ] **Step 1: i18n keys** — add to all three locales (values shown for EN; provide NL/DE translations, no em dashes): `settings_section_openhop` ("OpenHop"), `openhop_policy_heading` ("Policy engine"), `openhop_policy_configure_first` ("Configure OpenHop management in Radio settings first."), `openhop_policy_enabled_label` ("Policy engine enabled"), `openhop_policy_default_action` ("Default action"), `openhop_policy_save` ("Save policy"), `openhop_policy_saved` ("Policy saved."), `openhop_policy_invalid` ("Policy is invalid."), `openhop_policy_load_failed` ("Failed to load policy."), `openhop_groups_heading` ("Groups"), `openhop_rules_heading` ("Rules"), plus the group/rule keys used in Tasks 7-10 (add them as those tasks introduce strings; keep EN/NL/DE parity each time).

- [ ] **Step 2: Component** — fetch the policy into a draft; render the three units (engine card, groups, rules) or the configure-first empty state.

```tsx
import { useEffect, useState } from 'react';
import { api } from '../../../api';
import type { AppSettings, HealthStatus, OpenHopPolicyDoc, OpenHopPolicyEngine } from '../../../types';
import { useT } from '../../../i18n';
import { OpenHopPolicyEngineCard } from './OpenHopPolicyEngineCard';
import { OpenHopPolicyGroups } from './OpenHopPolicyGroups';
import { OpenHopPolicyRules } from './OpenHopPolicyRules';

interface Props {
  health: HealthStatus | null;
  appSettings: AppSettings;
  onSaveAppSettings: (u: import('../../../types').AppSettingsUpdate) => Promise<void>;
}

export function SettingsOpenHopSection({ health }: Props) {
  const t = useT();
  const isOpenHop = health?.radio_device_info?.is_openhop ?? false;
  const [doc, setDoc] = useState<OpenHopPolicyDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const reload = async () => {
    setError(null);
    try {
      const res = await api.getOpenHopPolicy();
      if (res.success && res.data) { setDoc(res.data); setNotConfigured(false); }
      else { setNotConfigured(true); }
    } catch {
      setNotConfigured(true);
    }
  };
  useEffect(() => { if (isOpenHop) void reload(); }, [isOpenHop]);

  if (!isOpenHop) return null;
  if (notConfigured) return <p className="text-xs text-muted-foreground">{t('openhop_policy_configure_first')}</p>;
  if (!doc) return <p className="text-xs text-muted-foreground">{t('openhop_policy_heading')}</p>;

  const engine = doc.policy_engine;
  const setEngine = (next: OpenHopPolicyEngine) => setDoc({ ...doc, policy_engine: next });

  return (
    <div className="space-y-6">
      <OpenHopPolicyEngineCard engine={engine} onChange={setEngine} onSaved={reload} setError={setError} />
      <OpenHopPolicyGroups doc={doc} onChanged={reload} setError={setError} />
      <OpenHopPolicyRules engine={engine} onChange={setEngine} onSaved={reload} setError={setError} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Run the section test** — `cd frontend && npx vitest run src/test/openHopPolicySection.test.tsx` → PASS once Tasks 7-9 stub the three child components (create minimal stubs first if needed so the import resolves, then flesh out). Also `npx tsc --noEmit` clean.

- [ ] **Step 4: Commit** (Task 5 wiring + Task 6 scaffold + child stubs)

```bash
git add frontend/src/components/settings/settingsConstants.ts frontend/src/components/AppShell.tsx frontend/src/components/CommandPalette.tsx frontend/src/components/SettingsModal.tsx frontend/src/components/settings/openhop/ frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/openHopPolicySection.test.tsx
git commit -m "feat(openhop): top-level OpenHop settings section (gated) + policy scaffold"
```

### Task 7: Engine card (enable + default_action, validate-then-save)

**Files:**
- Create: `frontend/src/components/settings/openhop/OpenHopPolicyEngineCard.tsx`
- Test: extend `frontend/src/test/openHopPolicySection.test.tsx`

- [ ] **Step 1: Failing test** — assert that toggling enabled + clicking save calls `validateOpenHopPolicy` then `updateOpenHopPolicy` with `enabled:true`; and that an invalid validate result blocks the update and shows the error.

```tsx
it('validates then saves the engine', async () => {
  const validate = vi.spyOn(api, 'validateOpenHopPolicy').mockResolvedValue({ success: true, data: { valid: true } });
  const update = vi.spyOn(api, 'updateOpenHopPolicy').mockResolvedValue({ success: true });
  render(<SettingsOpenHopSection health={health(true)} appSettings={settings} onSaveAppSettings={vi.fn()} />);
  const toggle = await screen.findByLabelText(/policy engine enabled/i);
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole('button', { name: /save policy/i }));
  await waitFor(() => expect(validate).toHaveBeenCalled());
  await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ enabled: true })));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the card: a `Checkbox` bound to `engine.enabled` (calls `onChange({...engine, enabled})`), a segmented/`select` for `default_action` over `['allow','drop','log_only']`, and a Save button whose handler is:

```tsx
const save = async () => {
  setError(null);
  const v = await api.validateOpenHopPolicy(engine);
  if (!v.success || !v.data?.valid) { setError(t('openhop_policy_invalid')); return; }
  const r = await api.updateOpenHopPolicy(engine);
  if (!r.success) { setError(r.error ?? t('openhop_policy_invalid')); return; }
  await onSaved();
};
```
Use the existing `Checkbox`, `Label`, `Button`, `Segmented`/`select` primitives (see `MeshcomodSettings.tsx` and `frontend/src/components/ui/`). Full JSX mirrors `OpenHopSettings.tsx` layout. Label the toggle with `t('openhop_policy_enabled_label')` via `htmlFor`.

- [ ] **Step 4: Run → PASS.** `npx tsc --noEmit` clean; `npx prettier --check` on the new file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/OpenHopPolicyEngineCard.tsx frontend/src/test/openHopPolicySection.test.tsx
git commit -m "feat(openhop): policy engine card (validate-then-save)"
```

### Task 8: Groups manager

**Files:**
- Create: `frontend/src/components/settings/openhop/OpenHopPolicyGroups.tsx`
- Test: extend `frontend/src/test/openHopPolicySection.test.tsx`

- [ ] **Step 1: Failing test** — with a doc that has one channel_hashes group, assert the group + its entries render; creating a group calls `createOpenHopGroup(kind, id, ...)` then reloads; deleting an entry calls `deleteOpenHopGroupEntry`. Mock the api methods and `onChanged`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — two subsections (channel_hashes, pubkeys) reading `doc.groups.channel_hashes` / `doc.groups.pubkeys`. Each: list groups (friendly_name + id), per group list entries (value) with a remove (X) button, an "add entry" input, and a group-level delete. A "new group" row (id + friendly_name + create). Every mutating action calls the matching `api.*` method, then `await onChanged()` (which refetches the whole doc in the parent). Delete actions use a confirm dialog (reuse the app's dialog pattern). Surface server errors via `setError`. i18n keys: `openhop_group_new`, `openhop_group_id`, `openhop_group_name`, `openhop_group_add_entry`, `openhop_group_delete`, `openhop_entry_add`, `openhop_entry_value_hint` ("channel hash: one byte, e.g. 0x1f") in EN/NL/DE.

- [ ] **Step 4: Run → PASS.** tsc + prettier clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/OpenHopPolicyGroups.tsx frontend/src/test/openHopPolicySection.test.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(openhop): policy groups + entries manager"
```

### Task 9: Rule list (add/enable/delete/reorder)

**Files:**
- Create: `frontend/src/components/settings/openhop/OpenHopPolicyRules.tsx`
- Test: extend `frontend/src/test/openHopPolicySection.test.tsx`

- [ ] **Step 1: Failing test** — with an engine holding one rule, assert it renders (name + action + a summary of `if`); "Add rule" appends a rule and opens the form (Task 10); the up/down buttons reorder `engine.rules`; delete removes it; enable checkbox flips `rule.enabled`; each mutation calls `onChange` with the updated engine; Save triggers validate-then-update (same handler as Task 7 - extract a shared `savePolicy(engine)` helper into a small module `openhop/savePolicy.ts` and use it in both cards).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — a list over `engine.rules`. Each row: enable `Checkbox` (updates `rules[i].enabled`), name, an action badge, a one-line `if` summary via a pure `summarizeCondition(cond)` helper (in the same file; handles simple/all/any), up/down buttons (swap adjacent), Edit (opens `OpenHopRuleForm` for that rule), Delete (confirm). "Add rule" appends `{ id: crypto.randomUUID(), name: '', enabled: true, if: {}, then: { action: 'drop' } }` and opens the form. A "Save policy" button runs the shared `savePolicy(engine, { setError, onSaved, t })`. New id generation and reordering are pure array ops on a cloned `engine.rules`.

- [ ] **Step 4: Run → PASS.** tsc + prettier clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/OpenHopPolicyRules.tsx frontend/src/components/settings/openhop/savePolicy.ts frontend/src/components/settings/openhop/OpenHopPolicyEngineCard.tsx frontend/src/test/openHopPolicySection.test.tsx
git commit -m "feat(openhop): policy rule list (add/enable/delete/reorder)"
```

### Task 10: Rule form + condition builder

**Files:**
- Create: `frontend/src/components/settings/openhop/OpenHopRuleForm.tsx`
- Create: `frontend/src/components/settings/openhop/OpenHopConditionBuilder.tsx`
- Test: `frontend/src/test/openHopConditionBuilder.test.tsx`

- [ ] **Step 1: Failing test** (`openHopConditionBuilder.test.tsx`) — the builder starts from a simple condition; selecting field/op and typing a value calls `onChange({ field, op, value })`; switching to "match all"/"match any" wraps the current condition into `{ all: [...] }` / `{ any: [...] }`; adding a sub-condition appends to the array; the `@group` value picker lists keys from a supplied `objects.channel_hash_groups`. Assert the produced object matches the documented shapes exactly.

```tsx
it('emits a simple condition', async () => {
  const onChange = vi.fn();
  render(<OpenHopConditionBuilder value={{ field: '', op: 'equals', value: '' }}
    objects={{ channel_hash_groups: { grpA: ['0x1F'] }, pubkey_groups: {} }} onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText(/field/i), 'channel_hash');
  await userEvent.type(screen.getByLabelText(/value/i), '0x1f');
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'channel_hash', value: '0x1f' }));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `OpenHopConditionBuilder`** — a recursive component:
  - If `value` has `all` or `any`: render a group with a mode toggle (all/any), a list of child `OpenHopConditionBuilder`s (each with its own `onChange` that writes back into the array), an "add condition" button, and a "flatten to single" affordance when one child remains.
  - Else (simple): three inputs - `field` (`select` over the Field list, but allow a free-text "custom" option), `op` (`select` over Operator list), `value` (text input; plus a `@group` dropdown listing `Object.keys(objects.channel_hash_groups)` and `pubkey_groups`, which sets value to `@channel_hash_groups.<name>`). A "group these" button wraps the current simple condition into `{ all: [current] }`.
  - Constants:
```tsx
export const OPENHOP_FIELDS = ['channel_hash','channel_sender','channel_message_body','channel_decryptable','path_hashes','transport_code_0','transport_code_1','payload_hex'] as const;
export const OPENHOP_OPERATORS = ['equals','not_equals','greater_than','less_than','contains','in','starts_with'] as const;
export const OPENHOP_ACTIONS = ['allow','drop','log_only'] as const;
```
  Implement `OpenHopRuleForm` — name input, enabled checkbox, `then.action` select over `OPENHOP_ACTIONS`, and an embedded `OpenHopConditionBuilder` bound to `rule.if` (treating `{}` as a starting simple `{field:'',op:'equals',value:''}` for editing, and normalizing an all-empty simple condition back to `{}` on save). Save/Cancel buttons; Save calls `onSave(updatedRule)` (the parent replaces `rules[i]`), Cancel calls `onCancel()`. i18n keys: `openhop_rule_name`, `openhop_rule_enabled`, `openhop_rule_action`, `openhop_rule_field`, `openhop_rule_op`, `openhop_rule_value`, `openhop_rule_match_all`, `openhop_rule_match_any`, `openhop_rule_add_condition`, `openhop_rule_use_group`, `openhop_rule_save`, `openhop_rule_cancel` in EN/NL/DE.

- [ ] **Step 4: Run → PASS.** tsc clean; prettier clean; run the full `openHopPolicySection` + `openHopConditionBuilder` suites.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/OpenHopRuleForm.tsx frontend/src/components/settings/openhop/OpenHopConditionBuilder.tsx frontend/src/test/openHopConditionBuilder.test.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(openhop): rule form + recursive condition builder"
```

---

## PHASE C — Gates + runtime verification

### Task 11: Whole-repo quality gate, runtime verification, screenshots

- [ ] **Step 1: Backend suite** — `PYTHONPATH=. uv run pytest tests/ -q`. Expected: `failed`/`errors` counts unchanged from the pre-existing Windows baseline (14 failed / 32 errors as of this branch); `passed` up by the new tests only.
- [ ] **Step 2: Frontend gates** — `cd frontend && npx tsc --noEmit` (0 errors), `npx vitest run` (all pass incl. i18n parity), `npx prettier --check src/` on the touched files (they must be clean; the repo-wide CRLF false-positives are pre-existing), `npx eslint src/components/settings/openhop/` (0 errors).
- [ ] **Step 3: Runtime verification against the sim (required).** Bring up the sim and RTFM-EV:
```bash
MSYS_NO_PATHCONV=1 docker run -d --name openhop-sim -p 5000:5000 -p 8010:8000 \
  -v G:/Github/repositories/openhop-dev/sim/config:/etc/openhop_repeater \
  -v G:/Github/repositories/openhop-dev/sim/data:/var/lib/openhop_repeater \
  --entrypoint python3 openhop-sim:local -m repeater.plugins.container_supervisor --config /etc/openhop_repeater/config.yaml
```
Build the frontend (`cd frontend && npx vite build`), run the backend against the sim (`MESHCORE_TCP_HOST=127.0.0.1 MESHCORE_TCP_PORT=5000 MESHCORE_DATABASE_PATH=<throwaway> PYTHONPATH=. uv run uvicorn app.main:app --port 8020`). In the browser, configure OpenHop management (Radio settings) so `status.configured` is true, then open the new **OpenHop** settings section and confirm: engine toggle + default action save (round-trip: the sim's `GET /api/policy` reflects it); create a channel-hashes group + a `0x1f` entry (confirm it appears in `policy_engine.objects.channel_hash_groups`); add a rule (field `channel_hash`, op `equals`, value referencing the group or a literal), Save, confirm the sim reflects it. Take screenshots of the engine card, groups manager, and rule editor (static settings views capture cleanly). Tear down: `docker rm -f openhop-sim`.
- [ ] **Step 4: Confirm zero-regression for non-OpenHop.** Verify (by test + the non-OpenHop instance) that the OpenHop section does not appear in the settings nav, command palette, or modal when `is_openhop` is false.

---

## Self-Review

- **Spec coverage:** engine toggle + default_action (Task 7), groups/entries CRUD (Task 3 backend, Task 8 frontend), rule editor incl. condition builder with all/any and `@group` refs (Tasks 9-10), gated top-level section (Task 5), validate-then-save (Task 7 + shared `savePolicy`), auth via existing X-API-Key proxy (Tasks 1-3). All spec sections map to tasks.
- **Placeholder scan:** backend tasks carry complete code. The large UI components (Tasks 8-10) give the component contract, key handlers, constants, and full test code, and explicitly reuse the existing `OpenHopSettings`/`MeshcomodSettings` layout patterns for routine JSX rather than restating every line - a deliberate scaling choice for a large UI, not a hidden placeholder. Each such task still has a concrete failing test that pins the behavior.
- **Type consistency:** `OpenHopPolicyEngine`, `OpenHopRule`, `OpenHopCondition`, `OpenHopGroup*` are defined once (Task 4) and consumed unchanged in Tasks 6-10. Client method names (`getOpenHopPolicy`, `validateOpenHopPolicy`, `updateOpenHopPolicy`, `createOpenHopGroup`, `addOpenHopGroupEntry`, `deleteOpenHopGroupEntry`) match between Task 4 and their consumers. Backend `OpenHopClient` method names match between Task 1 and the router Tasks 2-3.
- **Known caveat:** the `@router.request(...)` placeholder in Task 3 Step 3 is called out in its own note - implement with `@router.delete(...)` (FastAPI DELETE-with-body). Refactor Task 2's endpoints onto the shared `_relay` helper introduced in Task 3.
```
