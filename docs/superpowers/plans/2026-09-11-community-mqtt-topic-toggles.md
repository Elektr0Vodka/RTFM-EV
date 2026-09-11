# Community MQTT topic toggles + DMC Observer removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **PROJECT GIT RULE (overrides TDD default):** `CLAUDE.md` forbids commits unless the user explicitly authorizes them. The `Commit` step in each task is written for completeness. Only run it if the user has authorized commits for this work; otherwise `git add` the files (or leave staged) and move to the next task. Never push/PR without explicit instruction.

**Goal:** Give the `mqtt_community` fanout publisher per-topic `publish_status`/`publish_packets` toggles and a configurable status interval (applied to every community preset), then remove the now-redundant `mqtt_dmc_observer` type entirely.

**Architecture:** The community publisher already emits `status` (retained, hardcoded 300 s) and `packets` (`on_raw`). We add config-driven gates + a clamped interval in the backend, surface two checkboxes + a minutes field in the frontend community editors, and delete the parallel DMC-observer publisher/type. No DB migration; absent keys default to today's behavior. No `raw` topic and no `gps` (raw bytes + RSSI/SNR already ride on `/packets`; live GPS is the separate plan 12).

**Tech Stack:** Python (FastAPI, aiomqtt, pytest), React + TypeScript (Vitest, i18next).

**Spec:** `docs/superpowers/specs/2026-09-11-community-mqtt-topic-toggles-design.md`

---

## File structure

Backend (edit): `app/fanout/community_mqtt.py`, `app/fanout/mqtt_community.py`, `app/routers/fanout.py`, `app/fanout/manager.py`, `app/fanout/AGENTS_fanout.md`.
Backend (delete): `app/fanout/mqtt_dmc_observer.py`, `tests/test_mqtt_dmc_observer.py`.
Backend (edit tests): `tests/test_fanout_integration.py`.
Frontend (edit): `frontend/src/components/settings/SettingsFanoutSection.tsx`, `frontend/src/i18n/locales/{en,nl,de}.json`, `frontend/src/test/fanoutSection.test.tsx`.

---

## Task 1: Router validator — community toggles + interval clamp

**Files:**
- Modify: `app/routers/fanout.py` (`_validate_mqtt_community_config`, ends at line 182)
- Test: `tests/test_fanout_router_community.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_fanout_router_community.py`:

```python
from app.routers.fanout import _validate_mqtt_community_config


def _base() -> dict:
    return {"broker_host": "collector1.dutchmeshcore.nl", "iata": "AMS"}


def test_community_toggles_default_on_and_interval_default():
    cfg = _base()
    _validate_mqtt_community_config(cfg)
    assert cfg["publish_status"] is True
    assert cfg["publish_packets"] is True
    assert cfg["status_interval_ms"] == 300000
    # raw is intentionally NOT part of the community schema
    assert "publish_raw" not in cfg


def test_community_toggles_respect_explicit_false():
    cfg = _base() | {"publish_status": False, "publish_packets": False}
    _validate_mqtt_community_config(cfg)
    assert cfg["publish_status"] is False
    assert cfg["publish_packets"] is False


def test_community_status_interval_clamped_out_of_range():
    for bad in (500, 4_000_000, "nope", None):
        cfg = _base() | {"status_interval_ms": bad}
        _validate_mqtt_community_config(cfg)
        assert cfg["status_interval_ms"] == 300000


def test_community_status_interval_in_range_preserved():
    cfg = _base() | {"status_interval_ms": 600000}
    _validate_mqtt_community_config(cfg)
    assert cfg["status_interval_ms"] == 600000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_fanout_router_community.py -v`
Expected: FAIL (`KeyError: 'publish_status'` — validator does not set these keys yet).

- [ ] **Step 3: Implement the validator additions**

In `app/routers/fanout.py`, in `_validate_mqtt_community_config`, immediately before the final `config["topic_template"] = _normalize_community_topic_template(topic_template)` line (currently line 182), add:

