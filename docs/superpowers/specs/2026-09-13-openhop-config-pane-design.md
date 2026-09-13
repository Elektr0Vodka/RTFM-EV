# OpenHop Config Pane Design

**Date:** 2026-09-13
**Branch:** feat/openhop-detection
**Status:** approved (brainstorming)

## Goal

Add a Config pane to RTFM-EV's OpenHop settings section that mirrors OpenHop's own
configuration page: view/inspect the node's live config, switch operating mode, edit
radio parameters, and back up / restore the full config. The pane is the third Surface B
pane after Policy and Plugins, added as a sub-nav tab (`Policy | Plugins | Config`) inside
`SettingsOpenHopSection`, not a new top-level settings section.

## Non-negotiable constraints (inherited from the OpenHop integration)

- Non-OpenHop nodes (stock MeshCore, DMC, meshcomod) behave exactly as today. The Config
  tab renders only when the connected node is detected as OpenHop AND the user has
  configured an OpenHop API url + token (`status.configured`). Fail-closed.
- No existing payload field, type, or control changes shape or default.
- The OpenHop API token is never returned to the client.
- New user-facing strings get `t()` keys in EN/NL/DE (enforced by eslint + parity test).
- No em dashes in user-facing strings.

## Scope (user-selected: all four)

1. View / inspect: read-only mirror of the live config, plus validation.
2. Mode switch: forward / monitor / no_tx.
3. Edit radio params: freq/bw/sf/cr/tx_power/delays/identity/adverts.
4. Backup / restore: export (redacted or full) and import.

## OpenHop endpoint surface (from OpenHop source, envelopes to confirm live)

OpenHop's config endpoints use a MIX of envelope shapes. Each shape below is taken from
`openhop_repeater/repeater/web/api_endpoints.py`. The two marked "PROBE" are not yet
read end-to-end and MUST be probed against the live sim before the client return types
are frozen (first plan task).

| RTFM-EV proxy path            | OpenHop path                 | Method | Observed shape |
|-------------------------------|------------------------------|--------|----------------|
| `GET /config/export`          | `/api/config_export`         | GET    | `{success, data:{meta, config}}` (data-nested). `?include_secrets=true` for full backup |
| `POST /config/import`         | `/api/config_import`         | POST   | `{success, message, restart_required, sections_updated}` (flat). Body `{config, restart_after}` |
| `GET /config/validate`        | `/api/validate_config`       | GET    | errors/warnings arrays of `{path, message}` (PROBE exact envelope) |
| `POST /config/radio`          | `/api/update_radio_config`   | POST   | `{success, data:{applied, live_update}}` (data-nested). Body: radio params (see below) |
| `POST /config/mode`           | `/api/set_mode`              | POST   | `{success, mode, persisted}` (flat). Body `{mode}` in forward\|monitor\|no_tx |
| `GET /config/hardware_options`| `/api/hardware_options`      | GET    | `{hardware:[{key, name, description, config}]}` (flat) |
| `GET /config/presets`         | `/api/radio_presets`         | GET    | `{presets:[...], source}` (flat) |
| `POST /config/restart`        | `/api/restart_service`       | POST   | PROBE exact shape + whether it needs container_supervisor |

Radio param body (`update_radio_config`, all optional, node validates ranges):
`tx_power` (2-30 dBm), `frequency` (Hz), `bandwidth` (Hz), `spreading_factor` (5-12),
`coding_rate` (5-8), `tx_delay_factor` (0.0-5.0), `direct_tx_delay_factor` (0.0-5.0),
`rx_delay_base` (>=0), `node_name`, `owner_info`, `latitude` (-90..90),
`longitude` (-180..180), `max_flood_hops` (0-64), `flood_advert_interval_hours`
(0 or 3-168), `advert_interval_minutes` (0 or 1-10080). freq/bw/sf/cr changes require a
node restart to take effect.

## Architecture

Same gated-proxy pattern as the existing panes.

- `_require_client()` builds an `OpenHopClient` only when detected + configured, else 409.
- Reads (`export`, `validate`, `hardware_options`, `presets`) go through `_relay`
  (transport failures -> 502).
