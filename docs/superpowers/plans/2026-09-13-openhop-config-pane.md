# OpenHop Config Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Config pane to RTFM-EV's OpenHop settings section (third sub-nav tab after Policy and Plugins) that mirrors OpenHop's config page: view/validate config, switch mode, edit radio params, and back up / restore config.

**Architecture:** Same gated proxy as the existing panes. New `/api/openhop/config/*` endpoints in `app/routers/openhop.py` delegate to new `OpenHopClient` methods. All config endpoints return HTTP 200 with a `success` flag (errors are `{success:false,error}`), so every one uses `_relay` (transport failures map to 502). The frontend adds a `Config` tab and an `OpenHopConfigPane` composed of four cards. Fail-closed: the tab renders only when `is_openhop` AND configured.

**Tech Stack:** Backend FastAPI + httpx (async). Frontend React + TypeScript + i18next (EN/NL/DE enforced) + Vitest + Testing Library. UI kit: `segmented`, `input`, `checkbox`, `label`, `button`, `sonner`.

**Verified OpenHop endpoint shapes (probed live 2026-09-13 against the sim):**
- `GET /api/config_export[?include_secrets=true]` -> `{success, data:{meta:{exported_at,version,config_path,includes_secrets}, config:{...sections...}}}`
- `POST /api/config_import` body `{config, restart_after}` -> `{success, message, sections_updated:[str], saved, restart_required}`
- `GET /api/validate_config` -> `{success, data:{valid, blocked_restart, errors:[{path,message}], warnings:[{path,message}], summary:{error_count,warning_count}, config_path, message}}`
- `POST /api/update_radio_config` body `{tx_power,frequency,bandwidth,spreading_factor,coding_rate,tx_delay_factor,direct_tx_delay_factor,rx_delay_base,node_name,owner_info,latitude,longitude,max_flood_hops,flood_advert_interval_hours,advert_interval_minutes}` (all optional) -> `{success, data:{applied:[str], persisted, live_update, restart_required, message}}`
- `POST /api/set_mode` body `{mode}` in `forward|monitor|no_tx` -> `{success, mode, persisted}`
- `GET /api/hardware_options` -> `{hardware:[{key,name,description,config}]}`
- `GET /api/radio_presets` -> `{presets:[{title,description,frequency,spreading_factor,bandwidth,coding_rate}], source}` (NOTE: preset fields are STRINGS, frequency in MHz e.g. "915.800"; update_radio_config wants frequency in Hz int and numeric params)
- `POST /api/restart_service` -> `{success, message}` or `{success:false, error}` (uses systemctl; will report failure on a sim without systemd; verify round-trip + error handling)

---

## File Structure

**Backend**
- Modify `app/services/openhop_api.py`: add config-family client methods.
- Modify `app/routers/openhop.py`: add `/config/*` endpoints + request models.
- Modify `tests/test_openhop_api_service.py`: client method tests.
- Modify `tests/test_openhop_router.py`: gate + delegation tests.

**Frontend**
- Modify `frontend/src/types.ts`: config response types.
- Modify `frontend/src/api.ts`: `/openhop/config/*` helpers.
- Modify `frontend/src/i18n/locales/{en,nl,de}.json`: `openhop_config_*` + `openhop_tab_config` keys.
- Modify `frontend/src/components/settings/openhop/SettingsOpenHopSection.tsx`: add Config tab.
- Create `frontend/src/components/settings/openhop/config/OpenHopConfigPane.tsx`.
- Create `.../config/ConfigModeCard.tsx`, `ConfigOverviewCard.tsx`, `ConfigRadioCard.tsx`, `ConfigBackupRestoreCard.tsx`.
- Create tests under `frontend/src/test/`: `openHopConfigPane.test.tsx`, `openHopConfigModeCard.test.tsx`, `openHopConfigRadioCard.test.tsx`, `openHopConfigBackupRestore.test.tsx`.
- Modify `frontend/src/test/openHopSectionSubnav.test.tsx`: assert the Config tab.

**Docs**
- Modify `CHANGELOG-DMC-EV.md`: add an entry.
- Modify `frontend/AGENTS.md` if the OpenHop pane list is enumerated there (check; update only if present).

---

## Task 1: OpenHopClient config-family methods

**Files:**
- Modify: `app/services/openhop_api.py`
- Test: `tests/test_openhop_api_service.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_openhop_api_service.py`)

```python
@pytest.mark.asyncio
async def test_config_family_methods_use_api_key_and_paths():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[(request.method, request.url.path)] = request.headers.get("X-API-Key")
        p, m = request.url.path, request.method
        if p == "/api/config_export" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": {"meta": {}, "config": {}}})
        if p == "/api/config_import" and m == "POST":
            return httpx.Response(200, json={"success": True, "sections_updated": ["repeater"]})
        if p == "/api/validate_config" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": {"valid": True}})
        if p == "/api/update_radio_config" and m == "POST":
            return httpx.Response(200, json={"success": True, "data": {"applied": ["txpower=22"]}})
        if p == "/api/set_mode" and m == "POST":
            return httpx.Response(200, json={"success": True, "mode": "forward"})
        if p == "/api/hardware_options" and m == "GET":
            return httpx.Response(200, json={"hardware": []})
        if p == "/api/radio_presets" and m == "GET":
            return httpx.Response(200, json={"presets": [], "source": "local"})
        if p == "/api/restart_service" and m == "POST":
            return httpx.Response(200, json={"success": True, "message": "ok"})
        return httpx.Response(404, json={"success": False})

    client = OpenHopClient("http://node:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await client.config_export())["success"] is True
    assert (await client.config_export(include_secrets=True))["success"] is True
    assert (await client.config_import({"repeater": {"node_name": "N"}}, restart_after=False))["sections_updated"] == ["repeater"]
    assert (await client.validate_config())["data"]["valid"] is True
    assert (await client.update_radio_config({"tx_power": 22}))["data"]["applied"] == ["txpower=22"]
    assert (await client.set_mode("forward"))["mode"] == "forward"
    assert (await client.hardware_options())["hardware"] == []
    assert (await client.radio_presets())["source"] == "local"
    assert (await client.restart_service())["message"] == "ok"
    await client.aclose()
    assert all(v == "tok" for v in seen.values())
    # include_secrets adds the query param
    assert ("GET", "/api/config_export") in seen
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONPATH=. uv run pytest tests/test_openhop_api_service.py::test_config_family_methods_use_api_key_and_paths -v`
Expected: FAIL (AttributeError: 'OpenHopClient' has no attribute 'config_export').