```python
    config["publish_status"] = bool(config.get("publish_status", True))
    config["publish_packets"] = bool(config.get("publish_packets", True))

    interval = config.get("status_interval_ms", 300000)
    if not isinstance(interval, int) or isinstance(interval, bool) or interval < 1000 or interval > 3600000:
        interval = 300000
    config["status_interval_ms"] = interval
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_fanout_router_community.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit** (see PROJECT GIT RULE)

```bash
git add app/routers/fanout.py tests/test_fanout_router_community.py
git commit -m "feat(fanout): validate community mqtt publish toggles + status interval"
```

---

## Task 2: Community publisher — status gate + configurable interval

**Files:**
- Modify: `app/fanout/community_mqtt.py` (protocol lines 54-69; `_publish_status` 450-499; `_on_periodic_wake` 505-510; constant near line 41)
- Test: `tests/test_community_publisher_toggles.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_community_publisher_toggles.py`:

```python
import pytest

from app.fanout import community_mqtt as cm


def test_clamp_status_interval_ms():
    assert cm._clamp_status_interval_ms(600000) == 600000
    assert cm._clamp_status_interval_ms(500) == 300000
    assert cm._clamp_status_interval_ms(9_999_999) == 300000
    assert cm._clamp_status_interval_ms("bad") == 300000
    assert cm._clamp_status_interval_ms(None) == 300000


@pytest.mark.asyncio
async def test_publish_status_skipped_when_disabled(monkeypatch):
    pub = cm.CommunityMqttPublisher()
    published: list = []

    async def fake_publish(topic, payload, **kwargs):  # noqa: ANN001, ANN003
        published.append(topic)

    monkeypatch.setattr(pub, "publish", fake_publish)

    from types import SimpleNamespace

    settings = SimpleNamespace(community_mqtt_publish_status=False, community_mqtt_iata="AMS")
    await pub._publish_status(settings)
    assert published == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_community_publisher_toggles.py -v`
Expected: FAIL (`AttributeError: module ... has no attribute '_clamp_status_interval_ms'`).

- [ ] **Step 3: Add the clamp helper + interval constant note**

In `app/fanout/community_mqtt.py`, just below the existing `_STATS_REFRESH_INTERVAL = 300  # 5 minutes` line (line 41), add:

```python
_STATUS_INTERVAL_DEFAULT_MS = 300000
_STATUS_INTERVAL_MIN_MS = 1000
_STATUS_INTERVAL_MAX_MS = 3600000


def _clamp_status_interval_ms(value: object) -> int:
    """Clamp a status interval to [1000, 3600000] ms, else the 300000 default."""
    if isinstance(value, bool) or not isinstance(value, int):
        return _STATUS_INTERVAL_DEFAULT_MS
    if _STATUS_INTERVAL_MIN_MS <= value <= _STATUS_INTERVAL_MAX_MS:
        return value
    return _STATUS_INTERVAL_DEFAULT_MS
```

- [ ] **Step 4: Extend the settings protocol**

In the `CommunityMqttSettings` Protocol (lines 54-69), add two attributes after `community_mqtt_websocket_path: str`:

```python
    community_mqtt_publish_status: bool
    community_mqtt_status_interval_ms: int
```

- [ ] **Step 5: Gate `_publish_status`**

At the very top of `_publish_status` (right after the docstring, before `from app.keystore import get_public_key`), add:

```python
        if not getattr(settings, "community_mqtt_publish_status", True):
            return
```

- [ ] **Step 6: Use the configurable interval in `_on_periodic_wake`**

Replace the body of `_on_periodic_wake` (lines 505-510) with:

```python
    async def _on_periodic_wake(self, elapsed: float) -> None:
        if not self._settings:
            return
        interval_ms = _clamp_status_interval_ms(
            getattr(self._settings, "community_mqtt_status_interval_ms", _STATUS_INTERVAL_DEFAULT_MS)
        )
        now = time.monotonic()
        if (now - self._last_status_publish) >= (interval_ms / 1000.0):
            await self._publish_status(self._settings, refresh_stats=True)
```

- [ ] **Step 7: Run test to verify it passes**

Run: `python -m pytest tests/test_community_publisher_toggles.py -v`
Expected: PASS (2 passed).

- [ ] **Step 8: Commit** (see PROJECT GIT RULE)

```bash
git add app/fanout/community_mqtt.py tests/test_community_publisher_toggles.py
git commit -m "feat(fanout): community mqtt status toggle + configurable status interval"
```

---

## Task 3: Community module — settings mapping + packets gate

