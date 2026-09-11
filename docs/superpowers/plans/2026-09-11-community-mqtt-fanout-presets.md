# Community MQTT Fanout Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the six hardcoded community-MQTT preset `DraftType`s with one data-driven preset table, surfaced as a searchable, region-grouped preset picker inside the generic `MqttCommunityConfigEditor`, covering all 37 brokers from the Dutch-MeshCore `MQTTPresets.h` list (36 upstream + `bsmesh`).

**Architecture:** A new frontend data module (`communityMqttPresets.ts`) holds the 37 parsed presets and two pure helpers (`applyPresetToConfig`, `detectPresetId`). `MqttCommunityConfigEditor` gains a grouped `<select>` at the top; choosing a preset stamps its fields into the existing `config` via `onChange`, and the field inputs below stay editable. The six specialized community `DraftType`s and their draft-only editors (`LetsMeshConfigEditor`, `MeshRankConfigEditor`) are removed; only the generic `mqtt_community` type remains in the create dialog. The backend gains a `{pubkey}` username substitution for the one preset (`mesh-chaun14`) that needs the radio public key as its MQTT username.

**Tech Stack:** React + TypeScript (Vitest + Testing Library), FastAPI + aiomqtt (pytest), i18next (EN/NL/DE with an enforced parity test).

**Source of truth:** `https://github.com/Dutch-MeshCore/MeshCore/blob/dmc-observer-dev-1171-regiongating/src/helpers/MQTTPresets.h`

---

## Known risks / NOT VERIFIED (read before starting)

1. **`mesh-chaun14` username case.** Firmware sends `_device_id` (the 64-char device public-key hex) as the MQTT username for `{pubkey}` presets (`src/helpers/bridges/MQTTBridge.cpp:1901`, `user = _device_id; // never send "{pubkey}" literally`). The firmware does not visibly transform the case. This plan substitutes the radio public key as **lowercase** hex (`get_public_key().hex()`), matching standard hex identity encoding. If `mqtt.mesh.chaun14.fr` rejects auth, flipping to `.upper()` is the first thing to try. This is the single unverified detail; it affects one French community broker only.
2. **MeshRank payload format.** `meshrank` uses `topic_style = MESHRANK`, a different payload shape than the meshcore-packet-capture format. The repo's **existing** MeshRank support already reuses the meshcore format and requires a user-provided topic template; this plan preserves that behavior unchanged. Whether `meshrank.net` accepts the meshcore payload is NOT VERIFIED and is out of scope (pre-existing behavior).
3. **Fields the backend ignores.** The DMC header carries `ca_cert` (pinned root), `keepalive`, `allow_retain`, and `token_lifetime`. This repo's backend uses the system trust store, a fixed 3300s JWT, and decides retain per message. These preset fields are intentionally **not** modeled — presets only carry what `_config_to_settings` (`app/fanout/mqtt_community.py:50`) consumes.

## Preset → config field mapping rules

- `wss://host:port/path` → `transport: 'websockets'`, `use_tls: true`, `broker_port: port`, `websocket_path: path || '/'`
- `mqtts://host:port` → `transport: 'tcp'`, `use_tls: true`, `broker_port: port`
- `mqtt://host:port` → `transport: 'tcp'`, `use_tls: false`, `broker_port: port`
- `JWT` → `auth_mode: 'token'`, `token_audience: <jwt_audience>`
- `NONE` → `auth_mode: 'none'`
- `USERPASS` → `auth_mode: 'password'` (+ embedded `username`/`password` when the header ships them)
- All presets: `tls_verify: true`, `topic_template: 'meshcore/{IATA}/{PUBLIC_KEY}/packets'` except MeshRank (`''`, user must supply)

---

## File Structure

