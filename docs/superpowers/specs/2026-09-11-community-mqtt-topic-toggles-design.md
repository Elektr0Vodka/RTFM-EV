# Community MQTT topic toggles + DMC Observer removal — Design

Status: design, awaiting review
Date: 2026-09-11
Supersedes (partially): `docs/superpowers/specs/2026-09-10-mqtt-dmc-observer-export-design.md`
(the dedicated `mqtt_dmc_observer` type it introduced is removed here)

## Problem

The DMC Observer (native) fanout (`mqtt_dmc_observer`) added per-topic publish
toggles and a configurable status interval, in a separate publisher that
mirrors the DMC firmware wire schema byte-for-byte.

In practice the toggles + interval are the useful part, and the community
brokers (letsmesh US/EU, `collector1`/`collector2.dutchmeshcore.nl`,
`mqtt.meshcore-analyzer.eu`) already accept the `meshcore/{IATA}/{PUBKEY}/*`
topic namespace. Maintaining a second, near-duplicate publisher (a
`CommunityMqttPublisher` subclass) for a different-but-overlapping wire schema
is redundant.

Goal: fold the topic toggles + configurable status interval into the existing
`mqtt_community` publisher so every community preset gains them, then remove
the `mqtt_dmc_observer` type entirely.

## Decisions (from brainstorming)

- **D1 — Mechanism:** add the controls to the shared `mqtt_community`
  publisher; do NOT keep a separate DMC observer publisher. (User: option 1.)
