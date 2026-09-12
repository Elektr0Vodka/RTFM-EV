# OpenHop Plugins Pane - Design Spec

**Date:** 2026-09-13
**Branch:** feat/openhop-detection
**Surface:** B (opt-in OpenHop REST management)
**Status:** design approved, pending spec review

## Goal

Add a detection-gated Plugins management pane to RTFM-EV that mirrors OpenHop's
native plugin manager, rendered in RTFM-EV's settings theme and layout. It lets a
user browse installed plugins and the curated catalogue, run lifecycle actions,
edit per-plugin settings, view logs, and install/update/uninstall plugins, with a
live streaming log for long operations.

This is the second Surface B pane after Policy. It reuses the same gating,
proxy, and client patterns established there.

## Non-negotiable constraints (inherited from the OpenHop integration plan)

- Non-OpenHop nodes (stock MeshCore, DMC, meshcomod) look and behave exactly as
  today. Every OpenHop element is gated on detection.
- The pane renders only when `health.radio_device_info.is_openhop` is true AND the
  OpenHop API url + token are configured. Fail-closed: when not configured or not
  OpenHop, nothing new renders and no OpenHop HTTP call is made.
- No existing payload field, type, or control changes shape or default.
- New user-facing strings need `t()` keys in EN, NL, DE (enforced by eslint + a
  parity test). No em dashes in user-facing output.

## Scope

**In scope (mirrors OpenHop minus local wheel upload):**

- List installed plugins with status (id, name, version, enabled, running/state).
- Lifecycle: enable, disable, start, stop, restart.
- Catalogue: browse curated catalogue, install a catalogue plugin (optionally a
  specific version).
- Updates: check a plugin for updates (GitHub Releases), apply an update.
- Per-plugin settings: read the plugin config object and write it back, with an
  optional restart.
- Per-plugin logs: tail the plugin log.
- Uninstall (with an optional "also delete data").
- Live streaming progress log for install / update / catalogue-install.

**Out of scope (this pane):**

- Local `.whl` upload install (`POST /api/plugins/install` multipart). Omitted by
  decision: it is an arbitrary-code-execution path into the node and needs a
  multipart proxy. Catalogue install covers the normal flow. Can be added later.
- Plugin `runtime.json` viewer (`GET /api/plugins/runtime`). Not required for the
  first cut; can be added later.
- The other Surface B panes (Config, Update, CAD): separate specs.

## Source-of-truth: OpenHop plugin API (verified from openhop-dev)

All under `/api/plugins/` on the OpenHop node. Envelope is `{success: bool, ...}`
or `{success: false, error}`. The plugin manager is only available when OpenHop
runs under its `container_supervisor` entrypoint; otherwise calls return HTTP 503
(`PluginManagerUnavailable`). Other codes: 504 (`outcome: "unknown"`), 4xx/5xx.

Read:
- `GET /api/plugins/` -> `{success, plugins: [...]}`
- `GET /api/plugins/{id}` -> plugin status object
- `GET /api/plugins/logs?id=&tail=200` -> log tail
- `GET /api/plugins/settings?id=` -> plugin config object
- `GET /api/plugins/catalogue?refresh=` -> curated catalogue + install/update hints
- `GET /api/plugins/updates?id=&refresh=` -> update check (GitHub Releases)
- `GET /api/plugins/progress?id=&since=&fresh=` -> SSE (text/event-stream)

Write (POST unless noted):
- `POST /api/plugins/enable {id}`
- `POST /api/plugins/disable {id}`
- `POST /api/plugins/start {id}`
- `POST /api/plugins/stop {id}`
- `POST /api/plugins/restart {id}`
- `POST /api/plugins/catalogue_install {id, version?}`
- `POST /api/plugins/update {id, version?}`
- `POST /api/plugins/settings {id, config, restart?}`
- `POST /api/plugins/uninstall {id, delete_data?}` (or `DELETE /api/plugins/{id}?delete_data=`)

**SSE progress event shapes** (from `plugin_endpoints._progress_events`):
- `{"type":"connected","id":<id>}`
- `{"type":"line","line":<str>}`
- `{"type":"status","state":<idle|running|complete|error>,"operation":<str|null>,"started":<ts|null>}`
- `{"type":"done","state":<complete|error|timeout|idle>,"error":<str|null>,"started":<ts|null>}`
- `{"type":"keepalive"}`