- [ ] **Step 3: Implement the methods** (add to `OpenHopClient` in `app/services/openhop_api.py`, before `aclose`)

```python
    async def config_export(self, include_secrets: bool = False) -> dict[str, Any]:
        path = "/api/config_export" + ("?include_secrets=true" if include_secrets else "")
        return await self._get(path)

    async def config_import(
        self, config: dict[str, Any], restart_after: bool = False
    ) -> dict[str, Any]:
        return await self._post(
            "/api/config_import", {"config": config, "restart_after": restart_after}
        )

    async def validate_config(self) -> dict[str, Any]:
        return await self._get("/api/validate_config")

    async def update_radio_config(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/update_radio_config", params)

    async def set_mode(self, mode: str) -> dict[str, Any]:
        return await self._post("/api/set_mode", {"mode": mode})

    async def hardware_options(self) -> dict[str, Any]:
        return await self._get("/api/hardware_options")

    async def radio_presets(self) -> dict[str, Any]:
        return await self._get("/api/radio_presets")

    async def restart_service(self) -> dict[str, Any]:
        return await self._post("/api/restart_service", {})
```

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONPATH=. uv run pytest tests/test_openhop_api_service.py -q`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add app/services/openhop_api.py tests/test_openhop_api_service.py
git commit -m "feat(openhop): config-family REST client methods"
```

---

## Task 2: Router /config/* endpoints

**Files:**
- Modify: `app/routers/openhop.py`
- Test: `tests/test_openhop_router.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_openhop_router.py`; add imports of the new endpoint fns to the existing import line)

```python
# add to the top-level import from app.routers.openhop:
#   config_export, config_import, config_validate, config_radio, config_mode,
#   config_hardware_options, config_presets, config_restart,
#   ConfigImportRequest, ConfigRadioRequest, ConfigModeRequest


class TestOpenHopConfig:
    @pytest.mark.asyncio
    async def test_config_export_409_when_not_openhop(self, test_db, monkeypatch):
        _set_model(monkeypatch, "Heltec V3")
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        with pytest.raises(HTTPException) as exc:
            await config_export()
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_config_export_delegates(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        fake = AsyncMock()
        fake.config_export = AsyncMock(return_value={"success": True, "data": {"config": {}}})
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            result = await config_export(include_secrets=True)
        assert result["success"] is True
        fake.config_export.assert_awaited_once_with(include_secrets=True)
        fake.aclose.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_config_mode_delegates(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        fake = AsyncMock()
        fake.set_mode = AsyncMock(return_value={"success": True, "mode": "monitor"})
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            result = await config_mode(ConfigModeRequest(mode="monitor"))
        assert result["mode"] == "monitor"
        fake.set_mode.assert_awaited_once_with("monitor")

    @pytest.mark.asyncio
    async def test_config_radio_and_import_and_restart_delegate(self, test_db, monkeypatch):
        _set_model(monkeypatch, OPENHOP_MODEL)
        await AppSettingsRepository.update(
            openhop_api_url="http://node:8000", openhop_api_token="tok"
        )
        fake = AsyncMock()
        fake.update_radio_config = AsyncMock(return_value={"success": True, "data": {"applied": []}})
        fake.config_import = AsyncMock(return_value={"success": True, "sections_updated": ["radio"]})
        fake.restart_service = AsyncMock(return_value={"success": True, "message": "ok"})
        fake.aclose = AsyncMock()
        with patch("app.routers.openhop.OpenHopClient", return_value=fake):
            r1 = await config_radio(ConfigRadioRequest(params={"tx_power": 22}))
            r2 = await config_import(ConfigImportRequest(config={"radio": {}}, restart_after=False))
            r3 = await config_restart()
        assert r1["success"] is True
        assert r2["sections_updated"] == ["radio"]
        assert r3["message"] == "ok"
        fake.update_radio_config.assert_awaited_once_with({"tx_power": 22})
        fake.config_import.assert_awaited_once_with({"radio": {}}, restart_after=False)
        fake.restart_service.assert_awaited_once_with()
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONPATH=. uv run pytest tests/test_openhop_router.py::TestOpenHopConfig -v`
Expected: FAIL (ImportError for the new names).

- [ ] **Step 3: Implement** (append to `app/routers/openhop.py`, after the plugin section)

```python
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONPATH=. uv run pytest tests/test_openhop_router.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/routers/openhop.py tests/test_openhop_router.py
git commit -m "feat(openhop): gated /config proxy endpoints"
```

---