- **D2 — Scope of presets:** the toggles + interval apply to ALL community
  presets — letsmesh US/EU, DMC-1, DMC-2, MeshCore Analyzer (EU), and the
  generic Community MQTT. (User: "even the letsmesh ... brokers already
  accept".)
- **D3 — No DB migration:** existing saved `mqtt_community` configs keep
  running; absent keys fall back to today's behavior (status on, packets on,
  300 s). Only creation presets and the editor UI change. (User: "Why are we
  migrating?")
- **D4 — Wire schema unchanged:** keep the community (Analyzer /
  meshcore-packet-capture) schema, including `Z`-suffixed timestamps. Do NOT
  adopt the DMC firmware `+00:00` format. (User: "Keep community 'Z'".)
- **D5 — No separate `raw` topic.** The `/packets` message already carries the
  raw on-air bytes AND `RSSI`/`SNR` (`_format_raw_packet`), which is exactly the
  coredrive-rx model (`efiten/coredrive-rx/src/publisher.js`: raw+SNR+RSSI on
  `type:'PACKET'`, no `/raw` topic). The only `/raw` precedent (DMC firmware) is
  a minimal dump with no rssi, and no ingestor consumes it. So there is no
  `publish_raw` toggle and no `/raw` topic. (User: "1 but what about gps".)
- **D6 — No gps in this change.** Live per-packet GPS is the separate,
  still-speculative plan 12 (`docs/plans/12-wardrive-gps-fanout.md`); it needs
  new browser->backend position plumbing that does not exist yet. Adding the
  radio's static `adv_lat`/`adv_lon` would be misleading (fixed/`(0,0)`), not
  wardrive GPS. Out of scope. (User: "No gps now; keep it plan 12".)
- **D7 — Remove the DMC Observer type** (backend module + router wiring +
  frontend option + tests + docs).

## Verified facts (evidence)

- **Collector authorization** — `Dutch-MeshCore/collector/src/server.ts`
  `authorizePublish`: publisher clients may publish only to `meshcore/*`; topic
  must be `meshcore/{IATA}/{PUBKEY}/{subtopic}` (>= 4 parts); IATA must be valid
  (not `XXX`); topic pubkey must equal the authenticated client pubkey; retain
  is stripped from `/status`. No subtopic allowlist.
- **Analyzer ingest** — `EU-Meshcore-Analyzer/internal/ingest/convert.go`
  `Convert()` handles kinds `status`, `neighbors`, `filter`, `config`, and
  `packets` (empty kind == packets); every other kind (incl. `raw`) is dropped.
  `sourceKey` comment maps cache-1 -> collector1.dutchmeshcore.nl, cache-2 ->
  collector2.dutchmeshcore.nl (this analyzer ingests the DMC collectors).
- **coredrive-rx** (`efiten/coredrive-rx/src/publisher.js`) — topics
  `meshcore/client/{PUBKEY}/{packets,rf,regions}`. `/packets` payload:
  `{origin_id, origin, timestamp, type:'PACKET', direction:'rx', raw, SNR,
  RSSI, gps}`. No `/raw` topic; RSSI/SNR ride on `/packets`.
- **Our community `/packets`** (`app/fanout/community_mqtt.py:_format_raw_packet`)
  already emits `{origin, origin_id, timestamp(Z), type:"PACKET",
  direction:"rx", time, date, len, packet_type, route, payload_len,
  raw(UPPERCASE hex), SNR, RSSI, hash, path?}`.
- **Community publisher already publishes** a retained `status`
  (`_publish_status`, on connect + every hardcoded `_STATS_REFRESH_INTERVAL =
  300 s`) and `packets` (`app/fanout/mqtt_community.py:on_raw` via
  `topic_template`). It has **no** toggles and a **hardcoded** interval.
- `CommunityMqttPublisher` is used only by `MqttCommunityModule` and subclassed
  only by the (to-be-removed) `DmcObserverPublisher`. No settings/global usage.

## Approach

### Config blob additions (`fanout_configs.config` JSON, type `mqtt_community`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `publish_status` | bool | `true` | gate the `status` topic |
| `publish_packets` | bool | `true` | gate the `packets` topic |
| `status_interval_ms` | int | `300000` | clamped `[1000, 3600000]`; UI edits minutes (1–60) |

Absent keys default as above → byte-identical behavior to today for existing
configs.

### Backend — enhance `mqtt_community`

**`app/fanout/community_mqtt.py`**
- Extend `CommunityMqttSettings` protocol: add `community_mqtt_publish_status:
  bool` and `community_mqtt_status_interval_ms: int`.
- `_publish_status`: early-return when `getattr(settings,
  "community_mqtt_publish_status", True)` is false.
- `_on_periodic_wake`: replace the `_STATS_REFRESH_INTERVAL` comparison with a
  per-config interval read from settings, clamped `[1000, 3600000]` ms
  (fallback 300000). Add a local `_clamp_status_interval_ms` helper (do not
  import from the deleted DMC module).
- Keep `_STATS_MIN_CACHE_SECS` (60 s) stats cache as-is; a sub-60 s interval
  still republishes status with cached stats.
- No `raw` topic, no raw payload builder (D5).

**`app/fanout/mqtt_community.py`**
- `_config_to_settings`: add `community_mqtt_publish_status =
  config.get("publish_status", True)` and `community_mqtt_status_interval_ms =
  config.get("status_interval_ms", 300000)`.
- `on_raw`: gate the packets publish on `config.get("publish_packets", True)`.
  No raw branch.

**`app/routers/fanout.py`**
- `_validate_mqtt_community_config`: coerce `publish_status`/`publish_packets`
  to bool (default `True`); clamp `status_interval_ms` to `[1000, 3600000]`
  with 300000 fallback (no error on out-of-range, mirroring prior behavior).

### Backend — remove DMC Observer

- Delete `app/fanout/mqtt_dmc_observer.py`.
- `app/fanout/manager.py`: remove the `DmcObserverModule` import and the
  `_MODULE_TYPES["mqtt_dmc_observer"]` registration.
- `app/routers/fanout.py`: remove `"mqtt_dmc_observer"` from `_VALID_TYPES`, the
  `elif config_type == "mqtt_dmc_observer"` validate branch,
  `_validate_dmc_observer_config`, and the `mqtt_dmc_observer` branch in
  `_enforce_scope`.
- Delete `tests/test_mqtt_dmc_observer.py`; remove DMC-observer cases from
  `tests/test_fanout_integration.py`.
- `app/fanout/AGENTS_fanout.md`: remove the `mqtt_dmc_observer` section;
  document the new `mqtt_community` toggles + configurable interval.

### Frontend — `frontend/src/components/settings/SettingsFanoutSection.tsx`

- `DraftType`: remove `'mqtt_dmc_observer'`. Keep
  `mqtt_community_dmc1`/`_dmc2`/`_meshcore_analyzer_eu` (still `mqtt_community`).
- Remove the generic `mqtt_dmc_observer` create-definition, the
  `MqttDmcObserverConfigEditor` component, and its detail-render branch.
- Add `publish_status: true`, `publish_packets: true`, `status_interval_ms:
  300000` to `defaults.config` of every community create-definition
  (`createCommunityConfigDefaults` is the natural single place, since generic +
  letsmesh + DMC + analyzer all build on it).
- Add a small shared `CommunityTopicControls` sub-component (two checkboxes +
  a minutes field, minutes<->ms) and render it inside both
  `MqttCommunityConfigEditor` (saved-type editor) and `LetsMeshConfigEditor`
  (preset draft editor) so all community presets expose the controls during
  creation and editing.
- `normalizeIntegrationConfigForSave('mqtt_community', ...)`: default the two
  booleans and clamp `status_interval_ms`.
- `getTypeLabels`: unchanged (type removed; community configs group under
  `mqtt_community`).

### Frontend — i18n (`frontend/src/i18n/locales/{en,nl,de}.json`)

- Remove DMC-observer-only keys: `settings_fanout_type_dmc_observer`,
  `settings_fanout_desc_dmc_observer`, `settings_fanout_dmc_observer_desc`,
  `settings_fanout_dmc_publish_status`, `settings_fanout_dmc_publish_packets`,
  `settings_fanout_dmc_publish_raw`, `settings_fanout_dmc_status_interval_min`
  (and any other now-unused `settings_fanout_dmc_*`).
- Add community topic-control keys (real EN/NL/DE):
  `settings_fanout_publish_status`, `settings_fanout_publish_packets`,
  `settings_fanout_status_interval_min` (+ a short hint key if useful).
- Reword `settings_fanout_desc_dmc1`/`_dmc2`/`_meshcore_analyzer_eu` to mention
  the per-topic toggles + status interval instead of "a subset of the primary
  Community MQTT" only.
- Keep `_meta` blocks intact; satisfy the i18n parity test + `i18next/no-
  literal-string` lint.

### Tests

Backend:
- `tests/test_fanout_integration.py`: `mqtt_community` publishes `packets` when
  `publish_packets` true and not when false; `status` gated by `publish_status`;
  scope still enforced.
- New/extended unit tests: `status_interval_ms` clamp in
  `_validate_mqtt_community_config`; boolean defaulting; `_on_periodic_wake`
  honors the configured interval.
- Remove `tests/test_mqtt_dmc_observer.py`.

Frontend (`frontend/src/test/fanoutSection.test.tsx`):
- Update DMC-1/DMC-2/analyzer preset tests to expect the new fields in the saved
  `mqtt_community` config (`publish_status:true, publish_packets:true,
  status_interval_ms:300000`) alongside the existing broker/path/audience
  assertions.
- Remove the two generic "DMC Observer (native)" creation tests.
- Add a test: the community topic controls render and round-trip
  (toggle packets off; set interval minutes -> ms) into the saved config.

## Error handling / edge cases

- Missing radio key or invalid IATA: unchanged — status/packets skip the
  publish cycle (existing guards).
- `status_interval_ms` out of range: clamped, never fatal (validator + runtime).
- Existing saved configs with no toggle keys: default on/on, 300 s — no
  behavior change.

## Out of scope

- `raw` topic (D5); `gps`/wardrive (D6, plan 12).
- `neighbors`/`filter`/`config` topics.
- Ingest/subscribe (publish/export only).
- Changing the community `packets`/`status` payload schemas.
- Migrating existing DB rows (D3).

## Verification (before "done")

- Backend: `pytest tests/test_fanout_integration.py` + the new unit tests
  green; DMC observer tests gone; note the ~14 known Windows env failures are
  pre-existing (project memory), not regressions.
- Frontend: `cd frontend && npm run lint` (0), `npx tsc -p tsconfig.json
  --noEmit`, `npx vitest run` green.
- Grep shows no remaining `mqtt_dmc_observer` / `DmcObserver` references in
  `app/`, `frontend/src/`, or tests (except historical docs/specs).
- Live (manual, NOT VERIFIED here): configure a community preset against a test
  broker; confirm `meshcore/{IATA}/{PUBKEY}/status` and `.../packets` appear,
  the toggles gate them, and status cadence honors the configured interval.

## Files to touch

| File | Change |
|---|---|
| `app/fanout/community_mqtt.py` | status gate, configurable interval, protocol fields, clamp helper |
| `app/fanout/mqtt_community.py` | settings mapping, on_raw packet gating |
| `app/routers/fanout.py` | community validator toggles+clamp; remove all `mqtt_dmc_observer` wiring |
| `app/fanout/manager.py` | remove DMC module import + registration |
| `app/fanout/mqtt_dmc_observer.py` | delete |
| `app/fanout/AGENTS_fanout.md` | remove DMC section; document community toggles |
| `frontend/src/components/settings/SettingsFanoutSection.tsx` | remove DMC type/editor; add community topic controls + defaults + normalize |
| `frontend/src/i18n/locales/{en,nl,de}.json` | remove DMC keys; add community keys; reword preset descs |
| `tests/test_fanout_integration.py` | community toggle cases; drop DMC cases |
| `tests/test_mqtt_dmc_observer.py` | delete |
| `frontend/src/test/fanoutSection.test.tsx` | preset field expectations; remove DMC creation tests; add toggle round-trip |