**Files:**
- Modify: `app/fanout/mqtt_community.py` (`_config_to_settings` 49-70; `MqttCommunityModule.on_raw` ~97-100)
- Test: `tests/test_community_module_gating.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_community_module_gating.py`:

```python
import pytest

from app.fanout.mqtt_community import MqttCommunityModule, _config_to_settings


def test_config_to_settings_maps_toggles_and_interval():
    s = _config_to_settings(
        {"publish_status": False, "status_interval_ms": 600000, "iata": "AMS"}
    )
    assert s.community_mqtt_publish_status is False
    assert s.community_mqtt_status_interval_ms == 600000


def test_config_to_settings_defaults():
    s = _config_to_settings({"iata": "AMS"})
    assert s.community_mqtt_publish_status is True
    assert s.community_mqtt_status_interval_ms == 300000


@pytest.mark.asyncio
async def test_on_raw_skips_packets_when_disabled(monkeypatch):
    module = MqttCommunityModule(
        "c1", {"iata": "AMS", "publish_packets": False}, name="c"
    )
    module._publisher.connected = True
    module._publisher._settings = object()  # non-None so on_raw proceeds

    published: list[str] = []

    async def fake_publish(topic, payload, **kwargs):  # noqa: ANN001, ANN003
        published.append(topic)

    monkeypatch.setattr(module._publisher, "publish", fake_publish)
    monkeypatch.setattr("app.keystore.get_public_key", lambda: b"\xaa\xbb")

    from app.services.radio_runtime import radio_runtime
    monkeypatch.setattr(radio_runtime, "meshcore", None, raising=False)

    await module.on_raw({"data": "0a02aabbcc", "snr": 7.0, "rssi": -90})
    assert published == []


@pytest.mark.asyncio
async def test_on_raw_publishes_packets_when_enabled(monkeypatch):
    module = MqttCommunityModule("c2", {"iata": "AMS"}, name="c")  # packets default on
    module._publisher.connected = True
    module._publisher._settings = object()

    published: list[str] = []

    async def fake_publish(topic, payload, **kwargs):  # noqa: ANN001, ANN003
        published.append(topic)

    monkeypatch.setattr(module._publisher, "publish", fake_publish)
    monkeypatch.setattr("app.keystore.get_public_key", lambda: b"\xaa\xbb")

    from app.services.radio_runtime import radio_runtime
    monkeypatch.setattr(radio_runtime, "meshcore", None, raising=False)

    await module.on_raw({"data": "0a02aabbcc", "snr": 7.0, "rssi": -90})
    assert any(t.startswith("meshcore/AMS/") and t.endswith("/packets") for t in published)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_community_module_gating.py -v`
Expected: FAIL (`AttributeError: ... community_mqtt_publish_status` on the settings namespace, and the disabled case publishes a packet).

- [ ] **Step 3: Map the new settings fields**

In `app/fanout/mqtt_community.py` `_config_to_settings`, add two entries before the closing `)` of the `SimpleNamespace(...)` (after `community_mqtt_websocket_path=...`):

```python
        community_mqtt_publish_status=config.get("publish_status", True),
        community_mqtt_status_interval_ms=config.get("status_interval_ms", 300000),
```

- [ ] **Step 4: Gate packets in `on_raw`**

Replace `MqttCommunityModule.on_raw` (the method currently calling `_publish_community_packet`) with:

```python
    async def on_raw(self, data: dict) -> None:
        if not self._publisher.connected or self._publisher._settings is None:
            return
        if not self.config.get("publish_packets", True):
            return
        await _publish_community_packet(self._publisher, self.config, data)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_community_module_gating.py -v`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit** (see PROJECT GIT RULE)

```bash
git add app/fanout/mqtt_community.py tests/test_community_module_gating.py
git commit -m "feat(fanout): community module maps status toggle/interval and gates packets"
```

---

## Task 4: Remove the DMC Observer type (backend)

**Files:**
- Delete: `app/fanout/mqtt_dmc_observer.py`, `tests/test_mqtt_dmc_observer.py`
- Modify: `app/fanout/manager.py` (lines 34, 42), `app/routers/fanout.py` (lines 22, 99-100, 185-236, 424-425), `tests/test_fanout_integration.py` (lines 2019-2068)

- [ ] **Step 1: Delete the module and its unit test**