## Task 3: Frontend types + api helpers

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add types** (append near the other OpenHop types in `frontend/src/types.ts`)

```ts
export interface OpenHopConfigExport {
  success: boolean;
  data?: { meta?: Record<string, unknown>; config?: Record<string, unknown> };
  error?: string;
}
export interface OpenHopValidateResult {
  success: boolean;
  data?: {
    valid: boolean;
    blocked_restart?: boolean;
    errors: { path: string; message: string }[];
    warnings: { path: string; message: string }[];
    summary?: { error_count: number; warning_count: number };
    message?: string;
  };
  error?: string;
}
export interface OpenHopModeResult {
  success: boolean;
  mode?: string;
  persisted?: boolean;
  error?: string;
}
export interface OpenHopRadioResult {
  success: boolean;
  data?: { applied?: string[]; live_update?: boolean; restart_required?: boolean; message?: string };
  error?: string;
}
export interface OpenHopImportResult {
  success: boolean;
  message?: string;
  sections_updated?: string[];
  saved?: boolean;
  restart_required?: boolean;
  error?: string;
}
export interface OpenHopRestartResult {
  success: boolean;
  message?: string;
  error?: string;
}
export interface OpenHopHardwareOption {
  key: string;
  name: string;
  description?: string;
  config?: Record<string, unknown>;
}
export interface OpenHopRadioPreset {
  title: string;
  description?: string;
  frequency?: string;
  spreading_factor?: string;
  bandwidth?: string;
  coding_rate?: string;
}
```

- [ ] **Step 2: Add api helpers** (append inside the `api` object in `frontend/src/api.ts`, after the plugin helpers; add the new type names to the type import block)

```ts
  // OpenHop config (Surface B; only meaningful when is_openhop AND configured)
  getOpenHopConfigExport: (includeSecrets = false) =>
    fetchJson<OpenHopConfigExport>(
      `/openhop/config/export${includeSecrets ? '?include_secrets=true' : ''}`
    ),
  validateOpenHopConfig: () => fetchJson<OpenHopValidateResult>('/openhop/config/validate'),
  getOpenHopHardwareOptions: () =>
    fetchJson<{ hardware: OpenHopHardwareOption[] }>('/openhop/config/hardware_options'),
  getOpenHopPresets: () =>
    fetchJson<{ presets: OpenHopRadioPreset[]; source?: string }>('/openhop/config/presets'),
  setOpenHopMode: (mode: string) =>
    fetchJson<OpenHopModeResult>('/openhop/config/mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  updateOpenHopRadio: (params: Record<string, number | string>) =>
    fetchJson<OpenHopRadioResult>('/openhop/config/radio', {
      method: 'POST',
      body: JSON.stringify({ params }),
    }),
  importOpenHopConfig: (config: Record<string, unknown>, restartAfter = false) =>
    fetchJson<OpenHopImportResult>('/openhop/config/import', {
      method: 'POST',
      body: JSON.stringify({ config, restart_after: restartAfter }),
    }),
  restartOpenHopService: () =>
    fetchJson<OpenHopRestartResult>('/openhop/config/restart', { method: 'POST' }),
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no errors). If unused-import errors appear for a type used only later, that is expected until Task 5+ consume them; the types are exported so tsc will not flag them as unused. Confirm zero errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(openhop): frontend config types + api helpers"
```

---

## Task 4: i18n keys (EN/NL/DE)

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

Add these keys to ALL THREE locale files (parity test enforced). English values below; provide accurate NL and DE translations. Place them near the existing `openhop_*` keys.

- [ ] **Step 1: Add keys** (English reference; translate for NL/DE)

```json
"openhop_tab_config": "Config",
"openhop_config_configure_first": "Configure OpenHop management (URL and token) to use the config tools.",
"openhop_config_load_failed": "Could not load the OpenHop configuration.",
"openhop_config_mode_title": "Operating mode",
"openhop_config_mode_forward": "Forward",
"openhop_config_mode_monitor": "Monitor",
"openhop_config_mode_no_tx": "No TX",
"openhop_config_mode_saved": "Mode set to {{mode}}.",
"openhop_config_mode_failed": "Could not set the mode.",
"openhop_config_overview_title": "Configuration",
"openhop_config_validate": "Validate",
"openhop_config_valid": "Configuration is valid.",
"openhop_config_invalid": "Configuration has {{count}} error(s).",
"openhop_config_warnings": "{{count}} warning(s).",
"openhop_config_radio_title": "Radio parameters",
"openhop_config_radio_preset": "Preset",
"openhop_config_radio_preset_placeholder": "Choose a preset to prefill",
"openhop_config_radio_frequency": "Frequency (MHz)",
"openhop_config_radio_bandwidth": "Bandwidth (kHz)",
"openhop_config_radio_sf": "Spreading factor",
"openhop_config_radio_cr": "Coding rate",
"openhop_config_radio_tx_power": "TX power (dBm)",
"openhop_config_radio_node_name": "Node name",
"openhop_config_radio_save": "Save radio settings",
"openhop_config_radio_confirm": "Changing radio settings may drop the node off-mesh, and frequency/bandwidth/SF/coding-rate changes require a restart. Continue?",
"openhop_config_radio_saved": "Radio settings saved.",
"openhop_config_radio_failed": "Could not save radio settings.",
"openhop_config_restart_required": "A restart is required to apply these changes.",
"openhop_config_restart_now": "Restart node now",
"openhop_config_restart_confirm": "Restart the OpenHop node now?",
"openhop_config_restart_ok": "Restart requested.",
"openhop_config_restart_failed": "Could not restart the node.",
"openhop_config_backup_title": "Backup and restore",
"openhop_config_export": "Download backup",
"openhop_config_export_secrets": "Include secrets (full backup)",
"openhop_config_export_secrets_warning": "The downloaded file will contain credentials and the identity key.",
"openhop_config_export_failed": "Could not export the configuration.",
"openhop_config_import": "Restore from file",
"openhop_config_import_confirm": "This replaces the node configuration. Continue?",
"openhop_config_import_ok": "Imported {{sections}} section(s).",
"openhop_config_import_failed": "Could not import the configuration.",
"openhop_config_import_bad_file": "The selected file is not a valid config backup."
```

