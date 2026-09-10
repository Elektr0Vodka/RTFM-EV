# DMC Observer MQTT Export (X1) — Design

Status: design, awaiting review
Date: 2026-09-10
Parity-audit item: X1 (MQTT `#raw`/`#status` export parity)

## Problem

The DMC (Dutch-MeshCore) observer firmware bridges repeater/room-server nodes
to MQTT with six publication types (`status`, `packets`, `raw`, `neighbors`,
`filter`, `config`) under `meshcore/{iata}/{device}/{type}`. The MeshCore
**companion** firmware has no MQTT of its own, so RTFM-EV must act as the
host-side bridge for a companion radio.

RTFM-EV already has a `mqtt_community` fanout module, but its wire schema is a
**different** lineage (`meshcore-packet-capture` / MeshCore Analyzer) and does
not match the DMC observer firmware byte-for-byte (verified: timestamp suffix,
`SNR`/`RSSI`/`path` types, normalized vs raw `stats`, missing `repeat`/`score`,
no dedicated `raw` topic). See the extraction report referenced below.

## Goals

- A new fanout module that mirrors the DMC observer firmware's `status`,
  `packets`, and `raw` MQTT topics and payload schemas for a companion radio.
- Per-topic enable toggles: `status` (default on), `packets` (default on),
  `raw` (default **off**).
- Configurable status publish interval: 1-60 minutes at the UI, stored in ms,
  runtime-clamped to `[1000, 3600000]` ms with a `300000` ms fallback (mirrors
  firmware `MQTTBridge.cpp:892-897` / `CommonCLI_Observer.cpp:371-380`).
- Faithful topic layout and payload field names/types/order.

## Non-goals (this iteration)

- `neighbors` (type 3), `filter` (type 4), `config` (type 5) topics. Noted as
  existing so topic names do not collide; deferred to the "Later" parity tier.
  Neighbor discovery is the separate X2 item.
- Changing or deprecating the existing `mqtt_community` module. It stays as-is.
- Ingest/subscribe (this is publish/export only).

## Approach

A new dedicated fanout type `mqtt_dmc_observer`, leaving `mqtt_community`
untouched. It reuses the shared MQTT connection machinery rather than
reimplementing it.

### Module + wiring

- New file `app/fanout/mqtt_dmc_observer.py` with:
  - `DmcObserverModule(FanoutModule)` — lifecycle + event hooks.
  - A publisher built on the shared connection loop in `app/fanout/mqtt_base.py`
    (`BaseMqttPublisher`), reusing the JWT/token builder, client-kwargs, and the
    topic/`origin_id` helpers currently in `app/fanout/community_mqtt.py`. Shared
    helpers that both modules need (JWT build, radio-info string, device-id hex,
    ISO timestamp) are factored into a small shared location (e.g. kept in
    `community_mqtt.py` and imported, or lifted to a `mqtt_shared.py` if that
    reads cleaner during implementation) — no behavior change to `mqtt_community`.
- Register in `app/fanout/manager.py` `_register_module_types()`:
  `_MODULE_TYPES["mqtt_dmc_observer"] = DmcObserverModule`.
- `app/routers/fanout.py`: add `"mqtt_dmc_observer"` to `_VALID_TYPES`, add
  `_validate_dmc_observer_config()`, wire it into create + update validation, and
  enforce scope in `_enforce_scope()`.
- Scope is fixed `{"messages": "none", "raw_packets": "all"}` (like community and
  map_upload) — this module consumes raw RF packets, not decoded messages.
- **No DB migration**: `fanout_configs` is generic (`type` + `config` JSON +
  `scope` JSON). A new type needs no schema change.

### Event hooks used

- `on_raw(data)` — drives the `packets` and `raw` topics (event-driven, matching
  firmware; no interval).
- `on_health(data)` — supplies the periodic `status` `stats` fields (the 60s
  radio health snapshot; see `app/fanout/AGENTS_fanout.md`).
- A module-owned async timer publishes `status` every `status_interval_ms`, and
  once immediately on each successful (re)connect (mirrors firmware
  `publishStatus`-on-connect).

## Config blob (`fanout_configs.config` JSON)