- Writes and restart (`import`, `radio`, `mode`, `restart`) go through `_relay_upstream`
  so an upstream 503 (op only available under `container_supervisor`) reaches the client
  unchanged and the UI can show the right notice.

### Backend files

- Modify `app/services/openhop_api.py`: add config-family client methods
  (`config_export(include_secrets)`, `config_import(config, restart_after)`,
  `validate_config()`, `update_radio_config(params)`, `set_mode(mode)`,
  `hardware_options()`, `radio_presets()`, `restart_service()`).
- Modify `app/routers/openhop.py`: add the `/config/*` endpoints and their request models.
- No migration, no models/settings change (uses the existing url/token config).

### Frontend files

- New dir `frontend/src/components/settings/openhop/config/`:
  - `OpenHopConfigPane.tsx` (container, loads status/reads on mount, composes cards).
  - `ConfigOverviewCard.tsx` (validate button -> errors/warnings; current mode display).
  - `ConfigModeCard.tsx` (forward/monitor/no_tx selector -> set_mode).
  - `ConfigRadioCard.tsx` (editable radio form + preset selector -> update_radio_config;
    restart-required notice + Restart button).
  - `ConfigBackupRestoreCard.tsx` (export download incl. optional secrets; import upload
    -> config_import; restart-required notice + Restart button).
- Modify `SettingsOpenHopSection.tsx`: add the `Config` sub-nav tab.
- Modify `frontend/src/i18n/locales/{en,nl,de}.json`: new `openhop_config_*` keys.
- A small typed API helper for the `/config/*` calls, following the Policy/Plugins panes'
  fetch style.

## Data flow

Frontend card -> RTFM-EV `/api/openhop/config/*` (gated proxy) -> OpenHop node.
Reads on mount (export for current mode + meta, validate on demand, hardware/presets for
the radio form). Writes on explicit user action, each behind a confirm for the risky ones.

## Safety / confirmation model

Reuse the app convention: `window.confirm(t(...))` with explicit consequence text. No new
modal component.

- Radio param save: confirm text warns "may change the radio and drop the node off-mesh;
  freq/bandwidth/SF/coding-rate changes require a restart".
- config_import: confirm text warns "replaces the node configuration".
- Restart: confirm before `restart_service`.
- Export defaults to redacted. "Include secrets (full backup)" is an explicit opt-in
  checkbox with a warning that the downloaded file contains credentials and the identity
  key.

## Error handling

- 409 not configured: the tab is not rendered (pre-gated on `status.configured`).
- 502 transport error: inline error notice on the card, like the existing panes.
- Upstream status preserved (e.g., 503 when an op needs `container_supervisor`): the card
  shows the corresponding notice.
- Validation errors from `validate_config` render as a list, not an error state.

## Testing

- Backend `tests/test_openhop_router.py` (+ client test file): assert the gate returns 409
  when the node is not OpenHop / not configured; assert each `/config/*` endpoint delegates
  to the right client method with the right body; use `httpx.MockTransport` and a
  monkeypatched `device_model`, mirroring the existing plugin/policy router tests.
- Frontend Vitest: the Config tab is absent when `is_openhop` is false and present when
  configured; cards render; confirm-gated writes call the right endpoint; export builds a
  Blob; import reads a file and posts it.
- i18n EN/NL/DE parity test (enforced).

## Runtime verification

Start the OpenHop sim (container_supervisor entrypoint) + a throwaway RTFM-EV instance,
PATCH `/api/settings` with a freshly created OpenHop API token, then exercise each card and
capture screenshots: overview/validate, mode switch, a radio param save (+ restart notice),
export download (redacted and full), and import. CAD-style RF behaviour is out of scope;
the sim has no radio, so radio-param "applied" is verified as the config write + restart
signalling, not as an on-air change.

## Out of scope (YAGNI)

- Duty-cycle config, serial-port discovery, multi-radio `radio_id` targeting (the form
  targets the node's primary radio; `radios[]` handling is deferred).
- Any CAD / update-channel behaviour (separate panes).
- A type-to-confirm modal (app uses `window.confirm`).
