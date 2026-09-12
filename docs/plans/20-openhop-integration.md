# [20] OpenHop integration (radio-over-TCP + REST management)

Date: 2026-09-11
Category: F (firmware/node-aware management; sibling of [10])
Model: Opus
State: Partial (Surface A verified against a simulated OpenHop node 2026-09-11; Surface B management absent)
Status: local planning only. No PRs, no issues, no commits from this plan.

Primary references (code is truth):

- OpenHop repeater daemon `openhop-dev/openhop_repeater`, branch `main`. Verified via
  raw source + GitHub tree API on 2026-09-11. Key files: `repeater/handler_helpers/mesh_cli.py`,
  `repeater/companion/frame_server.py`, `repeater/web/openapi.yaml` (5947 lines, saved
  locally to the session scratchpad and read directly), `repeater/web/http_server.py`,
  `repeater/web/*_endpoints.py`, `repeater/policy_engine.py`, `repeater/plugins/`.
- OpenHop core library `openhop-dev/openhop_core`, branch `main`. Key files:
  `src/openhop_core/companion/constants.py`, `.../frame_server/commands_device.py`,
  `.../frame_server/commands_messaging.py`, `.../companion/models.py`.
- RTFM-EV (this branch): `app/config.py`, `app/radio.py`, `app/services/flood_scope.py`,
  `app/routers/repeaters.py`, `app/routers/server_control.py`,
  `frontend/src/components/RepeaterDashboard.tsx`, `frontend/src/hooks/useRepeaterDashboard.ts`.
- Sibling plan `docs/plans/10-dmc-firmware-aware-mgmt.md` (firmware-class detection + gating).

Evidence-quality note: RTFM-EV citations below are direct reads/greps on this branch
(FACT). The OpenHop REST **path/tag/summary index** was read directly from the downloaded
`openapi.yaml` (FACT for endpoint names, methods, tags, summaries; per-endpoint
request/response schemas were NOT read). OpenHop **Python source** (companion opcodes,
command handlers, CLI verbs, HTTP server) was read through a summarizing web-fetch, so
exact constants/line numbers are marked "reported by source" and must be re-verified
against the files before writing code that depends on them.

---

## 1. Summary

OpenHop (`openhop_repeater`, built on `openhop_core`) is a MeshCore-compatible
repeater / room-server **daemon written in Python** for LoRa on low-power Linux hardware
(Raspberry Pi, Luckfox, uConsole; SX1262 over SPI/CH341, OpenHop Modem over TCP/USB,
KISS). It is not a new protocol. It speaks MeshCore on RF and implements the MeshCore
companion protocol, so RTFM-EV already interoperates with it at the packet level.

Two independent integration surfaces, at two different levels of effort:

- **Surface A: OpenHop as RTFM-EV's own radio, over TCP.** Works today with zero OpenHop
  specific code. OpenHop runs a companion frame server (default TCP port 5000) that
  implements the standard MeshCore companion protocol, including private-key export and
  device query. RTFM-EV already supports TCP transport. The only OpenHop-specific work is
  cosmetic identity surfacing plus one defensive gate.
- **Surface B: OpenHop-specific node management, over its REST API.** OpenHop ships a
  documented OpenAPI 3.0 HTTP API (CherryPy) with JWT + API-token auth exposing its
  distinctive features that are NOT reachable over the companion link or RF: the packet
  **policy/filter engine**, **plugin** lifecycle, node **config** import/export,
  **update** channels, **transport-key/region-scope** management, **CAD calibration**,
  and a `POST /cli` passthrough. This is a larger, opt-in, per-node integration.

The companion TCP link carries **no OpenHop-specific settings** (see 3.2). Everything
distinctive about OpenHop is administered over the REST API, the mesh CLI, or config
files. So "support the settings OpenHop might add" means Surface B, not the TCP link.

---

## 2. Current state (RTFM-EV today)

Cited from source on this branch.