Connection knobs (reused from the community module's config shape):
`broker_host`, `broker_port`, `transport`, `use_tls`, `tls_verify`, `auth_mode`,
`username`, `password`, `iata`, `email`, `token_audience`, `websocket_path`.

New DMC knobs:

| Key | Type | Default | Notes |
|---|---|---|---|
| `publish_status` | bool | `true` | gate the `status` topic |
| `publish_packets` | bool | `true` | gate the `packets` topic |
| `publish_raw` | bool | `false` | gate the `raw` topic (OFF by default) |
| `status_interval_ms` | int | `300000` | clamped `[1000, 3600000]`; UI edits minutes (1-60) |

Validation (`_validate_dmc_observer_config`, only when enabled):
- `iata` required, 3 letters, not `"XXX"` (firmware requires a valid IATA for
  MeshCore-style topics).
- `broker_host` required.
- `status_interval_ms`, if present, coerced/clamped to `[1000, 3600000]`;
  out-of-range falls back to `300000` rather than erroring (mirrors firmware).
- Booleans default as above when absent.

## Topics (mirror firmware)

Layout `meshcore/{IATA}/{DEVICE}/{type}` where:
- `{IATA}` = uppercase 3-letter code from config.
- `{DEVICE}` = 64-char **uppercase** hex of the radio's Ed25519 public key.
- `{type}` ∈ `status` | `packets` | `raw`.

Retain/QoS (mirror firmware):
- `status`: QoS 1, **retained** (retain configurable per broker later; default
  retain true).
- `packets`, `raw`: never retained.
- **No Last-Will** message (faithful mirror; firmware has none — decision C).

## Payload schemas

Field names, order, and types below are taken from the firmware builders
(`src/helpers/MQTTPayloadBuilder.cpp`, `MQTTMessageBuilder.cpp`) as captured in
the schema extraction report. Timestamps are ISO-8601 UTC ending in **`+00:00`**
(never `Z`), microsecond precision, matching Python
`datetime.now(timezone.utc).isoformat()`.

### STATUS (`.../status`)

Insertion order: `status`, `timestamp`, `origin`, `origin_id`, `model`,
`firmware_version`, `radio`, `client_version`, `repeat`, `stats`.

- `status`: string, always `"online"`.
- `timestamp`: string, ISO-8601 UTC `+00:00`.
- `origin`: string, radio node name.
- `origin_id`: string, 64-char uppercase pubkey hex.
- `model`: string, board model.
- `firmware_version`: string.
- `radio`: string `"freq,bw,sf,cr"` (`"%.6f,%.1f,%d,%d"`).
- `client_version`: string (`"RemoteTerm/{version}-{commit}"`).
- `repeat`: string `"on"`/`"off"`. Companion is an endpoint, not a forwarding
  repeater, so this is `"off"` (decision A).
- `stats`: object; each sub-field omitted when the host has no value
  (firmware sentinel semantics). Fixed key set and order:
  `battery_mv`, `uptime_secs`, `packets_sent`, `packets_received`, `errors`,
  `queue_len`, `noise_floor`, `tx_air_secs`, `rx_air_secs`, `recv_errors`,
  `internal_heap`.

`stats` sourcing (decision A — omit unavailable + sensible maps):

| Field | Host source | Present? |
|---|---|---|
| `battery_mv` | `on_health.battery_mv` | when known |
| `uptime_secs` | `on_health.uptime_secs` | when known |
| `packets_sent` | `on_health.flood_tx + direct_tx` | when known |
| `packets_received` | `on_health.flood_rx + direct_rx` | when known |
| `noise_floor` | `on_health.noise_floor_dbm` | when known |
| `tx_air_secs` | `on_health.tx_air_secs` | when known |
| `rx_air_secs` | `on_health.rx_air_secs` | when known |
| `queue_len` | our own outbound publish-queue depth | always (host-owned) |
| `errors` | none | omitted |
| `recv_errors` | none | omitted |
| `internal_heap` | none | omitted |

### PACKETS (`.../packets`)

Insertion order: `timestamp`, `hash`, `origin`, `type`, `direction`, `time`,
`date`, `len`, `packet_type`, `route`, `payload_len`, `raw`, `origin_id`,
`SNR`, `RSSI`, `score`, `path`.

- `timestamp`: string, ISO-8601 UTC `+00:00`.
- `hash`: string, 16-hex-char **uppercase** packet hash (existing
  `calculate_packet_hash` in `app/path_utils.py`, already firmware-matched).
- `origin`: string, node name (fallback `"MeshCore Device"`).
- `type`: string, `"PACKET"`.
- `direction`: string, `"rx"` (host is receive-only).
- `time`: string `HH:MM:SS` UTC; `date`: string `DD/MM/YYYY` UTC.
- `len`, `packet_type`, `payload_len`: **strings** (numeric text).
- `route`: string. **Decision B — keep richer F/D/T**: emit the true 2-bit wire
  route via `_ROUTE_MAP = {0:"F",1:"F",2:"D",3:"T"}`; packets that decode to an
  unmapped route are dropped (not published), as the community module does.
  This intentionally diverges from firmware's runtime output (which only ever
  emits `F`/`D`); documented as a deliberate, more-informative choice.
- `raw`: string, **uppercase** hex of the full on-air wire packet.
- `origin_id`: string, 64-char uppercase pubkey hex.
- `SNR`: **string** `"%.1f"`, present only when a value exists (rx).
- `RSSI`: **string** `"%d"`, present only when a value exists (rx).
- `score`: **string**; host has no firmware rebroadcast score, so omitted
  (firmware also omits when NaN).
