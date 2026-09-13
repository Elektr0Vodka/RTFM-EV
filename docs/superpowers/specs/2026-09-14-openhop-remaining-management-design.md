# OpenHop remaining management surfaces (Update, CAD, System, Transport, MQTT, Analytics)

Date: 2026-09-14
State: design approved (brainstorming), pending implementation plan
Sibling plan: `docs/plans/20-openhop-integration.md` (this completes its Phase 4 + Phase 5)
Prior work: PR #108 shipped Surface A (detection + `is_openhop` label) and Surface B panes
Policy, Plugins, Config. This spec covers everything deferred there.

Ground truth: OpenHop source read directly from the `openhop-sim:local` Docker image
(`/opt/openhop_repeater`): `repeater/web/update_endpoints.py`, `repeater/web/api_endpoints.py`,
`repeater/web/cad_calibration_engine.py`, and `repeater/web/openapi.yaml` (5947 lines).
Endpoint request/response shapes below are read from that source, not inferred.

Stakeholder input: Richard (2026-09-14) — terminal and OpenHop share a network so config
reachability is not a concern; the handy thing is hardware stats (CPU, memory, uptime, free
disk). This promotes the System/Hardware pane to a first-class item.

---

## 1. Scope

Six management panes added to the detection-gated OpenHop settings section, all additive
REST proxies over the OpenHop HTTP API. One branch, one PR, phased commits.

1. **Update (OTA)** — Phase 4 remainder.
2. **CAD Calibration** — Phase 5.
3. **System / Hardware** — Phase 5 (Richard priority).
4. **Transport keys + neighbor scopes** — Phase 5.
5. **MQTT config** — Phase 5.
6. **Analytics** — Phase 5 (lowest value; folded as a secondary section of the System pane,
   not its own tab).

Out of scope: identities, ACL, room-server, companion-over-HTTP, packet bulk export,
memory_debug. Not requested; overlap with RTFM-EV's own data or niche.

---

## 2. Architecture