- **Create** `frontend/src/components/settings/communityMqttPresets.ts` — preset type, 37-entry table, region grouping, `applyPresetToConfig`, `detectPresetId`.
- **Create** `frontend/src/test/communityMqttPresets.test.ts` — unit tests for the table + helpers.
- **Modify** `frontend/src/components/settings/SettingsFanoutSection.tsx` — add picker to `MqttCommunityConfigEditor` (~1709); remove 6 `DraftType`s (143-157), their definitions (232-335), `normalizeDraftConfig` branches (546-618), JSX editor cases (3590-3632), and the now-unused `LetsMeshConfigEditor`/`MeshRankConfigEditor` components + unused `DEFAULT_*` constants.
- **Modify** `frontend/src/test/fanoutSection.test.tsx` — rewrite the 6 preset suites to drive the in-editor picker.
- **Modify** `frontend/src/i18n/locales/{en,nl,de}.json` — add picker/region/custom/credential-note keys; remove the 12 now-unused `settings_fanout_type_*` / `settings_fanout_desc_*` preset keys.
- **Modify** `app/fanout/community_mqtt.py` — `{pubkey}` username substitution in `_build_client_kwargs` (~362).
- **Modify** `tests/test_community_mqtt.py` — test for the substitution.
- **Modify** `changelog-DMC-EV.md` — one-line entry.

---

## Task 1: Backend `{pubkey}` username substitution