- `path`: **array** of lowercase hex hop tokens (each hop bounded to the
  packet's path-hash width, max 4 bytes), present only for direct-routed
  packets. This replaces the community module's comma-joined string.

### RAW (`.../raw`, off by default)

Fixed 5-field object, all always present: `origin`, `origin_id`, `timestamp`,
`type` (`"RAW"`), `data` (uppercase hex of the full on-air wire packet).

## Error handling

- Follow the `BaseMqttPublisher` reconnect/backoff loop already used by the
  community publisher; `status` property reports `connected`/`disconnected`/
  `error`.
- Missing radio self-info (name/pubkey/model/fw) at publish time: skip that
  publish cycle rather than emit a malformed/empty payload (same posture as the
  community module for the status path).
- If `iata` or device pubkey is unavailable, the module cannot build a valid
  topic — it stays `disconnected` with a `last_error` reason surfaced by the
  health endpoint.
- `status_interval_ms` out of range is clamped, never fatal.

## Frontend + i18n

- `frontend/src/components/settings/SettingsFanoutSection.tsx`:
  - Add to `TYPE_LABELS` / `TYPE_OPTIONS`: `mqtt_dmc_observer` → "DMC Observer".
  - New `DmcObserverConfigEditor`: broker host/port, transport/TLS, auth
    (token/user-pass), `iata`, `email`, and the DMC controls — three toggles
    (`publish_status`/`publish_packets`/`publish_raw`) and a status-interval
    field in **minutes** (1-60, mapped to `status_interval_ms`). No
    `ScopeSelector` (scope is fixed like community).
  - Default config + scope in `handleAddCreate`.
  - Wire into the detail-view conditional render.
- i18n: every new user-facing string uses `t()` with a domain prefix
  (`settings_fanout_` per existing convention), added to all three catalogs
  `frontend/src/i18n/locales/{en,nl,de}.json` with real NL/DE, keeping `_meta`
  intact. The `i18next/no-literal-string` guard is now at error level.

## Testing

Backend:
- `tests/test_fanout_integration.py`: enabled module receives `on_raw` and
  publishes to `packets` (and `raw` when enabled, not when disabled); disabled
  module publishes nothing; scope enforced.
- New unit tests (payload builders): STATUS/PACKETS/RAW schema snapshots
  (field names/order/types), timestamp `+00:00`, `SNR`/`RSSI` as strings,
  `path` as array, `route` mapping incl. `T` and drop-on-unmapped, `stats`
  field mapping + omission, uppercase device id/hash/raw.
- `_validate_dmc_observer_config`: required fields, IATA rules, interval clamp.

Frontend:
- `frontend/src/test/fanoutSection.test.tsx`: DMC editor renders, toggles and
  interval-minutes field round-trip into config, defaults correct
  (`publish_raw` off).

## Verification (before "done")

- `cd frontend && npm run lint` (0 errors), `npx tsc -p tsconfig.json --noEmit`,
  `npx vitest run` (green; use `--testTimeout=30000` on this Windows box).
- Backend: `pytest tests/test_fanout_integration.py` and the new unit tests
  (the ~13 pre-existing Windows env failures in test_mqtt/test_fanout_integration
  are known-flaky per project memory; new tests must pass).
- Byte-level payload comparison of a captured host publish against the firmware
  example JSON in the schema report.
- Live: configure the module against a test broker, confirm topics
  `meshcore/{IATA}/{DEVICE}/{status,packets}` appear with correct schemas, raw
  off by default, and status cadence honors the configured interval.

## Files to touch

| File | Change |
|---|---|
| `app/fanout/mqtt_dmc_observer.py` | new module + publisher/payload builders |
| `app/fanout/community_mqtt.py` (or new `mqtt_shared.py`) | factor out shared JWT/topic/timestamp helpers (no behavior change) |
| `app/fanout/manager.py` | register `mqtt_dmc_observer` |
| `app/routers/fanout.py` | `_VALID_TYPES` + validator + scope enforcement |
| `frontend/src/components/settings/SettingsFanoutSection.tsx` | type entry + editor + defaults + wiring |
| `frontend/src/i18n/locales/{en,nl,de}.json` | new keys (real NL/DE) |
| `tests/test_fanout_integration.py` + new unit test file | backend tests |
| `frontend/src/test/fanoutSection.test.tsx` | frontend editor test |
| `app/fanout/AGENTS_fanout.md` | document the new module type |

## Reference

Firmware schema extraction + host diff (verified 2026-09-10 against branch
`dmc-observer-dev-1171-regiongating`): the deltas summarized here are drawn from
that analysis of `MQTTPayloadBuilder.cpp` / `MQTTMessageBuilder.cpp` /
`MQTTTopicRouter.h` / `MQTTDefaults.h`. Key confirmed constants: status interval
CLI 1-60 min default 5 (300000 ms), bridge clamp 1000-3600000 ms; per-topic
defaults status on / packets on / raw off; packets and raw are event-driven.