- **TCP transport is complete.** `Settings` exposes `serial_port` / `tcp_host` /
  `tcp_port` (default **5000**) / `ble_address`, with one-transport-at-a-time validation
  and a `connection_type` property (`app/config.py:14-66`). `RadioManager._connect_tcp`
  calls `MeshCore.create_tcp(host, port)` (`app/radio.py:522-537`). Setting
  `MESHCORE_TCP_HOST=<openhop-ip>` selects TCP. FACT.
- **Companion-firmware quirks already handled.** RTFM-EV extracts DM ACKs from the raw RF
  packet as well as the host frame, explicitly "for companion firmwares (e.g. pyMC over
  TCP) that do not reliably emit a separate host ACK frame" (`app/AGENTS.md:144`). pyMC is
  OpenHop's direct ancestor, so this workaround likely already covers OpenHop. FACT
  (documented); NOT VERIFIED against a live OpenHop node.
- **Firmware-version gating exists.** `flood_scope.py` gates the mode-1 unscoped command
  on `fw_ver >= 12` and treats unknown as unsupported (`app/services/flood_scope.py:21-54`).
  `GET /radio/config` reports `path_hash_mode_supported` (`app/AGENTS.md:239`). These read
  the numeric firmware/protocol code from `DEVICE_INFO`. FACT.
- **Repeater dashboard drives a node over the encrypted CLI.** Panes batch verbs such as
  `ver`, `get name/lat/lon`, `clock`, `get radio/tx/af/dutycycle/repeat/flood.max`,
  `get advert.interval`, `region`, `get guest.password`
  (`app/routers/repeaters.py:386-467, 610`). Unsupported fields are dropped only when the
  reply starts with `??` or `error` (`app/routers/repeaters.py:356-364`). No pane is
  firmware-conditional today. FACT.
- **No device-identity column on contacts** (per plan [10] §2, `app/database.py`). FACT.

---

## 3. Reference research (OpenHop)

### 3.1 What OpenHop exposes over the companion TCP link (Surface A)

Reported by source (`openhop_core`, read via summarizer; re-verify constants before coding):

- **Companion protocol is stock MeshCore.** `companion/constants.py` defines command codes
  `CMD_APP_START=1` .. `CMD_SEND_RAW_PACKET=65`, response codes `0..28`, push codes
  `0x80..0x90`. These match the standard MeshCore companion numbering; the gaps (44-49, 53)
  are unimplemented standard codes, not extensions.
- **Device/self-info is complete.** `frame_server/commands_device.py` implements
  `_cmd_app_start` (self-info: pubkey, name, freq/bw/sf/cr, tx power, lat/lon),
  `_cmd_device_query` -> `RESP_CODE_DEVICE_INFO` carrying `FIRMWARE_VER_CODE`,
  `MAX_CONTACTS/2`, `MAX_GROUP_CHANNELS`, ble_pin, plus build date (12 B), manufacturer
  (40 B), version string (20 B), path-hash-mode and client-repeat fields.
- **Setup-critical commands present:** `_cmd_get/set_device_time` (clock sync),
  `_cmd_export_private_key` (64-byte MeshCore key, needed by RTFM-EV for DM decryption),
  `_cmd_set_radio_params` / `_cmd_set_tx_power` / `_cmd_set_path_hash_mode`,
  `_cmd_set_flood_scope` / default-scope get/set. Only `_cmd_import_private_key` is stubbed
  (`RESP_CODE_DISABLED`); RTFM-EV does not use it.
- **Messaging is bidirectional.** `frame_server/commands_messaging.py` implements
  `_cmd_send_txt_msg`, `_cmd_send_channel_txt_msg`, `_cmd_send_channel_data`, anon/path/
  trace/raw sends, and `_cmd_sync_next_message` (cmd 52).
- **NodePrefs are standard** (`companion/models.py`): `node_name` (default `"pyMC"`),
  radio params, `advert_loc_policy`, `multi_acks`, telemetry modes, `autoadd_config`,
  `airtime_factor`, `rx_delay_base`, `path_hash_mode`, `default_scope_*`. Nothing
  proprietary.