Note: exact field names of the installed-plugin object and catalogue entry are
verified live against the sim during implementation (catalogue entries observed as
`{id, name, description, repository, category, version, wheel_url}`; installed
objects at minimum id/name/version/enabled/state). Types are written from the
live-observed shapes, not guessed.

## Architecture

Two independent layers, both extending existing files. No database migration.

### Backend (extend the existing gated proxy)

**`app/services/openhop_api.py`** - add `OpenHopClient` methods, one per OpenHop
endpoint above (except wheel-upload install). Naming mirrors the existing style
(`get_policy`, `cli`): `list_plugins`, `plugin_status(id)`, `plugin_catalogue(force_refresh=False)`,
`enable_plugin(id)`, `disable_plugin(id)`, `start_plugin(id)`, `stop_plugin(id)`,
`restart_plugin(id)`, `catalogue_install(id, version=None)`, `check_plugin_update(id, force_refresh=False)`,
`update_plugin(id, version=None)`, `get_plugin_config(id)`, `set_plugin_config(id, config, restart=False)`,
`plugin_logs(id, tail=200)`, `uninstall_plugin(id, delete_data=False)`.

**`app/routers/openhop.py`** - add routes under `/api/openhop/plugins/*`, each
behind the existing gate helper (is_openhop AND url+token set, else 409). Each
route builds the client per request, delegates to the matching method, and relays
`{success,...}` plus OpenHop's status code. A 503 from OpenHop (plugin manager
unavailable) is relayed so the UI can show the "run under container_supervisor"
notice.

**SSE passthrough** - one new streaming route
`GET /api/openhop/plugins/progress?id=&since=&fresh=` returning a FastAPI
`StreamingResponse(media_type="text/event-stream")`. It opens an httpx streaming
GET to OpenHop's `/api/plugins/progress` (with the X-API-Key header) and re-yields
each upstream chunk/line unchanged. Stateless passthrough, no server-side
buffering. This route uses a long/no read-timeout; the existing 8s client timeout
stays for all non-streaming calls (a separate streaming path, not the shared
client). On the gate failing it returns 409 before opening the stream. On upstream
error it emits a terminal `data: {"type":"done","state":"error",...}` event and
closes.

This introduces the codebase's first SSE path. It is confined to this one route.

### Frontend

**`frontend/src/types.ts`** - add `OpenHopPlugin`, `OpenHopCatalogueEntry`, and a
progress-event union type, plus the `api` response types for the new calls.

**`frontend/src/api.ts`** - typed methods for each new backend route. Progress is
consumed via the browser `EventSource` against
`/api/openhop/plugins/progress?id=...` (not the fetch client).

**IA: consolidate the OpenHop settings section into a sub-nav.**
The shipped Policy pane is the whole of the top-level "OpenHop" settings section
(`SettingsOpenHopSection.tsx`). Refactor that section into a container that hosts
an internal sub-nav (segmented control or sub-tabs): **Policy | Plugins** (with
Config / Update / CAD to be added by their own specs later). The existing Policy
content moves under the "Policy" sub-nav item unchanged. Plugins is the new item.
This avoids adding a new top-level settings section (no new nav enumerations), and
keeps all OpenHop panes under one nav entry as more panes land. Sub-nav state is
local component state for the first cut (deep-linking a specific sub-pane via
urlHash is a future option; `#settings/openhop` continues to open the section).

**New component dir `frontend/src/components/settings/openhop/plugins/`**,
mirroring the Policy pane's file-per-concern structure:
- `OpenHopPluginsPane.tsx` - the pane: Installed / Catalogue tabs (Layout A),
  load-on-mount, not-configured and manager-unavailable states, error surface.
- `PluginList.tsx` / `PluginCard.tsx` - installed cards; status badge; action
  buttons (enable/disable, start/stop/restart, update when available, uninstall);
  expand to reveal a detail region with Logs / Settings sub-tabs.