No database migration. No config schema change — the API base URL + token are already
stored (migration `_087`, PR #108) and masked write-only. All work is additive.

### 2.1 Backend

- **Client** (`app/services/openhop_api.py`): add one typed async method per endpoint,
  matching the existing thin `_get`/`_post`/`_delete`/`_get_q` helpers. Add a `_put` helper
  (transport keys use PUT).
- **Router** (`app/routers/openhop.py`): add proxy routes. JSON routes use the existing
  `_relay_upstream()` (preserves upstream status, maps transport errors to 502, closes the
  client). Two new **SSE passthroughs** — `GET /update/progress` and `GET /cad/stream` —
  are direct clones of the existing `/plugins/progress` handler, reusing the injectable
  module-level `_stream_transport` so tests can supply an `httpx.MockTransport`.
- **Gating**: every route goes through `_require_client()` (fail-closed 409 unless
  `is_openhop` AND url+token set). No change to the gate.

### 2.2 Frontend

- **Sub-nav** (`SettingsOpenHopSection.tsx`): replace the single flat row with two labelled
  rows.
  - Row "Node": Config, System, Update, CAD.
  - Row "Mesh": Policy, Plugins, Transport, MQTT.
  - `OpenHopTab` union extends to the 8 ids. Default tab stays `policy`.
- **New panes**, each self-contained under `frontend/src/components/settings/openhop/`:
  - `update/OpenHopUpdatePane.tsx` (+ children: version card, channel selector, changelog
    list, install-progress log).
  - `cad/OpenHopCadPane.tsx` (+ manual-check form, calibration stream log, save-settings).
  - `system/OpenHopSystemPane.tsx` (+ hardware stat tiles, process table, analytics section).
  - `transport/OpenHopTransportPane.tsx` (key list/CRUD + neighbor-scope table + query form).
  - `mqtt/OpenHopMqttPane.tsx` (status + broker presets read, config form, publish button).
- Panes fetch through the RTFM-EV `/api/openhop/*` proxy (never the OpenHop host directly).
- Reuse existing settings card styling and the SSE-consuming hook pattern from the Plugins
  pane's progress view.

### 2.3 i18n & tests

- All new user-facing strings get `t()` keys in EN/NL/DE (enforced by eslint + parity test).
- Backend: `httpx.MockTransport` per client group; extend the router SSE test to cover both
  new streams. Frontend: vitest mount + detection-gating tests per pane; SSE-consuming
  component tested with a mocked EventSource.

---

## 3. Endpoint reference (read from source)

Envelopes are mixed across OpenHop (`{success, data:{...}}` vs flat `{success, ...}`); the
client returns the raw dict and the frontend reads defensively. `_` marks fields whose exact
shape is opaque in the spec and rendered defensively.

### 3.1 Update (mounted at `/api/update/`)

- `GET /status` -> `{success, current_version, latest_version, has_update, channel,
  last_checked, state (idle|checking|installing|complete|error), error, rate_limit_until}`.
- `POST /check` body `{force?:bool}` -> `{success, message, state, ...snapshot}`.
- `POST /install` body `{force?:bool}` -> `{success, message, state}` or error 409.
  **Destructive**: real pip upgrade + service restart on the node.
- `GET /progress` SSE -> events `{type: connected|line|status|done|keepalive, ...}`.
- `GET /channels` -> `{success, channels:[str], current_channel:str}`.
- `POST /set_channel` body `{channel:str}` -> `{success, channel, message}`.
- `GET /changelog?channel=&max=` -> `{success, channel, installed, latest,
  commits:[{sha, short_sha, title, body, author, date, url}]}`.

RTFM-EV proxy paths: `/api/openhop/update/{status,check,install,channels,set_channel,
changelog}` + `/api/openhop/update/progress` (SSE).

### 3.2 CAD Calibration (mounted at `/api/`)

- `POST /cad_calibration_start` body `{samples?:int(1..64)=8, delay?:int(10..1000)=100}`
  -> SuccessResponse.
- `POST /cad_calibration_stop` -> SuccessResponse.
- `POST /cad_manual_check` body `{samples?, det_peak?, det_min?, cad_symbol_num?(1|2|4|8|16),
  cad_timeout_ms?, apply_live?}` -> `{success, data:{det_peak, det_min, cad_symbol_num,
  cad_timeout_ms, apply_live, samples, attempts, detections, non_detections, timeouts,
  errors, cad_done_count, detection_rate, detected}}`.
- `POST /save_cad_settings` body `{peak:int(0..255), min_val:int(0..255),
  cad_symbol_num?}` (auth required) -> SuccessResponse.
- `GET /cad_calibration_stream` SSE.

RTFM-EV proxy paths under `/api/openhop/cad/{start,stop,manual_check,save}` +
`/api/openhop/cad/stream` (SSE).

**Caveat**: meaningful detection metrics require real LoRa RF hardware. Against the
`NullRadio` sim the endpoints respond but produce no real detections. Unit-tested with
mocked httpx; functional calibration marked NOT VERIFIED.

### 3.3 System / Hardware (mounted at `/api/`)

- `GET /hardware_stats` -> `{success, data:{...}}` from psutil (CPU %, memory total/used/
  percent, disk total/used/free/percent, uptime, load, temperature — exact keys read live
  from the sim, rendered defensively). Errors when psutil absent.
- `GET /hardware_processes` -> `{success, data:{...}}` top processes.
- `GET /stats` -> node stats (opaque object).
- `GET /site_info` -> identity/liveness (opaque object).

RTFM-EV proxy paths: `/api/openhop/system/{hardware,processes,stats,site_info}`.
Read-only, auto-refresh (interval, pausable).

### 3.4 Transport keys + neighbor scopes (mounted at `/api/`)

- `GET /transport_keys` -> `{success, data:[{...}]}`.
- `POST /transport_keys` body `{name:str}` -> SuccessResponse.
- `GET /transport_key?key_id=` -> key details. `PUT /transport_key?key_id=` update.
  `DELETE /transport_key?key_id=` delete. (Read exact PUT/DELETE query+body from openapi
  lines 1705+ during implementation.)
- `GET /neighbor_scopes` -> `{success, count, served:{scopes:str},
  data:{<pubkey>: NeighborScopeRecord}}`.
- `POST /query_neighbor_scopes` body `{pubkey:str(64hex)}` -> `{success, data:{pubkey,
  status(responded|timeout|send_failed), scopes, transmitted, queried_at, responded_at}}`.

RTFM-EV proxy paths under `/api/openhop/transport/*` and `/api/openhop/scopes/*`.
Key create/delete behind explicit confirm.

### 3.5 MQTT config (mounted at `/api/`)

- `GET /mqtt_status` -> opaque object (render defensively).
- `GET /broker_presets` -> opaque object.
- `POST /update_mqtt_config` body (reversed from source): `{iata_code?:str,
  status_interval?:int(>=60), owner?:str, email?:str, neighbors?:object,
  brokers?:[object]}`. Partial update; strict whitelist per field.
- `POST /publish_neighbors` (auth) -> SuccessResponse. **Outward**: triggers an RF
  discovery + publish cycle (minutes). Behind explicit confirm.

RTFM-EV proxy paths under `/api/openhop/mqtt/{status,presets,config,publish_neighbors}`.

### 3.6 Analytics (mounted at `/api/`, read-only, folded into System pane)

- `GET /packet_stats?hours=` , `GET /packet_type_stats?hours=`,
  `GET /airtime_chart_data?...`, `GET /noise_floor_stats?hours=`,
  `GET /noise_floor_chart_data?hours=`. All opaque objects, rendered defensively.

RTFM-EV proxy paths under `/api/openhop/analytics/*`.

---

## 4. Error handling & safety

- **Fail-closed detection**: all panes hidden unless `health.radio_device_info.is_openhop`.
  All routes 409 unless configured + reachable.
- **Upstream status preserved** via `_relay_upstream` (a 503 plugin-manager-style state
  reaches the UI intact).
- **Confirm-gated outward/destructive actions**: Update `install`, transport key `delete`,
  MQTT `update_config`, `publish_neighbors`, CAD `save_settings`. UI shows a confirm step;
  the action is never auto-run.
- **SSE**: passthrough only; RTFM-EV holds no update/CAD state of its own. Stream closes on
  upstream `done`/`error`.
- **Token**: sent only as the bearer header by the backend client; never logged, never
  returned to the frontend (write-only, per PR #108).

---

## 5. Verification plan

Per CLAUDE.md "never claim it works without proof". Two independent checks minimum per
claim; runtime behaviour observed, not reasoned.

1. **Sim boot with REST on**: run `openhop-sim:local` publishing companion 5000 + REST on a
   host port other than 8000 (the live RTFM-EV app holds 8000). Confirm the CherryPy REST
   server auto-starts (open question §3.3 of plan 20) or determine the flag/`http start`
   needed. Read `hardware_stats` live to capture the real key set.
2. **Live read paths**: exercise every GET proxy against the sim + a test API token
   (site_info, stats, hardware_stats/processes, mqtt_status, broker_presets,
   transport_keys, neighbor_scopes, update/status|channels|changelog, analytics). Observe
   real responses.
3. **Update read-only live**: `status`, `channels`, `changelog`, `check` (these hit the real
   GitHub API for `openhop-dev/openhop_repeater`). `install` **not triggered** (destructive).
4. **CAD**: endpoints wired + unit-tested; functional detection NOT VERIFIED (no RF).
5. **Backend unit**: `httpx.MockTransport` per group incl. both SSE streams.
6. **Frontend**: vitest mount/gating per pane; SSE component with mocked EventSource.
7. **CI-equivalent locally before push**: backend `ruff check` + `ruff format --check` +
   pytest (in container per project convention); frontend `lint` + `format:check` +
   `test:run` + `build`. See `docs/agents/ci-checks.md`.
8. **Real-browser** run of at least the System + Update panes against the sim.

---

## 6. Documentation (same-change)

- `CHANGELOG-DMC-EV.md`: entry under the OpenHop area.
- `README_ADVANCED.md`: OpenHop management section — list the new panes.
- `docs/plans/20-openhop-integration.md`: mark Phase 4 + Phase 5 delivered; add to
  `docs/plans/README.md` delivery table.
- `frontend/AGENTS.md` / `app/AGENTS.md`: note the new proxy routes + panes if the OpenHop
  section documents the existing ones.

---

## 7. Phasing (single branch, commit per phase)

1. Update pane (backend client+routes+SSE, frontend pane, tests, i18n).
2. CAD pane.
3. System/Hardware pane (+ analytics section).
4. Transport keys + neighbor scopes pane.
5. MQTT config pane.
6. Sub-nav two-row regroup + docs + full-repo quality gate + live verification.

Each phase is independently reviewable and leaves the app buildable.

---

## 8. Open questions (resolve during phase 1 verification)

- REST server auto-start vs `http start`/config flag (plan 20 §3.3). Determines whether the
  sim needs extra setup and whether real nodes expose REST by default.
- Exact `hardware_stats` key set (psutil-dependent) — read live, render defensively.
- Transport key PUT/DELETE exact query+body — read from openapi 1705+ before typing.
- Whether the sim ships psutil (else `hardware_stats` returns its error path — still a valid
  rendering case to handle).