**Files:**
- Modify: `app/fanout/community_mqtt.py:362-367` (the `auth_mode == "password"` branch of `_build_client_kwargs`)
- Test: `tests/test_community_mqtt.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_community_mqtt.py` (match the file's existing fixture/style for building a settings namespace and calling `_build_client_kwargs`; if the existing tests use a helper to build settings, reuse it):

```python
def test_build_client_kwargs_substitutes_pubkey_username(monkeypatch):
    from types import SimpleNamespace
    from app.fanout.community_mqtt import CommunityMqttPublisher
    from app import keystore

    pub = bytes(range(32))
    monkeypatch.setattr(keystore, "get_public_key", lambda: pub)
    monkeypatch.setattr(keystore, "get_private_key", lambda: None)

    settings = SimpleNamespace(
        community_mqtt_enabled=True,
        community_mqtt_broker_host="mqtt.mesh.chaun14.fr",
        community_mqtt_broker_port=1884,
        community_mqtt_transport="tcp",
        community_mqtt_use_tls=False,
        community_mqtt_tls_verify=True,
        community_mqtt_auth_mode="password",
        community_mqtt_username="{pubkey}",
        community_mqtt_password="",
        community_mqtt_iata="",
        community_mqtt_email="",
        community_mqtt_token_audience="",
        community_mqtt_websocket_path="/",
        community_mqtt_publish_status=True,
        community_mqtt_status_interval_ms=300000,
    )
    pub_obj = CommunityMqttPublisher()
    kwargs = pub_obj._build_client_kwargs(settings)
    assert kwargs["username"] == pub.hex()
    assert kwargs["username"] != "{pubkey}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. uv run pytest tests/test_community_mqtt.py::test_build_client_kwargs_substitutes_pubkey_username -v`
Expected: FAIL — `username` equals the literal `{pubkey}`.

- [ ] **Step 3: Write minimal implementation**

In `app/fanout/community_mqtt.py`, replace the password branch (currently lines 362-364):

```python
        elif auth_mode == "password":
            username = s.community_mqtt_username or None
            if username == "{pubkey}":
                # MeshCore presets (e.g. mesh-chaun14) use the radio public key
                # hex as the MQTT username; firmware sends its _device_id here.
                username = public_key.hex()
            kwargs["username"] = username
            kwargs["password"] = s.community_mqtt_password or None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. uv run pytest tests/test_community_mqtt.py::test_build_client_kwargs_substitutes_pubkey_username -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/fanout/community_mqtt.py tests/test_community_mqtt.py
git commit -m "feat(community-mqtt): substitute {pubkey} username with radio public key"
```

---

## Task 2: Frontend preset data module

**Files:**
- Create: `frontend/src/components/settings/communityMqttPresets.ts`
- Test: `frontend/src/test/communityMqttPresets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/communityMqttPresets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  COMMUNITY_MQTT_PRESETS,
  applyPresetToConfig,
  detectPresetId,
  CUSTOM_PRESET_ID,
} from '../components/settings/communityMqttPresets';

describe('communityMqttPresets', () => {
  it('contains 37 presets with unique ids', () => {
    expect(COMMUNITY_MQTT_PRESETS).toHaveLength(37);
    const ids = COMMUNITY_MQTT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(37);
  });

  it('parses a wss JWT preset into websockets + tls + token', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'bsmesh')!;
    const cfg = applyPresetToConfig({}, p);
    expect(cfg).toMatchObject({
      broker_host: 'mqtt.bsmesh.de',
      broker_port: 8885,
      transport: 'websockets',
      use_tls: true,
      tls_verify: true,
      auth_mode: 'token',
      token_audience: 'mqtt.bsmesh.de',
      websocket_path: '/',
    });
  });

  it('parses a mqtt USERPASS preset with embedded credentials', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'tennmesh')!;
    const cfg = applyPresetToConfig({}, p);
    expect(cfg).toMatchObject({
      broker_host: 'mqtt.tennmesh.com',
      broker_port: 1883,
      transport: 'tcp',
      use_tls: false,
      auth_mode: 'password',
      username: 'mqttfeed',
      password: 'tc2live',
    });
  });

  it('carries the {pubkey} sentinel for mesh-chaun14', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'mesh-chaun14')!;
    expect(applyPresetToConfig({}, p).username).toBe('{pubkey}');
  });

  it('leaves topic_template blank for meshrank and flags it required', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'meshrank')!;
    expect(p.requiresTopicTemplate).toBe(true);
    expect(applyPresetToConfig({}, p).topic_template).toBe('');
  });

  it('preserves user-entered iata/email/topic_template when applying a preset', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'analyzer-eu')!;
    const cfg = applyPresetToConfig({ iata: 'AMS', email: 'a@b.c' }, p);
    expect(cfg.iata).toBe('AMS');
    expect(cfg.email).toBe('a@b.c');
  });

  it('round-trips detectPresetId for a stamped config', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'dutchmeshcore-1')!;
    expect(detectPresetId(applyPresetToConfig({}, p))).toBe('dutchmeshcore-1');
  });

  it('returns CUSTOM_PRESET_ID for an unrecognized config', () => {
    expect(detectPresetId({ broker_host: 'example.invalid', broker_port: 12345 })).toBe(
      CUSTOM_PRESET_ID
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/communityMqttPresets.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the module**

Create `frontend/src/components/settings/communityMqttPresets.ts`:

```ts
export const CUSTOM_PRESET_ID = 'custom';

export type CommunityPresetRegion = 'europe' | 'north_america' | 'oceania' | 'other';

export interface CommunityMqttPreset {
  id: string;
  region: CommunityPresetRegion;
  brokerHost: string;
  brokerPort: number;
  transport: 'websockets' | 'tcp';
  useTls: boolean;
  authMode: 'token' | 'none' | 'password';
  tokenAudience?: string;
  websocketPath?: string;
  username?: string;
  password?: string;
  pubkeyUsername?: boolean;
  requiresTopicTemplate?: boolean;
  hasEmbeddedCredentials?: boolean;
  needsBackendSubstitution?: boolean;
}

const MESHCORE_TOPIC = 'meshcore/{IATA}/{PUBLIC_KEY}/packets';

export const COMMUNITY_MQTT_PRESETS: readonly CommunityMqttPreset[] = [
  { id: 'analyzer-us', region: 'north_america', brokerHost: 'mqtt-us-v1.letsmesh.net', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt-us-v1.letsmesh.net', websocketPath: '/mqtt' },
  { id: 'analyzer-eu', region: 'europe', brokerHost: 'mqtt-eu-v1.letsmesh.net', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt-eu-v1.letsmesh.net', websocketPath: '/mqtt' },
  { id: 'nz-analyzer', region: 'oceania', brokerHost: 'meshcore-mqtt-1.baird.io', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'meshcore-mqtt-1.baird.io', websocketPath: '/' },
  { id: 'meshmapper', region: 'other', brokerHost: 'mqtt.meshmapper.net', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.meshmapper.net', websocketPath: '/mqtt' },
  { id: 'meshrank', region: 'other', brokerHost: 'meshrank.net', brokerPort: 8883, transport: 'tcp', useTls: true, authMode: 'none', requiresTopicTemplate: true },
  { id: 'waev', region: 'other', brokerHost: 'mqtt.waev.app', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.waev.app', websocketPath: '/mqtt' },
  { id: 'meshomatic', region: 'north_america', brokerHost: 'us-east.meshomatic.net', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'us-east.meshomatic.net', websocketPath: '/mqtt' },
  { id: 'cascadiamesh', region: 'north_america', brokerHost: 'mqtt-v1.cascadiamesh.org', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt-v1.cascadiamesh.org', websocketPath: '/mqtt' },
  { id: 'tennmesh', region: 'north_america', brokerHost: 'mqtt.tennmesh.com', brokerPort: 1883, transport: 'tcp', useTls: false, authMode: 'password', username: 'mqttfeed', password: 'tc2live', hasEmbeddedCredentials: true },
  { id: 'nashmesh', region: 'north_america', brokerHost: 'mqtt.nashme.sh', brokerPort: 1883, transport: 'tcp', useTls: false, authMode: 'password', username: 'meshdev', password: 'large4cats', hasEmbeddedCredentials: true },
  { id: 'ctmesh', region: 'north_america', brokerHost: 'mqtt.ctmesh.org', brokerPort: 1883, transport: 'tcp', useTls: false, authMode: 'password', username: 'meshdev', password: 'large4cats', hasEmbeddedCredentials: true },
  { id: 'chimesh', region: 'north_america', brokerHost: 'mqtt.chimesh.org', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.chimesh.org', websocketPath: '/' },
  { id: 'meshat.se', region: 'europe', brokerHost: 'meshcore-mqtt.meshat.se', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'meshcore-mqtt.meshat.se', websocketPath: '/' },
  { id: 'eastidahomesh', region: 'north_america', brokerHost: 'live.eastidahomesh.com', brokerPort: 1883, transport: 'tcp', useTls: false, authMode: 'none' },
  { id: 'coloradomesh', region: 'north_america', brokerHost: 'mqtt.meshcore.coloradomesh.org', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.meshcore.coloradomesh.org', websocketPath: '/' },
  { id: 'dutchmeshcore-1', region: 'europe', brokerHost: 'collector1.dutchmeshcore.nl', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'collector1.dutchmeshcore.nl', websocketPath: '/mqtt' },
  { id: 'dutchmeshcore-2', region: 'europe', brokerHost: 'collector2.dutchmeshcore.nl', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'collector2.dutchmeshcore.nl', websocketPath: '/mqtt' },
  { id: 'meshcore-analyzer-eu', region: 'europe', brokerHost: 'mqtt.meshcore-analyzer.eu', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.meshcore-analyzer.eu', websocketPath: '/' },
  { id: 'meshcore-ca-1', region: 'north_america', brokerHost: 'mqtt1.meshcore.ca', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt1.meshcore.ca', websocketPath: '/mqtt' },
  { id: 'meshcore-ca-2', region: 'north_america', brokerHost: 'mqtt2.meshcore.ca', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt2.meshcore.ca', websocketPath: '/mqtt' },
  { id: 'meshcore-fi', region: 'europe', brokerHost: 'mc-mqtt.meshcore.fi', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mc-mqtt.meshcore.fi', websocketPath: '/' },
  { id: 'okimesh-1', region: 'north_america', brokerHost: 'mqtt1.okimesh.org', brokerPort: 9002, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt1.okimesh.org', websocketPath: '/mqtt' },
  { id: 'okimesh-2', region: 'north_america', brokerHost: 'mqtt2.okimesh.org', brokerPort: 9002, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt2.okimesh.org', websocketPath: '/mqtt' },
  { id: 'inwmesh', region: 'other', brokerHost: 'scope.inwmesh.org', brokerPort: 8883, transport: 'tcp', useTls: true, authMode: 'password' },
  { id: 'bostonmesh', region: 'north_america', brokerHost: 'mqttmc01.bostonme.sh', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqttmc01.bostonme.sh', websocketPath: '/mqtt' },
  { id: 'rflab', region: 'other', brokerHost: 'mqtt.rflab.io', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.rflab.io', websocketPath: '/' },
  { id: 'ipnt.uk', region: 'europe', brokerHost: 'mqtt.ipnt.uk', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.ipnt.uk', websocketPath: '/' },
  { id: 'flmesh', region: 'north_america', brokerHost: 'mcmqtt.jntconnections.com', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mcmqtt.jntconnections.com', websocketPath: '/' },
  { id: 'corecomms', region: 'other', brokerHost: 'mqtt.corecomms.net', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.corecomms.net', websocketPath: '/mqtt' },
  { id: 'meshtexas', region: 'north_america', brokerHost: 'mqtt.meshtexas.org', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.meshtexas.org', websocketPath: '/mqtt' },
  { id: 'mesh-chaun14', region: 'europe', brokerHost: 'mqtt.mesh.chaun14.fr', brokerPort: 1884, transport: 'tcp', useTls: false, authMode: 'password', username: '{pubkey}', pubkeyUsername: true, needsBackendSubstitution: true },
  { id: 'wcmesh', region: 'north_america', brokerHost: 'mqtt.wcmesh.com', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.wcmesh.com', websocketPath: '/' },
  { id: 'atvirastinklas', region: 'europe', brokerHost: 'mqtt-mc.atvirastinklas.lt', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt-mc.atvirastinklas.lt', websocketPath: '/' },
  { id: 'gomesh', region: 'other', brokerHost: 'mqtt.gomesh.dev', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.gomesh.dev', websocketPath: '/' },
  { id: 'idahomesh', region: 'north_america', brokerHost: 'mqtt.idahomesh.org', brokerPort: 443, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.idahomesh.org', websocketPath: '/mqtt' },
  { id: 'ntxmesh', region: 'north_america', brokerHost: 'ntxmesh.dhovin.me', brokerPort: 8883, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'ntxmesh.dhovin.me', websocketPath: '/' },
  { id: 'bsmesh', region: 'europe', brokerHost: 'mqtt.bsmesh.de', brokerPort: 8885, transport: 'websockets', useTls: true, authMode: 'token', tokenAudience: 'mqtt.bsmesh.de', websocketPath: '/' },
];

export const REGION_ORDER: readonly CommunityPresetRegion[] = [
  'europe',
  'north_america',
  'oceania',
  'other',
];

export function applyPresetToConfig(
  config: Record<string, unknown>,
  preset: CommunityMqttPreset
): Record<string, unknown> {
  return {
    ...config,
    broker_host: preset.brokerHost,
    broker_port: preset.brokerPort,
    transport: preset.transport,
    use_tls: preset.useTls,
    tls_verify: true,
    auth_mode: preset.authMode,
    token_audience: preset.authMode === 'token' ? (preset.tokenAudience ?? preset.brokerHost) : '',
    websocket_path: preset.transport === 'websockets' ? (preset.websocketPath ?? '/') : '/',
    username: preset.authMode === 'password' ? (preset.username ?? '') : '',
    password: preset.authMode === 'password' ? (preset.password ?? '') : '',
    topic_template: preset.requiresTopicTemplate
      ? ''
      : (config.topic_template as string | undefined) || MESHCORE_TOPIC,
  };
}

export function detectPresetId(config: Record<string, unknown>): string {
  const host = String(config.broker_host ?? '');
  const port = Number(config.broker_port);
  const match = COMMUNITY_MQTT_PRESETS.find(
    (p) =>
      p.brokerHost === host &&
      p.brokerPort === port &&
      p.transport === ((config.transport as string) || 'websockets') &&
      p.authMode === ((config.auth_mode as string) || 'token')
  );
  return match ? match.id : CUSTOM_PRESET_ID;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:run -- src/test/communityMqttPresets.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/communityMqttPresets.ts frontend/src/test/communityMqttPresets.test.ts
git commit -m "feat(fanout): add data-driven community MQTT preset table"
```

---

## Task 3: Preset picker inside `MqttCommunityConfigEditor`

**Files:**
- Modify: `frontend/src/components/settings/SettingsFanoutSection.tsx` (`MqttCommunityConfigEditor`, 1709-1929)
- Test: `frontend/src/test/fanoutSection.test.tsx` (new `it(...)` near the community suites)

- [ ] **Step 1: Write the failing test**

Add to `fanoutSection.test.tsx` (reuse the file's existing render + open-editor helpers; the assertion style mirrors the existing "preset pre-fills" tests):

```ts
it('in-editor preset picker stamps broker fields', async () => {
  // Open a new generic Community MQTT integration (see existing create helpers).
  // Select the "bsmesh" option in the Preset dropdown.
  // Expect the broker host/port/audience inputs to reflect bsmesh.
  // Assertions:
  expect(await screen.findByLabelText('Broker Host')).toHaveValue('mqtt.bsmesh.de');
  expect(screen.getByLabelText('Broker Port')).toHaveValue(8885);
  expect(screen.getByLabelText('Token Audience')).toHaveValue('mqtt.bsmesh.de');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:run -- src/test/fanoutSection.test.tsx -t "preset picker"`
Expected: FAIL — no Preset dropdown rendered.

- [ ] **Step 3: Add the picker to `MqttCommunityConfigEditor`**

At the top of `MqttCommunityConfigEditor`'s returned JSX (immediately after the description paragraph at ~1723), insert a grouped preset `<select>`. Import the helpers at the top of the file:

```ts
import {
  COMMUNITY_MQTT_PRESETS,
  REGION_ORDER,
  applyPresetToConfig,
  detectPresetId,
  CUSTOM_PRESET_ID,
  type CommunityPresetRegion,
} from './communityMqttPresets';
```

Inside the component body (after `const authMode = ...` at 1717):

```tsx
  const currentPresetId = detectPresetId(config);
  const regionLabels: Record<CommunityPresetRegion, string> = {
    europe: t('settings_fanout_preset_region_europe'),
    north_america: t('settings_fanout_preset_region_north_america'),
    oceania: t('settings_fanout_preset_region_oceania'),
    other: t('settings_fanout_preset_region_other'),
  };
```

JSX block (rendered right after the description paragraph):

```tsx
      <div className="space-y-2">
        <Label htmlFor="fanout-comm-preset">{t('settings_fanout_preset_label')}</Label>
        <select
          id="fanout-comm-preset"
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={currentPresetId}
          onChange={(e) => {
            const preset = COMMUNITY_MQTT_PRESETS.find((p) => p.id === e.target.value);
            if (preset) onChange(applyPresetToConfig(config, preset));
          }}
        >
          <option value={CUSTOM_PRESET_ID}>{t('settings_fanout_preset_custom')}</option>
          {REGION_ORDER.map((region) => (
            <optgroup key={region} label={regionLabels[region]}>
              {COMMUNITY_MQTT_PRESETS.filter((p) => p.region === region).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {(() => {
          const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === currentPresetId);
          if (p?.hasEmbeddedCredentials)
            return <p className="text-xs text-muted-foreground">{t('settings_fanout_preset_note_embedded_creds')}</p>;
          if (p?.needsBackendSubstitution)
            return <p className="text-xs text-muted-foreground">{t('settings_fanout_preset_note_pubkey_username')}</p>;
          if (p?.requiresTopicTemplate)
            return <p className="text-xs text-muted-foreground">{t('settings_fanout_preset_note_topic_required')}</p>;
          return null;
        })()}
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:run -- src/test/fanoutSection.test.tsx -t "preset picker"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/SettingsFanoutSection.tsx frontend/src/test/fanoutSection.test.tsx
git commit -m "feat(fanout): add community MQTT preset picker to the config editor"
```

---

## Task 4: Remove the six specialized community DraftTypes

**Files:**
- Modify: `frontend/src/components/settings/SettingsFanoutSection.tsx`

- [ ] **Step 1: Remove from the `DraftType` union (143-157)** the six members: `mqtt_community_meshrank`, `mqtt_community_letsmesh_us`, `mqtt_community_letsmesh_eu`, `mqtt_community_dmc1`, `mqtt_community_dmc2`, `mqtt_community_meshcore_analyzer_eu`. Keep `mqtt_community`.

- [ ] **Step 2: Remove their `CreateIntegrationDefinition` entries (232-335)** from `getCreateIntegrationDefinitions`. Keep the generic `mqtt_community` entry (219-231).

- [ ] **Step 3: Remove their branches from `normalizeDraftConfig` (546-618)**, leaving only the fallback `return normalizeIntegrationConfigForSave(getCreateIntegrationDefinition(draftType, defs).savedType, config);`.

- [ ] **Step 4: Remove the JSX editor cases (3590-3632)** for the six draft types. The generic `mqtt_community` → `MqttCommunityConfigEditor` case (3586-3588) now serves all community presets.

- [ ] **Step 5: Delete the now-unused `LetsMeshConfigEditor` and `MeshRankConfigEditor` components**, and any `DEFAULT_*` constants (48-63) and `createCommunityConfigDefaults` overrides that are no longer referenced. Verify with a search before deleting each: `grep -n "LetsMeshConfigEditor\|MeshRankConfigEditor\|DEFAULT_MESHRANK\|DEFAULT_DMC\|DEFAULT_COMMUNITY_BROKER_HOST_EU\|DEFAULT_MESHCORE_ANALYZER" frontend/src/components/settings/SettingsFanoutSection.tsx` — remove only symbols with a single (definition) hit.

- [ ] **Step 6: Run typecheck + lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: no errors (no references to removed symbols).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/settings/SettingsFanoutSection.tsx
git commit -m "refactor(fanout): replace specialized community DraftTypes with preset picker"
```

---

## Task 5: Rewrite the affected `fanoutSection.test.tsx` suites

**Files:**
- Modify: `frontend/src/test/fanoutSection.test.tsx`

- [ ] **Step 1: Identify the suites to rewrite.** The tests that select a named preset type in the create dialog and assert the saved config: "MeshRank preset pre-fills…" (~980), "creates MeshRank preset…" (~1052), "LetsMesh (US)…" (~1211), "LetsMesh (EU)…" (~1330), "DMC-1…" (~1394), "DMC-2…" (~1464), "MeshCore Analyzer (EU)…" (~1530).

- [ ] **Step 2: Convert each** from "pick preset type in create dialog" to "create a generic Community MQTT integration, then choose the preset in the in-editor dropdown". The saved-config assertions (broker host/port/transport/tls/auth/token_audience/websocket_path) stay the same — only the interaction that reaches them changes. For MeshRank, keep the "requires topic template" assertion by leaving `topic_template` blank and expecting the save-blocked error `settings_fanout_meshrank_topic_required` (now surfaced from the editor save path; if the plan moves that validation, assert the new message key).

- [ ] **Step 3: Run the full fanout suite**

Run: `npm --prefix frontend run test:run -- src/test/fanoutSection.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/test/fanoutSection.test.tsx
git commit -m "test(fanout): drive community presets through the in-editor picker"
```

---

## Task 6: i18n keys (EN/NL/DE)

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

- [ ] **Step 1: Add these keys to all three locales** (EN values shown; provide NL/DE translations):

```json
"settings_fanout_preset_label": "Preset",
"settings_fanout_preset_custom": "Custom (manual configuration)",
"settings_fanout_preset_region_europe": "Europe",
"settings_fanout_preset_region_north_america": "North America",
"settings_fanout_preset_region_oceania": "Oceania",
"settings_fanout_preset_region_other": "Other",
"settings_fanout_preset_note_embedded_creds": "This preset ships shared broker credentials. Edit the username and password below if you have your own.",
"settings_fanout_preset_note_pubkey_username": "This preset authenticates with your radio's public key as the username.",
"settings_fanout_preset_note_topic_required": "This preset needs the packet topic template from your broker configuration."
```

- [ ] **Step 2: Remove the 12 now-unused keys** from all three locales: `settings_fanout_type_{meshrank,letsmesh_us,letsmesh_eu,dmc1,dmc2,meshcore_analyzer_eu}` and `settings_fanout_desc_{meshrank,letsmesh_us,letsmesh_eu,dmc1,dmc2,meshcore_analyzer_eu}`. Keep `settings_fanout_type_community_mqtt_generic` and `settings_fanout_desc_mqtt_community`. Confirm none are still referenced: `grep -rn "settings_fanout_type_dmc1\|settings_fanout_desc_meshrank" frontend/src`.

- [ ] **Step 3: Run the i18n parity test**

Run: `npm --prefix frontend run test:run -- src/test -t "i18n"` (or the project's parity test file)
Expected: PASS — EN/NL/DE key sets match.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "i18n(fanout): add community preset picker strings, drop per-preset type keys"
```

---

## Task 7: Full verification + changelog

**Files:**
- Modify: `changelog-DMC-EV.md`

- [ ] **Step 1: Run the complete suites**

Run: `npm --prefix frontend run test:run`
Run: `cd frontend && npx tsc --noEmit && npm run lint`
Run: `PYTHONPATH=. uv run pytest tests/test_community_mqtt.py tests/test_fanout_router_community.py -v`
Expected: PASS. Note: per project memory, ~14 Windows-only backend failures + charmap collection errors are pre-existing environment issues, not regressions — confirm any failures match that list and are unrelated to these files.

- [ ] **Step 2: Add a changelog entry** to `changelog-DMC-EV.md`:

```markdown
- Community MQTT: one preset picker with all 37 MeshCore community brokers (region-grouped), replacing the six hardcoded preset tiles. USERPASS presets ship editable credentials; mesh-chaun14 uses the radio public key as its username.
```

- [ ] **Step 3: Commit**

```bash
git add changelog-DMC-EV.md
git commit -m "docs: changelog for community MQTT preset picker"
```

---

## Self-Review notes

- **Spec coverage:** all 37 presets (Task 2 table), embedded creds + user override (Task 2 `hasEmbeddedCredentials` + editable username/password fields already in editor), `{pubkey}` backend substitution (Task 1), region grouping (Task 2 `region` + Task 3 `optgroup`), data-driven refactor (Tasks 2-4). `bsmesh` present in the table.
- **Type consistency:** `applyPresetToConfig`/`detectPresetId`/`CUSTOM_PRESET_ID`/`COMMUNITY_MQTT_PRESETS`/`REGION_ORDER`/`CommunityPresetRegion` used identically in Tasks 2 and 3.
- **Open validation question for execution:** MeshRank's "topic required" check currently lives in `normalizeDraftConfig` (removed in Task 4). Task 5 Step 2 notes it must move to the editor/save path; decide placement when implementing Task 3/5 (simplest: block save in `handleSave` when the active preset `requiresTopicTemplate` and `topic_template` is blank).