- `PluginLogsView.tsx` - monospace tail with `tail=N` and refresh.
- `PluginSettingsEditor.tsx` - validated JSON textarea (blocks Save on invalid
  JSON) with Save and Save-and-restart. OpenHop's settings API takes an arbitrary
  config object and there is no schema to build a form from, so a raw JSON editor
  is the faithful and correct mirror.
- `CatalogueList.tsx` / `CatalogueCard.tsx` - catalogue entries with Install
  (and version choice where the catalogue provides one).
- `PluginProgressLog.tsx` - opens an `EventSource` for install/update/catalogue-
  install, renders the streamed lines and status inline under the acting card, and
  closes on the terminal `done` event, then triggers a list refresh.

**Theme/layout:** reuse the existing pane conventions - shadcn `Button`,
Tailwind `space-y-*`, `text-muted-foreground`, `text-destructive`, `useT()`.
Destructive actions (uninstall, disable, stop) get a confirm; uninstall's confirm
offers "also delete data".

## Data flow

1. Section mounts, Plugins sub-nav selected -> `api.listOpenHopPlugins()` and
   (lazily, on the Catalogue tab) `api.getOpenHopPluginCatalogue()`.
2. Lifecycle action -> POST -> on success, refresh the affected plugin's status /
   the list. These are quick; no progress stream.
3. Install / update / catalogue-install -> POST kicks the operation ->
   `PluginProgressLog` opens `EventSource` on `/api/openhop/plugins/progress?id=` ->
   renders lines/status -> on `done`, closes and refreshes the list.
4. Settings -> GET config into the editor; POST writes it back (optional restart).
5. Logs -> GET tail; refresh re-fetches.

## Error and edge handling

- Not OpenHop -> render nothing (section gate).
- OpenHop but not configured -> "configure management first" message (existing key
  pattern).
- Plugin manager unavailable (upstream 503) -> explicit notice that OpenHop must
  run under `container_supervisor`; actions disabled.
- SSE drop / upstream error -> progress log shows a terminal error/"stream ended"
  line and falls back to a status refresh.
- Invalid JSON in the settings editor -> Save disabled with an inline validation
  message.
- Every proxy call is fail-closed on the gate (409 when the gate fails).

## Testing

**Backend:**
- `tests/test_openhop_api_service.py` - each new `OpenHopClient` method against
  httpx `MockTransport` asserting path, method, X-API-Key, and body.
- `tests/test_openhop_router.py` - gate (409 when not OpenHop / not configured),
  delegation for each route, 503 relay, and the SSE passthrough (mock an upstream
  event-stream and assert the bytes are relayed and the gate short-circuits before
  opening the stream).

**Frontend (Vitest):**
- Section absent when not OpenHop and when unconfigured; present when both true.
- Sub-nav switches Policy <-> Plugins without disturbing Policy behavior.
- Installed / Catalogue tab switching; action methods called with correct ids.
- JSON editor validation blocks Save on invalid input.
- Progress log renders streamed lines and closes on done (mock EventSource).
- i18n EN/NL/DE parity test passes for all new keys.

**Runtime verification (required, observe not infer):**
- Bring up the OpenHop sim under `container_supervisor` (recipe in the handoff /
  openhop integration plan; needs `MSYS_NO_PATHCONV=1` on Windows), configure the
  OpenHop url+token in RTFM-EV, and verify against the live node: installed list
  renders, a lifecycle action reflects in status, catalogue install streams a live
  log and the plugin then appears installed, settings round-trip, logs tail, and a
  non-OpenHop instance shows no OpenHop section. Capture screenshots.

## Open questions resolved during brainstorming

- Scope: full minus local wheel upload. (decided)
- Live progress: SSE passthrough backend + EventSource frontend, inline log.
  (decided)
- Layout: Layout A, tabbed Installed / Catalogue, card-expand with Logs / Settings
  sub-tabs. (decided)
- Settings editor: raw validated JSON. (decided)
- IA: consolidate the OpenHop section under an internal sub-nav (Policy | Plugins).
  (decided)

## Remaining to pin during implementation (facts, verified live, not guessed)

- Exact installed-plugin object fields and catalogue-entry fields (probe the sim).
- Whether catalogue_install / update return synchronously or kick an async op
  reported only via the progress SSE (affects when the progress log opens). Verify
  against the sim and design the kick+stream ordering accordingly.