```bash
git rm app/fanout/mqtt_dmc_observer.py tests/test_mqtt_dmc_observer.py
```

- [ ] **Step 2: Unregister in `manager.py`**

Remove line 34 (`from app.fanout.mqtt_dmc_observer import DmcObserverModule`) and line 42 (`_MODULE_TYPES["mqtt_dmc_observer"] = DmcObserverModule`).

- [ ] **Step 3: Strip router wiring in `fanout.py`**

- Remove `"mqtt_dmc_observer",` from `_VALID_TYPES` (line 22).
- Remove the dispatch branch (lines 99-100):
  ```python
      elif config_type == "mqtt_dmc_observer":
          _validate_dmc_observer_config(normalized)
  ```
- Delete the entire `_validate_dmc_observer_config` function (lines 185-236).
- Remove the `_enforce_scope` branch (lines 424-425):
  ```python
      if config_type == "mqtt_dmc_observer":
          return {"messages": "none", "raw_packets": "all"}
  ```

- [ ] **Step 4: Remove DMC cases from the integration test**

In `tests/test_fanout_integration.py`, delete both async tests `test_dmc_observer_dispatch_via_manager` (starts line 2019) and `test_dmc_observer_raw_off_by_default` (line 2048) through line 2068, including the `@pytest.mark.asyncio` decorator directly above each.

- [ ] **Step 5: Verify no references remain**

Run: `grep -rn "mqtt_dmc_observer\|DmcObserver\|dmc_observer" app/ tests/`
Expected: no matches (empty output).

- [ ] **Step 6: Run the affected suites**

Run: `python -m pytest tests/test_fanout_integration.py tests/test_fanout_router_community.py -q`
Expected: PASS (DMC tests gone; community tests pass). Pre-existing Windows env failures in `test_mqtt`/other files are unrelated (project memory).

- [ ] **Step 7: Commit** (see PROJECT GIT RULE)

```bash
git add -A
git commit -m "refactor(fanout): remove redundant mqtt_dmc_observer type"
```

---

## Task 5: Frontend — remove DMC type/editor, add community topic controls

**Files:**
- Modify: `frontend/src/components/settings/SettingsFanoutSection.tsx`

- [ ] **Step 1: Remove `mqtt_dmc_observer` from the `DraftType` union**

Delete the line `  | 'mqtt_dmc_observer'` (line 150).

- [ ] **Step 2: Remove the generic DMC create-definition**

Delete the whole definition object with `value: 'mqtt_dmc_observer'` (lines 334-363, the `{ ... }` entry ending just before the `webhook` entry).

- [ ] **Step 3: Add topic-toggle defaults to community presets**

In `createCommunityConfigDefaults` (lines 65-83), add three keys to the returned object (before the `...overrides` spread so presets/overrides can still win):

```javascript
    publish_status: true,
    publish_packets: true,
    status_interval_ms: 300000,
```

Then, in the generic `mqtt_dmc_observer`... (already removed) — confirm the three DMC-community presets (`mqtt_community_dmc1`, `_dmc2`, `_meshcore_analyzer_eu`) and letsmesh presets all build their config via `createCommunityConfigDefaults(...)`, so they now inherit the three keys automatically. No per-preset edit needed.

- [ ] **Step 4: Normalize toggles + interval on save**

In `normalizeIntegrationConfigForSave`, inside the `if (configType === 'mqtt_community') {` block (after the existing `topic_template` normalization, before the block closes near line 517), add:

```javascript
    normalized.publish_status = normalized.publish_status !== false;
    normalized.publish_packets = normalized.publish_packets !== false;
    const interval =
      typeof normalized.status_interval_ms === 'string'
        ? Number.parseInt(normalized.status_interval_ms, 10)
        : Number(normalized.status_interval_ms);
    normalized.status_interval_ms =
      Number.isFinite(interval) && interval >= 1000 && interval <= 3600000 ? interval : 300000;
```

- [ ] **Step 5: Add the shared `CommunityTopicControls` component**

Add this component immediately above `function MqttCommunityConfigEditor(` (line 1695):