- **Identity:** the repeater's companion server reports `device_model =
  "openHop-Repeater-Companion"` (`repeater/companion/frame_server.py`) and listens on TCP,
  default port **5000**.

Consequence: over TCP, an OpenHop node behaves as a standard MeshCore companion radio.
There is no OpenHop-specific setting to build here.

### 3.2 What OpenHop exposes only off the companion link

- **Mesh admin CLI** (`repeater/handler_helpers/mesh_cli.py`, reported by source):
  `ver` returns `openHop_<role> v<version>` (role `repeater`/`room_server`, version
  default `13`); unknown verbs return the literal string `"Unknown command"` (NOT the
  firmware `??` sentinel); it supports `get/set` (~25 params), `region`
  (`load/def/save/allowf/denyf/get/home/default/put/remove/list`), `neighbors`,
  `neighbor.remove`, `discover.neighbors`, `discover.scopes`, `advert`, `reboot`, `clock`,
  `password`, `setperm`, `http start/stop`, `log start/stop/erase`, `tempradio`, `help`.
  It does NOT support `board` or the DMC `filter` family (OpenHop filters via
  `policy_engine.py`).
- **Packet filtering** is OpenHop's `policy_engine.py`, configured over REST, not RF.
- **Plugins, modem selection, sensors, MQTT, web frontends, updates** are configured over
  REST / config files, not the companion link.

### 3.3 OpenHop REST API (Surface B)

Source: `repeater/web/openapi.yaml` (title "openHop Repeater API", v1.0.0), read directly.
~130 endpoints. FACT for names/methods/tags/summaries; per-endpoint schemas not yet read.

- **Server / transport.** `http_server.py` uses **CherryPy**, binds `0.0.0.0`, default port
  **8000** (reported by source). The OpenAPI `servers` block uses `:8080` in its examples;
  the two disagree, so the effective port is deployment-specific. OPEN QUESTION: confirm the
  real default and whether the server is auto-started or gated behind `http start` / a
  config flag (`start()`/`stop()` methods exist; caller decides). Base path `/api`; auth
  endpoints under `/`.
- **Auth.** `POST /auth/login` (JWT), `POST /auth/refresh`, `GET /auth/verify`,
  `POST /auth/change_password`, and API tokens `GET/POST /auth/tokens`,
  `DELETE /auth/tokens/{token_id}`. Bearer auth. So RTFM-EV can authenticate with a
  user-supplied API token; no password storage needed.
- **Endpoint groups (by the spec's own tags):**

  | Tag | Representative endpoints | Notes |
  |---|---|---|
  | Network Policy | `/policy` (get/set), `/policy_validate`, `/policy_groups` (CRUD), `/policy_group_entries` (CRUD), `/unscoped_flood_policy`, `/default_region`, `/ping_neighbor`, `/discover_neighbors_start`, `/discover_neighbors_stream` (SSE), `/add_discovered_neighbor` | OpenHop's packet-filter engine + neighbour discovery. NET-NEW for RTFM-EV. |
  | Transport Keys | `/transport_keys` (CRUD), `/transport_key`, `/neighbor_scopes`, `/query_neighbor_scopes` | Region-gating / scope management. Ties to RTFM-EV `known_regions`. |
  | Packets | `/recent_packets`, `/filtered_packets`, `/bulk_packets`, `/packet_stats`, `/packet_type_stats`, `/route_stats`, `/packet_by_hash`, `/packet_by_id`, `/neighbor_links`, `/neighbor_link_history` | Node-local packet DB. Overlaps RTFM-EV `raw_packets`. |
  | Charts | `/rrd_data`, `/packet_type_graph_data`, `/metrics_graph_data`, `/lbt_diagnostics`, `/airtime_chart_data` | Server-aggregated time series. |
  | Noise Floor | `/noise_floor_history`, `/noise_floor_stats`, `/noise_floor_chart_data` | Overlaps RTFM-EV noise-floor history. |
  | CAD Calibration | `/cad_calibration_start/stop/stream`, `/cad_manual_check`, `/save_cad_settings` | RF CAD tuning. Aligns with the CAD plan [06]. NET-NEW. |
  | Adverts | `/adverts_by_contact_type`, `/adverts_count_by_contact_type`, `/advert` (delete), `/advert_rate_limit_stats`, `/update_advert_rate_limit_config` | |
  | Identities | `/create_identity`, `/identities`, `/identity`, `/update_identity`, `/delete_identity`, `/send_room_server_advert`, `/generate_vanity_key` | Multi-identity host. Ties to backlog [18]. |
  | ACL | `/acl_info`, `/acl_clients`, `/acl_remove_client`, `/acl_stats` | Room/repeater ACL as REST. |
  | Room Server | `/room_messages`, `/room_post_message`, `/room_stats`, `/room_clients`, `/room_message` (delete), `/room_messages_clear` | Overlaps RTFM-EV room flows. |
  | MQTT / System | `/mqtt_status`, `/broker_presets`, `/update_mqtt_config`, `/publish_neighbors`, `/stats`, `/hardware_stats`, `/hardware_processes`, `/logs(_stream)`, `/restart_service`, `/site_info`, `/needs_setup`, `/gps(_stream)`, `/db_stats/purge/vacuum`, `/memory_debug` | On-device MQTT ties to plan [11]. |
  | Config | `/config_export`, `/config_import`, `/validate_config`, `/update_radio_config`, `/update_web_config`, `/update_duty_cycle_config`, `/set_duty_cycle`, `/set_mode`, `/setup_wizard`, `/hardware_options`, `/radio_presets`, `/serial_ports`, `/web_frontends` | Full node config. NET-NEW. |
  | Update (OTA) | `/update/check`, `/update/install`, `/update/status`, `/update/channels`, `/update/set_channel`, `/update/changelog`, `/update/progress` (SSE) | HTTP self-update with channels. NET-NEW; cleaner than plan [10] phase-4 OTA. |
  | Plugins | `/plugins`, `/plugins/catalogue`, `/plugins/catalogue_install`, `/plugins/updates`, `/plugins/update`, `/plugins/install`, `/plugins/enable`, `/plugins/disable`, `/plugins/start`, `/plugins/stop`, `/plugins/restart`, `/plugins/settings`, `/plugins/runtime`, `/plugins/logs`, `/plugins/uninstall`, `/plugins/{id}`, `/plugins/progress` (SSE) | Full plugin lifecycle. This is "the other options OpenHop might add." NET-NEW. |
  | Companion (over HTTP) | `/companion/self_info`, `/companion/contacts`, `/companion/channels`, `/companion/stats`, `/companion/send_text`, `/companion/send_channel_message`, `/companion/login`, `/companion/request_status`, `/companion/request_telemetry`, `/companion/send_command`, `/companion/reset_path`, `/companion/set_advert_name`, `/companion/set_advert_location`, `/companion/import_repeater_contacts`, `/companion/events` (SSE), plus a WS proxy (`companion_ws_proxy.py`) | Companion ops exposed over HTTP/WS; alternative to raw TCP. |
  | CLI | `POST /cli` | Executes any mesh-CLI verb over HTTP. Single hook for command-level control with no RF cost. |

---

## 4. Design

### 4.1 Surface A: OpenHop as a radio over TCP (near-zero code)

Already functional. To make it first-class:

1. **Identity surfacing.** On connect, `DEVICE_INFO` carries manufacturer/version string
   and the companion reports `device_model = "openHop-Repeater-Companion"`. Surface
   "OpenHop" in the existing My Node / About view. No new RF/frame round-trip; read what
   `DEVICE_INFO` already returns.
2. **Defensive gate.** Ensure the private-key import path is never invoked (OpenHop stubs
   it as `RESP_CODE_DISABLED`); RTFM-EV does not use it today, so this is an assertion, not
   a change.
3. **Verify `FIRMWARE_VER_CODE`.** Confirm the numeric code OpenHop reports so
   `flood_scope` unscoped-mode (`>= 12`) and `path_hash_mode_supported` gate correctly.
   The CLI `ver` says `v13`, but that is OpenHop's own numbering, not necessarily the
   companion `FIRMWARE_VER_CODE`. OPEN QUESTION until observed on a live node.

No migration, no new endpoint. This slice is a live-connection verification plus a small
UI label.

### 4.2 Surface B: OpenHop-specific management over REST (opt-in, per node)

Add an optional per-node REST client, gated on the node being identified as OpenHop.

- **Connection config.** Per contact (or per connected radio), store an OpenHop API base
  URL + API token. For the connected-own-node case, derive the host from `tcp_host` and
  default the port (8000 or 8080 pending §3.3), user-confirmable. For a remote OpenHop node
  the user supplies host + token. Credentials are user-driven: the user creates an API token
  in OpenHop and pastes it; RTFM-EV never creates accounts or stores the admin password.
- **Backend client.** A thin `app/services/openhop_api.py` (httpx) with typed models per
  endpoint group, mirroring the fanout/repository typing ethos in `app/AGENTS.md`. Read
  the per-endpoint schemas from `openapi.yaml` before typing each group; do not assume
  shapes.
- **Scope, do not wrap all 130 endpoints.** Prioritise NET-NEW value:
  1. `POST /cli` passthrough (cheapest; unlocks command-level control immediately) and
     `GET /site_info` / `GET /stats` / `GET /needs_setup` (identity + liveness probe).
  2. **Policy pane** (`/policy*`, `/policy_groups*`, `/unscoped_flood_policy`,
     `/default_region`) - the packet-filter management UI.
  3. **Plugins pane** (`/plugins*`) - list/install/enable/disable/logs.
  4. **Config + Update** (`/config_export|import`, `/validate_config`,
     `/update_radio_config`, `/update/*`).
  5. Optional later: transport keys/scopes, CAD calibration, MQTT config, packet/chart
     analytics (mostly overlap with RTFM-EV's own data).
- **Frontend.** New OpenHop-only panes/tabs, shown only when the node is identified as
  OpenHop and a reachable API base + token are configured, mirroring the capability-gating
  pattern proposed in plan [10] §4.3. Fail closed for Surface B (hide unless configured and
  reachable), the opposite of Surface A detection which fails open.
- **Availability.** The web server may be off (§3.3). Treat "no HTTP" as "management not
  available", never as "not OpenHop". Detect OpenHop primarily from the companion
  `device_model` (Surface A) or the CLI `ver` `openHop_` token (Surface A-style, for a
  managed remote node), then probe REST only when the user has configured it.

### 4.3 Detecting "this node is OpenHop"

Two paths, matching the two surfaces:

- Connected own node: `device_model == "openHop-Repeater-Companion"` in `DEVICE_INFO`.
  FACT-derived, no extra round-trip.
- Remote managed node (repeater/room contact): CLI `ver` reply begins `openHop_`. This is
  the OpenHop analogue of plan [10]'s firmware-class detection; if plan [10] lands first,
  add `openhop` as a fourth `FirmwareClass` and reuse its classifier + capability map. Note
  OpenHop returns `"Unknown command"` (not `??`) for unknown verbs, so the existing
  sentinel filter (`repeaters.py:356-364`) must be extended if OpenHop remote CLI is gated
  through that path, and OpenHop lacks `board` and `filter`.

---

## 5. Phasing

1. **Surface A hardening (S).** Live-connect an OpenHop node over TCP, observe full
   `post_connect_setup` (key export, time sync, contact/channel sync, channel-slot offload
   via `MAX_GROUP_CHANNELS`, path-hash-mode), confirm `FIRMWARE_VER_CODE` gates, surface the
   "OpenHop" identity label. Highest value, lowest risk. Mostly verification.
2. **OpenHop identity + REST connection plumbing (S-M).** Per-node API base + token
   storage, `openhop_api.py` client, `GET /site_info` + `POST /cli` passthrough, an
   "OpenHop management" entry point that appears only when identified + configured.
3. **Policy pane (M).** Typed `/policy*` client + UI. The core NET-NEW capability.
4. **Plugins + Config + Update panes (M).** `/plugins*`, `/config_*`, `/update/*`.
5. **Optional (M-L).** Transport keys/scopes, CAD calibration, MQTT config, analytics.

Phases 1-2 are independent of plan [10]. Phase 3+ reuses plan [10]'s gating pattern if it
exists, but does not depend on it.

---

## 6. Risks and open questions

- **Live behaviour NOT VERIFIED.** No OpenHop node was connected in this investigation.
  Per CLAUDE.md, no "works" claim until a real connect + setup is observed. Surface A rests
  on the companion protocol being a faithful MeshCore implementation (strong evidence, not
  proof).
- **OpenHop Python source read via summarizer.** Companion opcodes, command handlers, CLI
  verbs, and the HTTP server port were read through a summarizing fetch. Re-verify against
  the files (or a checkout) before writing dependent code. The REST path index is a direct
  read and is reliable for names/methods/tags/summaries; per-endpoint schemas are not read.
- **HTTP port + auto-start (OPEN).** `http_server.py` default 8000 vs OpenAPI `:8080`
  examples; and whether the server runs by default or needs `http start` / a config flag.
- **`FIRMWARE_VER_CODE` value (OPEN).** Needed for `flood_scope` / `path_hash_mode` gating.
- **API surface is large.** Do not wrap all 130 endpoints; scope to NET-NEW value.
- **Credential posture.** API token is user-created and user-supplied; RTFM-EV must not
  create accounts, store the admin password, or auto-submit credentials. LAN HTTP fits the
  app's trusted-network posture (`app/AGENTS.md` "Security Posture").
- **OpenHop is actively developed** (plugin catalogue + GitHub-release updater), so the
  REST surface will grow. Version the client against `GET /openapi` where practical and
  fail soft on unknown fields.
- **No hardware-free radio ships (FACT).** OpenHop has no null/mock modem backend, so a
  container sim needs a mock backend or a stub TCP modem (see §7.1). This is test-harness
  work, not a blocker for the plan itself.

---

## 7. Verification plan

- **Surface A (required):** connect RTFM-EV to a running OpenHop node via
  `MESHCORE_TCP_HOST`; observe successful `post_connect_setup`, DM send/receive, and read
  the reported `device_model` and `FIRMWARE_VER_CODE`. Confirm no `flood_scope` /
  path-hash-mode regression. Runtime behaviour observed, not inferred. VERIFIED 2026-09-11
  against a containerized no-hardware OpenHop node (see §7.1/§7.2); full-backend UI run and
  two-node message delivery still pending.
- **Surface B (per group):** against the node's REST API with a test API token, exercise
  `GET /site_info`, `POST /cli`, and each wrapped group read-only first, then writes behind
  explicit confirm. Read the `openapi.yaml` schema for each endpoint before typing it.
- **Backend unit tests:** classifier for `device_model` / `ver` `openHop_` detection; a
  mocked `openhop_api` client (httpx transport mock) for each wrapped group; extend
  `tests/test_radio.py` for the TCP-identity path.
- **Frontend tests:** OpenHop panes mount only when identified + configured + reachable
  (fail-closed), and are hidden otherwise.
- Whole-repo gate before finishing code: `./scripts/quality/all_quality.sh`.

### 7.1 Simulating OpenHop in a container (no LoRa hardware)

Facts (OpenHop repos, 2026-09-11): OpenHop already ships `dockerfile`,
`docker-compose.yml`, `docker-compose.build.yml`, `docker-entrypoint.sh`,
`config.yaml.example`, and a 100+ file `tests/` suite that runs the engine without
hardware. So containerising OpenHop is solved; the only obstacle is that OpenHop has **no
built-in null/mock radio** (`hardware/base.py` `LoRaRadio` ABC; `modem_config` accepts only
`modem_tcp` / `modem_usb`).

For Surface A the handshake RTFM-EV needs (device query, private-key export, time sync,
contact/channel sync) is served from OpenHop's local identity + SQLite by the companion
frame server (TCP 5000) and does not require RF. The daemon does need a modem to boot, so
one of these makes it boot hardware-free:

1. **Mock radio backend (recommended, cleanest).** Subclass `LoRaRadio` with 6 no-op
   methods (`begin`, `async send` -> return dummy airtime, `async wait_for_rx` -> await an
   event that never fires, `sleep`, `get_last_rssi`, `get_last_snr` -> constants), ~15
   lines. Reuse or adapt the fake radio the OpenHop test suite already uses
   (`test_engine.py` / `test_packet_router.py` run without hardware). Requires locating the
   `radio_type` -> backend dispatch (not in `base.py`; likely `engine.py` / `modem_config.py`)
   to register a `modem_mock` type or monkeypatch it in the entrypoint. Small patch to
   `openhop_core`; potentially upstreamable as a `--dev`/`mock` modem.
2. **Stub TCP modem server (no fork).** `modem_tcp` connects OpenHop as a TCP client to a
   modem at `host:5055` over a custom binary frame (SYNC + cmd + 2-byte len + payload +
   CRC16-CCITT, per `tcp_radio.py` + `protocol_constants.py`). A ~1 file stub server that
   answers auth/ping/config and accepts TX (returns airtime) while never delivering RX lets
   OpenHop run unmodified via `radio_type: modem_tcp`. Moderate effort (must reimplement the
   frame syntax + command dispatch).

Compose sketch (single node, handshake verification): one `openhop` service (its own image)
+ the mock/stub radio, exposing companion TCP 5000 and REST 8000; point RTFM-EV at it with
`MESHCORE_TCP_HOST=<container>` and, for Surface B, the REST base + an API token.

Two-node RF simulation (only if end-to-end message delivery must be tested): run two OpenHop
containers whose mock radios attach to a shared "virtual RF" bus (a tiny broker that echoes
each `send` to the other's `wait_for_rx`). RTFM-EV connects to node A and messages node B.
This is a fuller sim and more work; the single-node handshake covers Surface A's core.

RESOLVED (2026-09-11, prototyped): (a) `NullRadio` is built in - OpenHop needs no mock at
all. `repeater/config.py` defines `NullRadio` and `build_radio_stack` selects it when
`radio_type in ("", "none", "null", "disabled", "off", "no_radio")` (config.py:486-494).
(b) the companion frame server boots fine with `NullRadio` - observed. (c) license is MIT.

### 7.2 Verified result (2026-09-11, observed - NOT inferred)

Prototyped a hardware-free OpenHop node in Docker and connected RTFM-EV's exact client
stack (`meshcore==2.3.9.1`, same calls as `radio_lifecycle`/`keystore`).

Recipe (no OpenHop code changes):
- `git clone` `openhop_repeater` (MIT). `docker build -t openhop-sim:local .`.
- Config = `config.yaml.example` with `radio_type: null` (its default) plus one
  `repeater.companions:` entry (`identity_key` = `openssl rand -hex 32`, `tcp_port: 5000`).
  Repeater identity auto-generates (`identity_file: null`).
- Run bypassing the shell entrypoint (Windows CRLF made `tini` fail to exec
  `docker-entrypoint.sh`; a clean checkout with LF endings, or `dos2unix`, fixes it):
  `docker run --entrypoint python3 ... openhop-sim:local -m repeater.main --config <cfg>`,
  publishing `5000` (companion) and `8000` (REST).

Observed:
- OpenHop log: `CompanionFrameServer - INFO - Companion frame server listening on
  0.0.0.0:5000` with `radio_type: null`. Companion server boots with no radio.
- `create_tcp` connected; `self_info` parsed (name, pubkey, radio params).
- `send_device_query` -> `{'fw ver': 13, 'max_contacts': 510, 'max_channels': 40,
  'model': 'openHop-Repeater-Companion', 'fw_build': '13 Feb 2026', 'path_hash_mode': 0}`.
- `export_private_key` -> `EventType.PRIVATE_KEY`, 64-byte key (DM decryption works).
- `get_bat` and `get_contacts` both answered.

Confirms: (1) `device_model = "openHop-Repeater-Companion"` is the Surface A identity signal;
(2) `FIRMWARE_VER_CODE = 13` (>= 12), so `flood_scope` unscoped-mode and `path_hash_mode`
gates behave correctly; (3) `max_channels = 40` for channel-slot offload; (4) private-key
export is available.

Full RTFM-EV backend also run against the sim (2026-09-11, observed):
`MESHCORE_TCP_HOST=127.0.0.1 MESHCORE_TCP_PORT=5000 MESHCORE_DATABASE_PATH=<throwaway>
uv run uvicorn app.main:app --port 8020`. Logs showed the entire connect path succeed with
no errors: `Radio reconnected successfully at TCP: 127.0.0.1:5000` -> `Private key stored in
keystore (public key: 983348a48a9b...)` -> `Path hash mode: 0 (supported)` -> `Radio device
info: model=openHop-Repeater-Companion ... max_channels=40` -> `Max channel slots: 40` ->
`Sync complete: 0 contacts synced, 1 channels synced` -> `Post-connect setup complete`.
`GET /api/health` returns `radio_connected: true`, `connection_info: "TCP: 127.0.0.1:5000"`,
`radio_device_info.model: "openHop-Repeater-Companion"`, `is_meshcomod: false`;
`GET /api/radio/config` returns name `OpenHopSim`, `path_hash_mode_supported: true`.

Surface A identity hook (§4.1): the health payload already carries `radio_device_info.model`
and an `is_meshcomod` flag. Adding an `is_openhop` (model == "openHop-Repeater-Companion")
alongside it, and a label in My Node/About, is the entire productization delta for the
own-node case.

Not yet run: two-node message delivery (two OpenHop containers on a shared virtual-RF bus).

---

## 8. Effort

Rough, for scoping only:

- Phase 1 Surface A hardening: **S** (mostly live verification + one UI label).
- Phase 2 REST plumbing + CLI passthrough: **S-M**.
- Phase 3 Policy pane: **M**.
- Phase 4 Plugins/Config/Update panes: **M**.
- Phase 5 optional groups: **M-L**.
- Simulation harness (§7.1): **S** for the mock-radio backend + single-node compose;
  **M** for a stub TCP modem or a two-node virtual-RF bus.

Surface A alone is a small, high-confidence win. Surface B is where the "OpenHop-specific
settings" live and is genuinely rich, but it is an opt-in per-node REST integration, not a
protocol change.

---

## Reconciliation

- **Plan [10] DMC firmware-aware management.** Sibling. OpenHop remote-node detection reuses
  [10]'s classifier + capability-gating pattern (add `openhop` as a fourth class). OpenHop's
  REST API makes its "webconfig/OTA" analogue (plan [10] §4.5) far richer and fully
  documented, and resolves [10]'s node-IP open question for the connected-own-node case
  (host = `tcp_host`).
- **Plan [11] DMC-MQTT ingest / NOC.** OpenHop also has on-device MQTT (`/mqtt_status`,
  `/update_mqtt_config`, `/publish_neighbors`); any MQTT ingestion should treat OpenHop as a
  publisher alongside DMC observers, not a separate pipeline.
- **Backlog [18] multi-radio identity, plan [06] CAD.** OpenHop `/identities*` and `/cad_*`
  are concrete data sources for those.
- **README.md plan index.** This entry [20] is new and is not yet listed in
  `docs/plans/README.md`; add a row + delivery-table status if this plan is adopted.
- **Distinct from Surface-B-over-companion.** The companion TCP link carries no
  OpenHop-specific settings (§3.1-3.2); do not attempt to add OpenHop management there.