- [ ] **Step 2: Run the parity test**

Run: `cd frontend && npx vitest run src/test/i18nParity.test.ts` (or the enforced parity test path; find it with `ls src/test | grep -i i18n`)
Expected: PASS (all three locales have identical key sets).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(openhop): config pane i18n keys (en/nl/de)"
```

---

## Task 5: ConfigModeCard

**Files:**
- Create: `frontend/src/components/settings/openhop/config/ConfigModeCard.tsx`
- Test: `frontend/src/test/openHopConfigModeCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigModeCard } from '../components/settings/openhop/config/ConfigModeCard';
import { api } from '../api';

beforeEach(() => vi.restoreAllMocks());

describe('ConfigModeCard', () => {
  it('sets the mode when a mode button is clicked', async () => {
    const spy = vi.spyOn(api, 'setOpenHopMode').mockResolvedValue({ success: true, mode: 'monitor' });
    render(<ConfigModeCard currentMode="forward" />);
    await userEvent.click(screen.getByRole('button', { name: /monitor/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('monitor'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/test/openHopConfigModeCard.test.tsx`
Expected: FAIL (cannot resolve ConfigModeCard).

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';

const MODES = ['forward', 'monitor', 'no_tx'] as const;
type Mode = (typeof MODES)[number];

export function ConfigModeCard({ currentMode }: { currentMode?: string }) {
  const t = useT();
  const [mode, setMode] = useState<string | undefined>(currentMode);
  const [busy, setBusy] = useState(false);

  const label = (m: Mode) =>
    m === 'forward'
      ? t('openhop_config_mode_forward')
      : m === 'monitor'
        ? t('openhop_config_mode_monitor')
        : t('openhop_config_mode_no_tx');

  const choose = async (m: Mode) => {
    setBusy(true);
    try {
      const res = await api.setOpenHopMode(m);
      if (res.success) {
        setMode(res.mode ?? m);
        toast.success(t('openhop_config_mode_saved', { mode: label(m) }));
      } else {
        toast.error(res.error || t('openhop_config_mode_failed'));
      }
    } catch {
      toast.error(t('openhop_config_mode_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{t('openhop_config_mode_title')}</h4>
      <div className="flex gap-2">
        {MODES.map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={mode === m ? 'default' : 'outline'}
            disabled={busy}
            aria-pressed={mode === m}
            onClick={() => void choose(m)}
          >
            {label(m)}
          </Button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/openHopConfigModeCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/config/ConfigModeCard.tsx frontend/src/test/openHopConfigModeCard.test.tsx
git commit -m "feat(openhop): config mode-switch card"
```

---

## Task 6: ConfigOverviewCard (validate)

**Files:**
- Create: `frontend/src/components/settings/openhop/config/ConfigOverviewCard.tsx`
- Test: `frontend/src/test/openHopConfigOverviewCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigOverviewCard } from '../components/settings/openhop/config/ConfigOverviewCard';
import { api } from '../api';

beforeEach(() => vi.restoreAllMocks());

describe('ConfigOverviewCard', () => {
  it('shows the valid result after validating', async () => {
    vi.spyOn(api, 'validateOpenHopConfig').mockResolvedValue({
      success: true,
      data: { valid: true, errors: [], warnings: [] },
    });
    render(<ConfigOverviewCard />);
    await userEvent.click(screen.getByRole('button', { name: /validate/i }));
    expect(await screen.findByText(/configuration is valid/i)).toBeInTheDocument();
  });

  it('lists errors when invalid', async () => {
    vi.spyOn(api, 'validateOpenHopConfig').mockResolvedValue({
      success: true,
      data: { valid: false, errors: [{ path: 'repeater.node_name', message: 'required' }], warnings: [] },
    });
    render(<ConfigOverviewCard />);
    await userEvent.click(screen.getByRole('button', { name: /validate/i }));
    expect(await screen.findByText(/repeater.node_name/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/test/openHopConfigOverviewCard.test.tsx`
Expected: FAIL (cannot resolve module).

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';
import type { OpenHopValidateResult } from '../../../../types';

export function ConfigOverviewCard() {
  const t = useT();
  const [result, setResult] = useState<OpenHopValidateResult['data'] | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = async () => {
    setBusy(true);
    try {
      const res = await api.validateOpenHopConfig();
      setResult(res.data ?? null);
    } catch {
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">{t('openhop_config_overview_title')}</h4>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void validate()}>
          {t('openhop_config_validate')}
        </Button>
      </div>
      {result && (
        <div className="text-xs">
          {result.valid ? (
            <p className="text-muted-foreground">{t('openhop_config_valid')}</p>
          ) : (
            <p className="text-destructive">
              {t('openhop_config_invalid', { count: result.errors.length })}
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-destructive">
              {result.errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono">{e.path}</span>: {e.message}
                </li>
              ))}
            </ul>
          )}
          {result.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {result.warnings.map((w, i) => (
                <li key={i}>
                  <span className="font-mono">{w.path}</span>: {w.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/openHopConfigOverviewCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/config/ConfigOverviewCard.tsx frontend/src/test/openHopConfigOverviewCard.test.tsx
git commit -m "feat(openhop): config validate/overview card"
```

---

## Task 7: ConfigRadioCard

**Files:**
- Create: `frontend/src/components/settings/openhop/config/ConfigRadioCard.tsx`
- Test: `frontend/src/test/openHopConfigRadioCard.test.tsx`

Design notes:
- Loads presets on mount (`api.getOpenHopPresets`). Selecting a preset prefills frequency (MHz string), bandwidth (kHz), SF, CR from the preset.
- On save: build a numeric params object. Convert frequency MHz -> Hz int (`Math.round(parseFloat(mhz) * 1_000_000)`), bandwidth kHz -> Hz int (`Math.round(parseFloat(khz) * 1000)`), SF/CR/tx_power -> int, node_name -> string. Only include fields the user filled (non-empty).
- Guard the save behind `window.confirm(t('openhop_config_radio_confirm'))`.
- On `restart_required` in the response, show the restart notice + a Restart button (calls `api.restartOpenHopService` behind a confirm). The restart control is shared logic; implement it inline here and reuse the same snippet in Task 8 (kept local per card to avoid a premature shared component; both are ~10 lines).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigRadioCard } from '../components/settings/openhop/config/ConfigRadioCard';
import { api } from '../api';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopPresets').mockResolvedValue({ presets: [], source: 'local' });
});

describe('ConfigRadioCard', () => {
  it('converts frequency MHz to Hz and posts only filled fields after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const spy = vi
      .spyOn(api, 'updateOpenHopRadio')
      .mockResolvedValue({ success: true, data: { applied: ['freq'], restart_required: true } });
    render(<ConfigRadioCard />);
    await userEvent.type(screen.getByLabelText(/frequency/i), '869.525');
    await userEvent.click(screen.getByRole('button', { name: /save radio settings/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ frequency: 869525000 }));
    // restart notice appears
    expect(await screen.findByText(/restart is required/i)).toBeInTheDocument();
  });

  it('does not post when the confirm is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const spy = vi.spyOn(api, 'updateOpenHopRadio').mockResolvedValue({ success: true, data: {} });
    render(<ConfigRadioCard />);
    await userEvent.type(screen.getByLabelText(/frequency/i), '869.525');
    await userEvent.click(screen.getByRole('button', { name: /save radio settings/i }));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/test/openHopConfigRadioCard.test.tsx`
Expected: FAIL (cannot resolve module).

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { Label } from '../../../ui/label';
import type { OpenHopRadioPreset } from '../../../../types';

interface Fields {
  frequency: string; // MHz
  bandwidth: string; // kHz
  spreading_factor: string;
  coding_rate: string;
  tx_power: string;
  node_name: string;
}
const EMPTY: Fields = {
  frequency: '',
  bandwidth: '',
  spreading_factor: '',
  coding_rate: '',
  tx_power: '',
  node_name: '',
};

export function ConfigRadioCard() {
  const t = useT();
  const [presets, setPresets] = useState<OpenHopRadioPreset[]>([]);
  const [f, setF] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    void api
      .getOpenHopPresets()
      .then((r) => setPresets(r.presets ?? []))
      .catch(() => setPresets([]));
  }, []);

  const applyPreset = (title: string) => {
    const p = presets.find((x) => x.title === title);
    if (!p) return;
    setF((prev) => ({
      ...prev,
      frequency: p.frequency ?? prev.frequency,
      bandwidth: p.bandwidth ?? prev.bandwidth,
      spreading_factor: p.spreading_factor ?? prev.spreading_factor,
      coding_rate: p.coding_rate ?? prev.coding_rate,
    }));
  };

  const buildParams = (): Record<string, number | string> => {
    const p: Record<string, number | string> = {};
    if (f.frequency.trim()) p.frequency = Math.round(parseFloat(f.frequency) * 1_000_000);
    if (f.bandwidth.trim()) p.bandwidth = Math.round(parseFloat(f.bandwidth) * 1000);
    if (f.spreading_factor.trim()) p.spreading_factor = parseInt(f.spreading_factor, 10);
    if (f.coding_rate.trim()) p.coding_rate = parseInt(f.coding_rate, 10);
    if (f.tx_power.trim()) p.tx_power = parseInt(f.tx_power, 10);
    if (f.node_name.trim()) p.node_name = f.node_name.trim();
    return p;
  };

  const save = async () => {
    const params = buildParams();
    if (Object.keys(params).length === 0) return;
    if (!window.confirm(t('openhop_config_radio_confirm'))) return;
    setBusy(true);
    try {
      const res = await api.updateOpenHopRadio(params);
      if (res.success) {
        toast.success(t('openhop_config_radio_saved'));
        setRestartRequired(Boolean(res.data?.restart_required));
      } else {
        toast.error(res.error || t('openhop_config_radio_failed'));
      }
    } catch {
      toast.error(t('openhop_config_radio_failed'));
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    if (!window.confirm(t('openhop_config_restart_confirm'))) return;
    try {
      const res = await api.restartOpenHopService();
      if (res.success) toast.success(t('openhop_config_restart_ok'));
      else toast.error(res.error || t('openhop_config_restart_failed'));
    } catch {
      toast.error(t('openhop_config_restart_failed'));
    }
  };

  const field = (key: keyof Fields, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`ohr-${key}`}>{label}</Label>
      <Input
        id={`ohr-${key}`}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <section className="space-y-3">
      <h4 className="text-sm font-medium">{t('openhop_config_radio_title')}</h4>
      {presets.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="ohr-preset">{t('openhop_config_radio_preset')}</Label>
          <select
            id="ohr-preset"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
            defaultValue=""
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="" disabled>
              {t('openhop_config_radio_preset_placeholder')}
            </option>
            {presets.map((p) => (
              <option key={p.title} value={p.title}>
                {p.title} {p.description ? `(${p.description})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {field('frequency', t('openhop_config_radio_frequency'))}
        {field('bandwidth', t('openhop_config_radio_bandwidth'))}
        {field('spreading_factor', t('openhop_config_radio_sf'))}
        {field('coding_rate', t('openhop_config_radio_cr'))}
        {field('tx_power', t('openhop_config_radio_tx_power'))}
        {field('node_name', t('openhop_config_radio_node_name'))}
      </div>
      <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
        {t('openhop_config_radio_save')}
      </Button>
      {restartRequired && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t('openhop_config_restart_required')}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void restart()}>
            {t('openhop_config_restart_now')}
          </Button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/openHopConfigRadioCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/config/ConfigRadioCard.tsx frontend/src/test/openHopConfigRadioCard.test.tsx
git commit -m "feat(openhop): config radio-parameter card"
```

---

## Task 8: ConfigBackupRestoreCard

**Files:**
- Create: `frontend/src/components/settings/openhop/config/ConfigBackupRestoreCard.tsx`
- Test: `frontend/src/test/openHopConfigBackupRestore.test.tsx`

Design notes:
- Export: `api.getOpenHopConfigExport(includeSecrets)`, then build a Blob and trigger a download (mirror `ChannelImportExportModal`: create Blob, `URL.createObjectURL`, an `<a download>` click, revoke). Filename `openhop-config-<timestamp>.json`.
- Include-secrets checkbox with warning text.
- Import: hidden `<input type="file">`, `FileReader.readAsText`, `JSON.parse`. Accept either the export shape (`{data:{config}}`) or a bare config object: if parsed has `data.config`, use that; else if it has a `config` key, use that; else use the parsed object. Confirm via `window.confirm`, then `api.importOpenHopConfig(config)`. Show restart control on `restart_required`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigBackupRestoreCard } from '../components/settings/openhop/config/ConfigBackupRestoreCard';
import { api } from '../api';

beforeEach(() => vi.restoreAllMocks());

describe('ConfigBackupRestoreCard', () => {
  it('exports a redacted backup by default', async () => {
    const spy = vi
      .spyOn(api, 'getOpenHopConfigExport')
      .mockResolvedValue({ success: true, data: { meta: {}, config: { repeater: {} } } });
    // jsdom lacks createObjectURL; stub it
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:x'),
      revokeObjectURL: vi.fn(),
    } as unknown as typeof URL);
    render(<ConfigBackupRestoreCard />);
    await userEvent.click(screen.getByRole('button', { name: /download backup/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(false));
    vi.unstubAllGlobals();
  });

  it('passes include-secrets when the checkbox is ticked', async () => {
    const spy = vi
      .spyOn(api, 'getOpenHopConfigExport')
      .mockResolvedValue({ success: true, data: { config: {} } });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:x'),
      revokeObjectURL: vi.fn(),
    } as unknown as typeof URL);
    render(<ConfigBackupRestoreCard />);
    await userEvent.click(screen.getByLabelText(/include secrets/i));
    await userEvent.click(screen.getByRole('button', { name: /download backup/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(true));
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/test/openHopConfigBackupRestore.test.tsx`
Expected: FAIL (cannot resolve module).

- [ ] **Step 3: Implement**

```tsx
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';
import { Checkbox } from '../../../ui/checkbox';
import { Label } from '../../../ui/label';

export function ConfigBackupRestoreCard() {
  const t = useT();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportConfig = async () => {
    setBusy(true);
    try {
      const res = await api.getOpenHopConfigExport(includeSecrets);
      if (!res.success || !res.data) {
        toast.error(res.error || t('openhop_config_export_failed'));
        return;
      }
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openhop-config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('openhop_config_export_failed'));
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        toast.error(t('openhop_config_import_bad_file'));
        return;
      }
      const obj = parsed as Record<string, unknown>;
      const data = obj?.data as Record<string, unknown> | undefined;
      const config = (data?.config ?? obj?.config ?? obj) as Record<string, unknown>;
      if (!config || typeof config !== 'object') {
        toast.error(t('openhop_config_import_bad_file'));
        return;
      }
      if (!window.confirm(t('openhop_config_import_confirm'))) return;
      void doImport(config);
    };
    reader.readAsText(file);
  };

  const doImport = async (config: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await api.importOpenHopConfig(config);
      if (res.success) {
        toast.success(t('openhop_config_import_ok', { sections: res.sections_updated?.length ?? 0 }));
        setRestartRequired(Boolean(res.restart_required));
      } else {
        toast.error(res.error || t('openhop_config_import_failed'));
      }
    } catch {
      toast.error(t('openhop_config_import_failed'));
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    if (!window.confirm(t('openhop_config_restart_confirm'))) return;
    try {
      const res = await api.restartOpenHopService();
      if (res.success) toast.success(t('openhop_config_restart_ok'));
      else toast.error(res.error || t('openhop_config_restart_failed'));
    } catch {
      toast.error(t('openhop_config_restart_failed'));
    }
  };

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{t('openhop_config_backup_title')}</h4>
      <div className="flex items-center gap-2">
        <Checkbox
          id="oh-secrets"
          checked={includeSecrets}
          onCheckedChange={(v) => setIncludeSecrets(v === true)}
        />
        <Label htmlFor="oh-secrets" className="text-xs">
          {t('openhop_config_export_secrets')}
        </Label>
      </div>
      {includeSecrets && (
        <p className="text-xs text-destructive">{t('openhop_config_export_secrets_warning')}</p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void exportConfig()}>
          {t('openhop_config_export')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {t('openhop_config_import')}
        </Button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onFile} />
      </div>
      {restartRequired && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t('openhop_config_restart_required')}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void restart()}>
            {t('openhop_config_restart_now')}
          </Button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/openHopConfigBackupRestore.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/config/ConfigBackupRestoreCard.tsx frontend/src/test/openHopConfigBackupRestore.test.tsx
git commit -m "feat(openhop): config backup/restore card"
```

---

## Task 9: OpenHopConfigPane container

**Files:**
- Create: `frontend/src/components/settings/openhop/config/OpenHopConfigPane.tsx`
- Test: `frontend/src/test/openHopConfigPane.test.tsx`

Design notes:
- Gate on `health?.radio_device_info?.is_openhop`; return null when false.
- On mount (when openHop) call `api.getOpenHopConfigExport()` to read `data.config.repeater.mode` for the ModeCard's `currentMode`. Classify 409 -> show configure-first message (like the plugins pane).
- Compose the four cards separated by a thin border.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopConfigPane } from '../components/settings/openhop/config/OpenHopConfigPane';
import { api, ApiError } from '../api';
import type { HealthStatus } from '../types';

const oh = { radio_device_info: { is_openhop: true } } as unknown as HealthStatus;
const notOh = { radio_device_info: { is_openhop: false } } as unknown as HealthStatus;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopPresets').mockResolvedValue({ presets: [], source: 'local' });
});

describe('OpenHopConfigPane', () => {
  it('renders nothing for a non-OpenHop node', () => {
    const { container } = render(<OpenHopConfigPane health={notOh} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows configure-first on 409', async () => {
    vi.spyOn(api, 'getOpenHopConfigExport').mockRejectedValue(new ApiError('nope', 409));
    render(<OpenHopConfigPane health={oh} />);
    expect(await screen.findByText(/configure openhop management/i)).toBeInTheDocument();
  });

  it('renders the cards when configured', async () => {
    vi.spyOn(api, 'getOpenHopConfigExport').mockResolvedValue({
      success: true,
      data: { config: { repeater: { mode: 'forward' } } },
    });
    render(<OpenHopConfigPane health={oh} />);
    expect(await screen.findByText(/operating mode/i)).toBeInTheDocument();
    expect(screen.getByText(/radio parameters/i)).toBeInTheDocument();
    expect(screen.getByText(/backup and restore/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/test/openHopConfigPane.test.tsx`
Expected: FAIL (cannot resolve module).

- [ ] **Step 3: Implement**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../../../api';
import { useT } from '../../../../i18n';
import type { HealthStatus } from '../../../../types';
import { ConfigOverviewCard } from './ConfigOverviewCard';
import { ConfigModeCard } from './ConfigModeCard';
import { ConfigRadioCard } from './ConfigRadioCard';
import { ConfigBackupRestoreCard } from './ConfigBackupRestoreCard';

interface Props {
  health: HealthStatus | null;
}

export function OpenHopConfigPane({ health }: Props) {
  const t = useT();
  const isOpenHop = health?.radio_device_info?.is_openhop ?? false;
  const [mode, setMode] = useState<string | undefined>(undefined);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setNotConfigured(false);
    try {
      const res = await api.getOpenHopConfigExport();
      const cfg = res.data?.config as Record<string, unknown> | undefined;
      const rep = cfg?.repeater as Record<string, unknown> | undefined;
      if (typeof rep?.mode === 'string') setMode(rep.mode);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setNotConfigured(true);
      else setError(t('openhop_config_load_failed'));
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    if (isOpenHop) void load();
  }, [isOpenHop, load]);

  if (!isOpenHop) return null;
  if (!loaded) return null;
  if (notConfigured) {
    return <p className="text-xs text-muted-foreground">{t('openhop_config_configure_first')}</p>;
  }

  return (
    <div className="space-y-4">
      <ConfigOverviewCard />
      <div className="border-t pt-3">
        <ConfigModeCard currentMode={mode} />
      </div>
      <div className="border-t pt-3">
        <ConfigRadioCard />
      </div>
      <div className="border-t pt-3">
        <ConfigBackupRestoreCard />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/openHopConfigPane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/config/OpenHopConfigPane.tsx frontend/src/test/openHopConfigPane.test.tsx
git commit -m "feat(openhop): config pane container"
```

---

## Task 10: Wire the Config tab into the sub-nav

**Files:**
- Modify: `frontend/src/components/settings/openhop/SettingsOpenHopSection.tsx`
- Modify: `frontend/src/test/openHopSectionSubnav.test.tsx`

- [ ] **Step 1: Update the subnav test** (add an assertion the Config tab exists and switches). Read the existing test first; add a case mirroring the plugins-tab case:

```tsx
  it('shows the Config tab and switches to it', async () => {
    // render the section with an OpenHop health (reuse the file's existing render helper/props)
    // then:
    await userEvent.click(screen.getByRole('button', { name: /^config$/i }));
    expect(await screen.findByText(/operating mode/i)).toBeInTheDocument();
  });
```

Note: the Config pane calls `api.getOpenHopConfigExport` and `api.getOpenHopPresets` on mount; stub both in this test's `beforeEach` (mirror how the file stubs plugin/policy api calls) so the switch renders the cards.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/test/openHopSectionSubnav.test.tsx`
Expected: FAIL (no Config button).

- [ ] **Step 3: Implement** (edit `SettingsOpenHopSection.tsx`)

- Add import: `import { OpenHopConfigPane } from './config/OpenHopConfigPane';`
- Change the tab type: `type OpenHopTab = 'policy' | 'plugins' | 'config';`
- Add the tab button after the plugins button: `{tabBtn('config', t('openhop_tab_config'))}`
- Replace the render ternary with an explicit switch:

```tsx
      {tab === 'policy' && <OpenHopPolicyPane {...props} />}
      {tab === 'plugins' && <OpenHopPluginsPane health={props.health} />}
      {tab === 'config' && <OpenHopConfigPane health={props.health} />}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/openHopSectionSubnav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/openhop/SettingsOpenHopSection.tsx frontend/src/test/openHopSectionSubnav.test.tsx
git commit -m "feat(openhop): add Config sub-nav tab"
```

---

## Task 11: Docs + full gate run

**Files:**
- Modify: `CHANGELOG-DMC-EV.md`
- Modify: `frontend/AGENTS.md` (only if it enumerates the OpenHop panes; check first)

- [ ] **Step 1: Add a changelog entry** to `CHANGELOG-DMC-EV.md` following the existing format, grouped by area, e.g. under an OpenHop / Surface B heading: "OpenHop Config pane: view/validate config, switch mode, edit radio parameters, and back up / restore config (gated proxy)."

- [ ] **Step 2: Check and update AGENTS docs**

Run: `grep -rn "Plugins pane\|Policy pane\|OpenHop" frontend/AGENTS.md docs/ | head`
If the pane list is enumerated, add the Config pane. Otherwise skip.

- [ ] **Step 3: Backend gates**

```bash
PYTHONPATH=. uv run pytest tests/test_openhop_router.py tests/test_openhop_api_service.py -q
PYTHONPATH=. uv run ruff check app/routers/openhop.py app/services/openhop_api.py tests/test_openhop_router.py tests/test_openhop_api_service.py
PYTHONPATH=. uv run ruff format --check app/routers/openhop.py app/services/openhop_api.py
```
Expected: all PASS. Then the full backend suite to confirm the Windows baseline is unchanged (14 failed / 32 errors pre-existing):
```bash
PYTHONPATH=. uv run pytest tests/ -q
```

- [ ] **Step 4: Frontend gates**

```bash
cd frontend && npx tsc --noEmit && npx vitest run && npx prettier --check "src/**/*.{ts,tsx,json}" && npx eslint src && npx vite build
```
Expected: all PASS (i18n parity included in vitest).

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG-DMC-EV.md frontend/AGENTS.md docs/
git commit -m "docs(openhop): changelog + pane docs for config pane"
```

---

## Task 12: Runtime verification (not a code commit)

- [ ] Start the sim (see the design doc's Runtime verification section and the memory note; remember `docker exec -u root openhop-sim chown repeater:repeater /etc/openhop_repeater/config.yaml` so writes persist).
- [ ] Build the frontend (`cd frontend && npx vite build`) and run a throwaway RTFM-EV instance against the sim (port 8020, throwaway DB).
- [ ] Create an OpenHop API token and PATCH `/api/settings` with `openhop_api_url` + `openhop_api_token`.
- [ ] In the browser: open Settings -> OpenHop -> Config. Exercise: Validate (shows warnings), Mode switch (forward/monitor/no_tx), Radio save (with a preset prefill + restart notice), Export (redacted and secrets), Import. Capture screenshots.
- [ ] Record what was VERIFIED vs NOT VERIFIED (restart_service will likely fail on the sim without systemd; that is a sim limitation, verify the round-trip + error handling).

---

## Self-Review

**Spec coverage:** view/inspect (export read in container + Overview validate), mode switch (ModeCard/Task 5), edit radio params (RadioCard/Task 7 incl. presets + restart), backup/restore (Task 8) all covered. Gate/fail-closed in container (Task 9) + router (Task 2). Confirm posture = window.confirm (Tasks 7, 8). Export secrets opt-in (Task 8). Restart button (Tasks 7, 8). i18n EN/NL/DE (Task 4). Tests each task. Runtime verify (Task 12).

**Type consistency:** api method names used in cards match Task 3 (`setOpenHopMode`, `validateOpenHopConfig`, `getOpenHopPresets`, `updateOpenHopRadio`, `getOpenHopConfigExport`, `importOpenHopConfig`, `restartOpenHopService`, `getOpenHopHardwareOptions`). Router fn names used in Task 2 tests match the endpoint defs (`config_export`, `config_validate`, `config_hardware_options`, `config_presets`, `config_mode`, `config_radio`, `config_import`, `config_restart`) and request models (`ConfigModeRequest`, `ConfigRadioRequest`, `ConfigImportRequest`). Client method names (Task 1) match router delegations (Task 2).

**Placeholder scan:** none. `getOpenHopHardwareOptions` is added in Task 3 for completeness/parity of the proxy surface but is not consumed by a card in this scope; that is intentional (YAGNI-safe: the endpoint exists for future use, exercised by the router/client tests). If tsc/eslint flags it as unused it is only exported-api, not a local, so no lint error results.