```tsx
function CommunityTopicControls({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const t = useT();
  const intervalMinutes = (() => {
    const ms = Number(config.status_interval_ms);
    if (!Number.isFinite(ms) || ms <= 0) return 5;
    return Math.round(ms / 60000);
  })();

  return (
    <div className="space-y-2">
      <Separator />
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={config.publish_status !== false}
          onChange={(e) => onChange({ ...config, publish_status: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm">{t('settings_fanout_publish_status')}</span>
      </label>
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={config.publish_packets !== false}
          onChange={(e) => onChange({ ...config, publish_packets: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm">{t('settings_fanout_publish_packets')}</span>
      </label>
      <div className="space-y-2">
        <Label htmlFor="fanout-comm-interval">{t('settings_fanout_status_interval_min')}</Label>
        <Input
          id="fanout-comm-interval"
          type="number"
          min="1"
          max="60"
          className="w-32"
          value={intervalMinutes}
          onChange={(e) => {
            const m = Number.parseInt(e.target.value, 10);
            const clamped = Number.isNaN(m) ? 5 : Math.min(60, Math.max(1, m));
            onChange({ ...config, status_interval_ms: clamped * 60000 });
          }}
        />
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_status_interval_help')}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Render the controls in `MqttCommunityConfigEditor`**

In `MqttCommunityConfigEditor`, add `<CommunityTopicControls config={config} onChange={onChange} />` immediately before the final closing `</div>` of its returned JSX (after the topic-template block, i.e. after line 1910).

- [ ] **Step 7: Render the controls in `LetsMeshConfigEditor`**

In `LetsMeshConfigEditor`, add `<CommunityTopicControls config={config} onChange={onChange} />` immediately before the closing `</div>` of its returned JSX (after the email/IATA grid, i.e. after line 2254).

- [ ] **Step 8: Remove `MqttDmcObserverConfigEditor` and its render branch**

- Delete the entire `function MqttDmcObserverConfigEditor(` component (starts line 1915; ends at its matching closing brace before the next `function`).
- Delete the detail-render branch (lines 3802-3804):
  ```tsx
        {detailType === 'mqtt_dmc_observer' && (
          <MqttDmcObserverConfigEditor config={editConfig} onChange={setEditConfig} />
        )}
  ```

- [ ] **Step 9: Verify no references remain + typecheck**

Run: `cd frontend && grep -rn "mqtt_dmc_observer\|MqttDmcObserverConfigEditor\|settings_fanout_dmc" src/ && npx tsc -p tsconfig.json --noEmit`
Expected: grep finds nothing (empty); `tsc` prints no errors.

- [ ] **Step 10: Commit** (see PROJECT GIT RULE)

```bash
git add frontend/src/components/settings/SettingsFanoutSection.tsx
git commit -m "feat(settings): community mqtt topic toggles; remove dmc observer type"
```

---

## Task 6: Frontend i18n — remove DMC keys, add community keys, reword presets

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

- [ ] **Step 1: Remove the 8 DMC-observer keys in all three locales**

Delete these keys (en.json lines 917-924; the parallel lines in nl.json 918-925 and de.json 918-925):
`settings_fanout_type_dmc_observer`, `settings_fanout_desc_dmc_observer`,
`settings_fanout_dmc_observer_desc`, `settings_fanout_dmc_publish_status`,
`settings_fanout_dmc_publish_packets`, `settings_fanout_dmc_publish_raw`,
`settings_fanout_dmc_status_interval_min`, `settings_fanout_dmc_status_interval_help`.

- [ ] **Step 2: Add community topic-control keys**

Add these keys in the same `settings_fanout_*` area of each locale.

en.json:
```json
  "settings_fanout_publish_status": "Publish status",
  "settings_fanout_publish_packets": "Publish packets",
  "settings_fanout_status_interval_min": "Status interval (minutes)",
  "settings_fanout_status_interval_help": "How often the status message is published (1-60 minutes).",
```
nl.json:
```json
  "settings_fanout_publish_status": "Status publiceren",
  "settings_fanout_publish_packets": "Pakketten publiceren",
  "settings_fanout_status_interval_min": "Statusinterval (minuten)",
  "settings_fanout_status_interval_help": "Hoe vaak het statusbericht wordt gepubliceerd (1-60 minuten).",
```
de.json:
```json
  "settings_fanout_publish_status": "Status veröffentlichen",
  "settings_fanout_publish_packets": "Pakete veröffentlichen",
  "settings_fanout_status_interval_min": "Statusintervall (Minuten)",
  "settings_fanout_status_interval_help": "Wie oft die Statusnachricht veröffentlicht wird (1-60 Minuten).",
```

- [ ] **Step 3: Reword the three preset descriptions**

Replace the values of `settings_fanout_desc_dmc1`, `settings_fanout_desc_dmc2`, `settings_fanout_desc_meshcore_analyzer_eu` in each locale to mention the toggles. en.json examples:
```json
  "settings_fanout_desc_dmc1": "Community MQTT preconfigured for the Dutch MeshCore collector 1 endpoint, requiring only your email and IATA region code. Includes per-topic publish toggles (status, packets) and a configurable status interval; you can edit all configuration after creation.",
  "settings_fanout_desc_dmc2": "Community MQTT preconfigured for the Dutch MeshCore collector 2 endpoint, requiring only your email and IATA region code. Includes per-topic publish toggles (status, packets) and a configurable status interval; you can edit all configuration after creation.",
  "settings_fanout_desc_meshcore_analyzer_eu": "Community MQTT preconfigured for the MeshCore Analyzer EU endpoint (mqtt.meshcore-analyzer.eu), requiring only your email and IATA region code. Includes per-topic publish toggles (status, packets) and a configurable status interval; you can edit all configuration after creation.",
```
Provide equivalent NL/DE rewordings in the respective files (translate the added "Includes per-topic publish toggles ... interval" sentence; keep the existing NL/DE lead-in).

- [ ] **Step 4: Verify JSON validity + parity**

Run: `cd frontend && node -e "for(const l of ['en','nl','de'])JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'.json'))" && npx vitest run src/test/i18nParity`
Expected: no JSON error; the i18n parity test (whatever its file name — find with `grep -rl parity src/test`) passes. If the parity spec path differs, run `npx vitest run` and confirm the parity test is green.

- [ ] **Step 5: Commit** (see PROJECT GIT RULE)

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "i18n(fanout): community topic-toggle strings; drop dmc observer keys"
```

---

## Task 7: Frontend tests — presets, remove DMC creation tests, add toggle round-trip

**Files:**
- Modify: `frontend/src/test/fanoutSection.test.tsx`

- [ ] **Step 1: Update the DMC-1 / DMC-2 / analyzer preset expectations**

In each of the three preset tests (`DMC-1 preset ...` line 1382, `DMC-2 preset ...` line 1449, `MeshCore Analyzer (EU) preset ...` line 1512), add the three new keys to BOTH the `createdConfig.config` object and the `createFanoutConfig` expected `config` object:

```javascript
        publish_status: true,
        publish_packets: true,
        status_interval_ms: 300000,
```

(Insert alongside the existing `topic_template` line in each object.)

- [ ] **Step 2: Remove the two generic DMC Observer creation tests**

Delete `it('creates DMC Observer with raw off ...')` (line 1717) and `it('maps the DMC status interval minutes field to milliseconds', ...)` (line 1757) through the closing `});` at line 1789.

- [ ] **Step 3: Add a community toggle round-trip test**

Add this test inside the same `describe` block that holds the preset tests (e.g. after the analyzer preset test at line 1573):

```javascript
  it('community preset topic controls round-trip toggles and interval', async () => {
    const created: FanoutConfig = {
      id: 'comm-toggle',
      type: 'mqtt_community',
      name: 'DMC-1',
      enabled: true,
      config: {},
      scope: { messages: 'none', raw_packets: 'all' },
      sort_order: 0,
      created_at: 4000,
    };
    mockedApi.createFanoutConfig.mockResolvedValue(created);
    mockedApi.getFanoutConfigs.mockResolvedValueOnce([]).mockResolvedValueOnce([created]);

    renderSection();
    await openCreateIntegrationDialog();
    selectCreateIntegration('DMC-1');
    confirmCreateIntegration();
    await waitFor(() => expect(screen.getByText('← Back to list')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('Region Code (IATA)'), { target: { value: 'ams' } });
    fireEvent.click(screen.getByLabelText('Publish packets')); // toggle OFF
    fireEvent.change(screen.getByLabelText('Status interval (minutes)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as Enabled' }));

    await waitFor(() =>
      expect(mockedApi.createFanoutConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mqtt_community',
          config: expect.objectContaining({
            publish_status: true,
            publish_packets: false,
            status_interval_ms: 600000,
          }),
        })
      )
    );
  });
```

> Note: `Publish packets` and `Status interval (minutes)` are the resolved EN strings for the new i18n keys; the checkbox is labelled via the `<span>` text inside its `<label>`, matching how existing checkbox queries in this file work. If `getByLabelText` does not resolve the checkbox, switch to `screen.getByText('Publish packets')` and click it, mirroring the nearest existing checkbox assertion in this test file.

- [ ] **Step 4: Run the frontend test file**

Run: `cd frontend && npx vitest run src/test/fanoutSection.test.tsx --testTimeout=30000`
Expected: PASS (all tests in the file green).

- [ ] **Step 5: Commit** (see PROJECT GIT RULE)

```bash
git add frontend/src/test/fanoutSection.test.tsx
git commit -m "test(settings): community topic toggles; drop dmc observer creation tests"
```

---

## Task 8: Docs — AGENTS_fanout.md

**Files:**
- Modify: `app/fanout/AGENTS_fanout.md`

- [ ] **Step 1: Remove the DMC observer section**

Delete the `### mqtt_dmc_observer (mqtt_dmc_observer.py)` section (around line 117) and the `- app/fanout/community_mqtt.py ... DmcObserverPublisher` reference (line 380 mentions it; reword to drop the DMC subclass mention).

- [ ] **Step 2: Document the community toggles**

In the `mqtt_community` section (around line 111, "Wraps `CommunityMqttPublisher` ... Config blob:"), add to the documented config keys:

```markdown
- `publish_status` (bool, default `true`) — gate the retained `status` topic
- `publish_packets` (bool, default `true`) — gate the `packets` topic
- `status_interval_ms` (int, default `300000`, clamped `[1000, 3600000]`) — status republish cadence
```

- [ ] **Step 3: Verify no DMC references remain in the doc**

Run: `grep -n "dmc_observer\|DmcObserver" app/fanout/AGENTS_fanout.md`
Expected: no matches.

- [ ] **Step 4: Commit** (see PROJECT GIT RULE)

```bash
git add app/fanout/AGENTS_fanout.md
git commit -m "docs(fanout): document community topic toggles; drop dmc observer"
```

---

## Task 9: Full verification

- [ ] **Step 1: Backend suites**

Run: `python -m pytest tests/test_fanout_integration.py tests/test_fanout_router_community.py tests/test_community_publisher_toggles.py tests/test_community_module_gating.py -q`
Expected: all green. (The ~14 known Windows env failures live in other files, e.g. `test_mqtt`; not in scope.)

- [ ] **Step 2: Grep for stragglers (repo-wide, excluding historical specs/plans)**

Run: `grep -rn "mqtt_dmc_observer\|DmcObserver" app/ frontend/src/ tests/`
Expected: no matches.

- [ ] **Step 3: Frontend lint + types + tests**

Run: `cd frontend && npm run lint && npx tsc -p tsconfig.json --noEmit && npx vitest run --testTimeout=30000`
Expected: lint 0 errors, tsc 0 errors, vitest green.

- [ ] **Step 4: Report results**

Paste the command outputs (Steps 1-3). Do not claim "done" without them. Mark any live-broker behavior (topics appearing, cadence) as NOT VERIFIED unless actually observed against a broker.

---

## Self-review notes (author)

- Spec coverage: D1 (Tasks 1-3), D2 (Task 5 Step 3 via `createCommunityConfigDefaults`), D3 (no migration task — intentional), D4 (`Z` timestamp untouched; no timestamp edits), D5 (no raw anywhere; Task 1 test asserts `publish_raw` absent), D6 (no gps task), D7 (Task 4). All covered.
- Type/name consistency: backend `_clamp_status_interval_ms`, settings attrs `community_mqtt_publish_status` / `community_mqtt_status_interval_ms`, config keys `publish_status`/`publish_packets`/`status_interval_ms`, i18n keys `settings_fanout_publish_status`/`_publish_packets`/`_status_interval_min`/`_status_interval_help`, component `CommunityTopicControls` — used identically across tasks.
- Placeholder scan: line numbers cited are from the pre-change file and may drift as edits land; treat them as anchors, confirm the surrounding code snippet before editing.
