# [11] DMC MQTT ingestion + "My Local Nodes / My Mesh NOC"

Date: 2026-09-10
Category: F (DMC firmware-aware node management)
Model: Opus
State: Absent (greenfield backend subscriber + frontend page; reuses existing broker-config and telemetry-history patterns)
Scope: local planning only. No PRs, no issues, no commits. Code-is-truth: every
non-obvious claim below cites `file:line` in either RTFM-EV or the DMC firmware.

## Origin of this plan (contributor idea, verbatim)

This plan realises a Dutch contributor's "My Mesh NOC" suggestion. Quoted verbatim:

> "iets van een 'My Mesh NOC' pagina met beheer en filter/telemetry status
> updates over wifi wanneer je repeaters/observers/roomservers verbonden zijn met
> hetzelfde netwerk ... en de Letsmesh/DMC MQTT-firmware draait, aangezien daar
> toch al MQTT, webconfig en wifi op draaien."

Reading: a page that manages your own repeaters/observers/room-servers and shows
their filter/telemetry/status updates, pulled over wifi (same LAN) from nodes that
run the DMC/Letsmesh MQTT firmware, which already has MQTT + webconfig + wifi.

---

## 1. Summary

RTFM-EV today speaks MQTT only **outbound**: the fanout bus publishes local mesh
events to brokers (`app/fanout/mqtt.py`, `app/fanout/mqtt_base.py`). This plan adds
the **inbound** direction: subscribe to the MQTT topics that DMC-MQTT firmware nodes
(repeaters / observers / room-servers) already publish to a broker on the same wifi
(or reachable via tailscale/VPN), store their status / config / filter / neighbors
snapshots as per-node history, and surface a dedicated "My Local Nodes / My Mesh
NOC" page with per-node management plus historical panels.

This is the **inbound complement to parity item X1** (outbound MQTT export). The two
share broker connection config; this plan reuses the `fanout_configs` broker-config
shape rather than inventing a parallel store (`docs/parity-audit.md` §"Next" X1;
`docs/plans/README.md:140`).

Feasibility headline, VERIFIED against firmware: the DMC-MQTT bridge is
**publish-only**. It registers `onConnect` / `onDisconnect` / `onError` handlers and
never subscribes to any topic or handles inbound MQTT data
(`src/helpers/bridges/MQTTBridge.cpp:1651,1682,1695`; no `esp_mqtt_client_subscribe`
or `MQTT_EVENT_DATA` anywhere in `src/`). Therefore **there is no MQTT command/control
topic**. Remote management, if built, must go over the existing MeshCore RF/serial CLI
path RTFM-EV already drives (`POST /api/contacts/{public_key}/command`,
`app/routers/repeaters.py`), not over MQTT. Phasing reflects that: ingest + display
first, then history, then (optional, RF-CLI-based) remote management.

## 2. Current state (cited)

### 2.1 MQTT in RTFM-EV is outbound and publish-only

- `BaseMqttPublisher.publish()` is the only wire operation; the class opens an
  `aiomqtt.Client` and publishes JSON, never subscribes
  (`app/fanout/mqtt_base.py:121-140`, client lifecycle `:187-262`).
- The private-MQTT module maps a config blob to publisher settings and builds
  publish topics only (`app/fanout/mqtt.py:40-92`, `app/fanout/mqtt_private.py:16-60`).
- The fanout bus dispatches **local** events (`message`, `raw_packet`, `contact`,
  `telemetry`, `health`) *out* to modules; modules have `on_message` / `on_raw` /
  `on_contact` / `on_telemetry` / `on_health` hooks that **receive from the local
  radio**, not from a broker (`app/fanout/AGENTS_fanout.md:7-64`). There is no
  inbound-from-broker path anywhere in `app/`.
- Broker credentials + connection config already live in the `fanout_configs` table
  (`id, type, name, enabled, config JSON, scope JSON, sort_order, created_at`),
  managed by `GET/POST/PATCH/DELETE /api/fanout` (`app/fanout/AGENTS_fanout.md:340-348`;
  migrations 36-38). The `mqtt_private` config blob shape is
  `{broker_host, broker_port, username, password, use_tls, tls_insecure, topic_prefix}`
  (`app/fanout/AGENTS_fanout.md:105-108`; `app/fanout/mqtt_private.py:16-23`).
- Known platform caveat carried by the shared base: on Windows the default
  `ProactorEventLoop` cannot run paho/aiomqtt; the loop detects this and gives up with
  an operator toast (`app/fanout/mqtt_base.py:274-300`). Any new subscriber built on
  `aiomqtt` inherits this and must reuse the same guard.

### 2.2 Existing history/telemetry storage this plan builds on

- `repeater_telemetry_history` (migration `_050`) and `contact_telemetry_history`
  (migration `_062`, same schema) already store time-series telemetry snapshots with
  read-only history endpoints (`GET /api/contacts/{public_key}/repeater/telemetry-history`,
  `GET /api/contacts/{public_key}/telemetry-history`) (`app/AGENTS.md` §"Data Model
  Notes"). Plan [14] (historical-device-info) extends this pattern; this plan must
  reuse its history model where they overlap (see §4.4 and §6).
- Contacts/repeaters are already first-class (`type=2` repeater, `type=3` room),
  with a full RF-CLI management dashboard (`RepeaterDashboard`, granular
  `POST /api/contacts/{public_key}/repeater/{pane}` endpoints; `app/AGENTS.md`
  API table). The NOC page is adjacent to but distinct from this: NOC nodes are keyed
  by MQTT identity (device public key from the broker), not necessarily loaded as
  radio contacts.

### 2.3 Next free migration number

VERIFIED: highest migration on `origin/main` is `_068_add_registry_sync_url.py`
(`git ls-tree origin/main app/migrations/`). **Next free number is `_069`.** If plan
[14] lands first it will consume `_069`; this plan must re-check at implementation
time and take the next free number.

## 3. Reference research (firmware source of truth)

Firmware: `Dutch-MeshCore/MeshCore` branch `dmc-observer-dev-1171-regiongating`
(local `G:\Github\repositories\Dutch-MeshCore\MeshCore`), confirmed checked out
(`git branch --show-current`). MQTT bridge is gated behind `WITH_MQTT_BRIDGE`
(`src/helpers/MQTTDefaults.h:3`).

### 3.1 Topic layout (CONFIRMED)

- Six publication types, enum values fixed: `status`(0) / `packets`(1) / `raw`(2) /
  `neighbors`(3) / `filter`(4) / `config`(5)
  (`src/helpers/MQTTTopicRouter.h:13-20`; name mapping `:32-42`).
- MeshCore route style builds the topic as `meshcore/{iata}/{device}/{type}`
  (`src/helpers/MQTTTopicRouter.h:75`, format string `"meshcore/%s/%s/%s"` of
  `iata, device, type_name`). Requires a valid non-`XXX` IATA and a non-empty device
  (`:72-75`).
- `{iata}` is the (uppercased) IATA code (`setIATA`, `MQTTBridge.cpp:4680-4685`).
- `{device}` is the node's **public key as a 64-hex-char string**
  (`_device_id[65] // Device public key (hex string)`, `MQTTBridge.h:164`;
  `MQTT_IMPLEMENTATION.md:332-337,464-470`). This is the stable per-node identity to
  key the NOC registry on.
- Other route styles exist but are not the DMC LAN case: `meshrank` uses
  `meshrank/uplink/{token}/{device}/{type}` and withholds `raw`
  (`MQTTTopicRouter.h:77-85`); `custom` presets expand a template with
  `{iata}{device}{token}{type}` placeholders, defaulting to `meshcore/{iata}/{device}/{type}`
  (`MQTTTopicTemplate.h:14-56`; `MQTT_IMPLEMENTATION.md:326-339`).
- Practical consequence for the subscriber: a single wildcard
  `meshcore/+/+/+` (or `meshcore/{iata}/#`) captures all six types for all nodes on a
  DMC-preset broker. Custom-template nodes are **UNVERIFIED** at ingest time (operator
  could have set any template); the subscriber should let the operator supply the
  subscribe pattern, defaulting to `meshcore/#`.

### 3.2 Payload field sets (CONFIRMED, per builder)

All payloads are JSON. Every type carries `origin` (configurable display name,
defaults from node identity; `MQTTBridge.cpp:680,4674`), `origin_id` (device public
key hex; `:2633,3523`), and `timestamp` (UTC ISO-8601 with `+00:00`,
`MQTTMessageBuilder.cpp:16-35`).

- **status (0)** `MQTTPayloadBuilder.cpp:25-84`: `status, timestamp, origin,
  origin_id, model, firmware_version, radio, client_version`, optional `repeat`, and a
  nested `stats{battery_mv, uptime_secs, packets_sent, packets_received, errors,
  queue_len, noise_floor, tx_air_secs, rx_air_secs, recv_errors, internal_heap}` (each
  stat omitted when its sentinel is negative/`-999`).
- **packets (1)** `MQTTPayloadBuilder.cpp:86-166`: `timestamp, hash, origin,
  type="PACKET", direction("rx"|"tx"), time, date, len, packet_type, route,
  payload_len, raw(hex), origin_id`; on `rx` also `SNR, RSSI` and optional `score`
  (int = score*1000); optional `path[]` array of lowercase hex hop tokens for direct
  packets (`:149-163`). `route` is `F`/`D`/`T`/`U` (`MQTTMessageBuilder.cpp:571-578`).
- **raw (2)** `MQTTPayloadBuilder.cpp:168-187`: `origin, origin_id, timestamp,
  type="RAW", data(full on-air hex incl. radio headers)`.
- **neighbors (3)** `MQTTPayloadBuilder.cpp:189-295`: `timestamp, origin, origin_id,
  total_neighbors, queried_neighbors, truncated, self{scopes, default_scope},
  neighbors[]{pubkey, snr, heard_secs_ago (null if unknown), scopes, status}`. Tail is
  dropped and `truncated=true` when the fixed buffer fills (`:284-292`).
- **filter (4)** `MQTTMessageBuilder.cpp:81-184`: `timestamp, origin, origin_id,
  uptime_secs, boot_id, enabled, totals{hops,rate,channel,hash,malformed},
  hops{<NN>}, rate{<NN>}, hash{size{1B,2B,3B,4B?}, top_types{<NN>}},
  malformed{short,time,empty,utf8}, channels[]{hash,name,drops},
  top_sources[]{hash,drops}, config{<NN>{limit,secs,soft,hops_max}},
  region_gate{enabled,duty,level,max_level,threshold,hysteresis}`. Keys `<NN>` are
  two-digit packet-type ids.
- **config (5)** `MQTTMessageBuilder.cpp:192-314`: `timestamp, origin, origin_id,
  uptime_secs, boot_id`, optional `node_name/owner_info/owner_key`,
  `advert_interval, flood_advert_interval`, and nested objects
  `radio{freq,bw,sf,cr,tx_power,cad,interference_threshold,rxgain,fem_rxgain,
  fem_txgain,airtime_factor,rx_delay,tx_delay_factor,direct_tx_delay_factor,
  agc_reset_interval,path_hash_mode,multi_acks,extra_sf[4]}`,
  `repeat{disable_fwd,flood_max,flood_max_unscoped,flood_max_advert,loop_detect}`,
  `region_gate{enabled,threshold,hysteresis}`,
  `region{home?,default?,wildcard_flood,scopes[]{name,flood,parent?}}`,
  `bridge{enabled,delay,source,baud,channel}`,
  `gps{enabled,interval,advert_loc_policy,lat?,lon?}`,
  `power{powersaving,adc_multiplier}`, `room{allow_read_only}`,
  `mqtt{status,packets,raw,tx,rx,status_interval,filter_interval,neighbors,
  neighbors_interval,iata?,ntp_server?,watchdog_minutes,slot_presets[],slot_topics[],
  slot_filters[]}`, `timezone{string?,offset}`,
  `alert{enabled,region?,hashtag?,wifi_minutes,mqtt_minutes,interval_min}`,
  `snmp{enabled}`.

### 3.3 Intervals / defaults (CONFIRMED)

From `applyMQTTDefaults` (`src/helpers/MQTTDefaults.h:64-124`):
- status enabled by default, packets enabled, **raw disabled by default**
  (`:67-69`); status interval **300000 ms = 5 min** (`:71`).
- neighbors publishing **off by default**, default interval 24 h
  (`MQTT_NEIGHBORS_DEFAULT_INTERVAL_HOURS = 24`, `MQTTPrefsStorage.h:236-239`;
  default applied `MQTTDefaults.h:110-111`).
- filter-stats interval default **60000 ms = 60 s** (`MQTTPrefsStorage.h:246`;
  applied `MQTTDefaults.h:115`).
- Six MQTT slots (`MQTT_PREFS_SLOT_COUNT`), each with its own preset + packet filter
  (`MQTTDefaults.h:74-121`). A node can therefore publish the same types to multiple
  brokers.

Publish QoS / retain (relevant to how fresh a retained snapshot is when the
subscriber first connects):
- status published QoS 1, retained only when the slot preset's `allow_retain` is true
  (`MQTTBridge.cpp:2678-2683,3575-3576`).
- packets / raw are high-rate QoS 0 (`MQTTBridge.cpp:2498-2513`).
- neighbors and the periodic snapshots publish QoS 0, retained where allowed
  (`MQTTBridge.cpp:3844-3846,3880-3882`).
- Implication: on a broker that allows retain, a newly-connected subscriber gets the
  last `status`/`config`/`filter`/`neighbors` immediately; `packets`/`raw` are live
  only. On brokers with `allow_retain=false` (noted for some presets,
  `MQTTBridge.cpp:2678-2683`), nothing is retained and the NOC page is empty until the
  next interval tick.

### 3.4 Any inbound / command topic? (CONFIRMED: none)

- The bridge only publishes. It registers `onConnect`/`onDisconnect`/`onError`
  callbacks on each slot client (`MQTTBridge.cpp:1651,1682,1695`) and calls
  `esp_mqtt_client_publish` (`MQTTBridge.cpp:2498-2513`). There is **no**
  `esp_mqtt_client_subscribe`, no `MQTT_EVENT_DATA` / `onData` / `onMessage` handler
  anywhere under `src/` (grep returned zero inbound handlers).
- Node reconfiguration is done over the **CLI** (`set mqttN.preset`, `set mqttN.topic`,
  `get mqtt.*`, `ota check/update`), delivered over serial / RF, not MQTT
  (`MQTT_IMPLEMENTATION.md:244-270`; CLI dispatch context `MQTTBridge.cpp:1252`).
- **Conclusion: remote management over MQTT is not possible against this firmware.**
  Any "management" on the NOC page must reuse RTFM-EV's existing RF/serial CLI command
  path (`POST /api/contacts/{public_key}/command`) and is subject to the same
  constraint that the node must be an RF-reachable, logged-in repeater/room contact.
  This is the same seam plan [10] gates by reported firmware.

### 3.5 Broker auth (context for the subscriber config)

Preset brokers authenticate with JWT (Ed25519); MeshRank uses a token-in-topic;
custom brokers use username/password over plain or TLS MQTT
(`MQTT_IMPLEMENTATION.md:534-535`). For the LAN/self-hosted case the contributor
describes, the realistic target is a **local broker the operator controls** (e.g.
Mosquitto on the same wifi, or reachable via tailscale). The subscriber therefore
needs the same `{broker_host, broker_port, username, password, use_tls, tls_insecure}`
config the outbound `mqtt_private` module already uses (§2.1); it does **not** need
the firmware's JWT machinery (that is the node-to-broker leg, not RTFM-EV-to-broker).

## 4. Design

### 4.1 Inbound subscriber component

Add a backend component that opens an `aiomqtt.Client`, **subscribes** to the DMC
topic space, parses each of the six payload types, and writes node snapshots to new
tables + broadcasts WS events. Two structural options:

- **Option A (recommended): a new fanout config `type = "mqtt_ingest"`, but a distinct
  runtime path.** Reuse the `fanout_configs` row + `/api/fanout` CRUD + the
  `SettingsFanoutSection.tsx` editor purely for **broker connection config reuse**
  (host/port/creds/TLS + a `subscribe_pattern`, default `meshcore/#`). The module's
  `start()` opens a subscribing client and runs its own receive loop; its `on_message`
  / `on_raw` / `on_telemetry` fanout hooks stay **no-ops** (it is a source, not a
  sink). This keeps one broker-config store (satisfies the README constraint at
  `docs/plans/README.md:140`) and one connection-management UI, while the data
  direction is clearly inbound. Register per the fanout checklist
  (`app/fanout/AGENTS_fanout.md:162-328`): new module class, `_register_module_types`,
  `_VALID_TYPES` (`app/routers/fanout.py:19`), a validator, and scope enforcement
  (ingest has no outbound scope, so force an empty/`none` scope).
- **Option B: a standalone `app/ingest/` subsystem with its own table for broker
  config** (mirroring how `app/push/` is deliberately *not* a fanout module,
  `app/AGENTS.md` §"Web Push"). Cleaner separation of directions, but duplicates
  broker-config CRUD/UI and violates the "reuse broker config, do not fork a parallel
  store" instruction. Record as the fallback if the fanout module contract proves a
  poor fit for a subscriber (e.g. the bus's `realtime`/scope assumptions get in the
  way).

Recommendation: **Option A** for config reuse and UI economy, with the receive loop
implemented on the shared `BaseMqttPublisher` lifecycle skeleton refactored to allow a
subscribe mode, or a sibling `BaseMqttSubscriber` that reuses the same connect /
backoff / Windows-Proactor guard (`app/fanout/mqtt_base.py:187-321`). Do **not**
duplicate the Proactor detection.

OPEN QUESTION: the fanout `FanoutModule` contract is shaped for outbound sinks
(`start/stop/on_*` + `status`, `app/fanout/AGENTS_fanout.md:7-18`). Confirm at
implementation time that a subscribe-only module reads naturally within it, or split
`BaseMqttSubscriber` out and keep only the `fanout_configs` row + CRUD reuse (a middle
path between A and B).

### 4.2 Broker config reuse

- Reuse the `mqtt_private` config keys verbatim
  (`{broker_host, broker_port, username, password, use_tls, tls_insecure}`,
  `app/fanout/mqtt_private.py:16-23`) plus `subscribe_pattern` (default `meshcore/#`)
  and an optional `iata_filter`.
- Do **not** re-key credentials into a new table. If Option A, the row lives in
  `fanout_configs`; if Option B, at minimum reference/copy the existing broker fields
  so the operator configures a broker once.

### 4.3 Storage schema (new tables; migration `_069`+)

Per-node registry + per-type history. Key everything on the device public key hex
(`origin_id`), which is stable per node (§3.1).

- `noc_nodes` (registry / latest): `device_key TEXT PRIMARY KEY` (64-hex `origin_id`),
  `iata TEXT`, `origin_name TEXT`, `model TEXT`, `firmware_version TEXT`,
  `client_version TEXT`, `last_status_at`, `last_config_at`, `last_filter_at`,
  `last_neighbors_at`, `last_seen`, `first_seen`, `broker_config_id TEXT` (which
  fanout/ingest config heard it), plus a cached latest-status JSON blob for fast page
  load. `device_key` is distinct from `contacts.public_key` but can be joined to it
  when the node is also an RF contact (enables the "manage over RF CLI" affordance).
- `noc_status_history`: `id`, `device_key`, `received_at`, and the flattened
  `stats{}` columns (`battery_mv, uptime_secs, packets_sent, packets_received, errors,
  queue_len, noise_floor, tx_air_secs, rx_air_secs, recv_errors, internal_heap`) +
  `status, model, firmware_version`. This overlaps the existing
  `repeater_telemetry_history` columns substantially (`noise_floor_dbm`,
  `battery_volts`, `uptime_seconds`, `packets_received/sent`, airtime); see §4.4 for
  the de-conflict decision.
- `noc_config_history`: `id`, `device_key`, `received_at`, `boot_id`, and the config
  payload stored as a JSON blob (the config shape is large and mostly display-only;
  §3.2). Optionally promote a few hot fields to columns (`path_hash_mode`,
  `region_home`, `advert_interval`) for filtering.
- `noc_filter_history`: `id`, `device_key`, `received_at`, `boot_id`, `enabled`, plus
  the filter payload JSON (totals/hops/rate/region_gate). Promote `totals.*` and
  `region_gate.duty/level` to columns for time-series charts.
- `noc_neighbors_snapshots`: `id`, `device_key`, `received_at`, `total_neighbors`,
  `queried_neighbors`, `truncated`, `self_scopes`, `self_default_scope`, and a child
  `noc_neighbor_entries` (`snapshot_id`, `neighbor_key`, `snr`, `heard_secs_ago`,
  `scopes`, `status`) - or a JSON blob if per-neighbor querying is not needed.

Retention: reuse the maintenance/pruning approach used for telemetry history and raw
packets (`POST /api/packets/maintenance`; `app/AGENTS.md`). NOC history can grow fast
(status every 5 min per node, filter every 60 s if that topic is subscribed), so cap
rows per node and prune on an interval. `packets` and `raw` topics are high-volume and
**should not be persisted by default** in the NOC store; if subscribed at all, feed
them to the existing raw-packet feed rather than a new table (OPEN QUESTION §6).

### 4.4 De-conflict with plan [14] and existing telemetry history

- Plan [14] (historical-device-info) owns "retain device identity/config/telemetry
  history over time" building on the shipped signal-storage foundation and
  `repeater_telemetry_history` / `contact_telemetry_history`
  (`docs/plans/README.md:108-110,127`). The NOC status stats are a **near-superset** of
  the existing repeater-telemetry columns (compare §3.2 status `stats{}` with the
  `on_telemetry` fields in `app/fanout/AGENTS_fanout.md:85-93`).
- Decision to make jointly with [14]: **prefer extending [14]'s history model over a
  parallel `noc_status_history`** where the columns align. Options:
  1. Write MQTT-sourced status snapshots into `repeater_telemetry_history` with a
     `source` discriminator (`radio` vs `mqtt`) when the node is a known RF contact.
     Cleanest reuse, but couples NOC to the contact keyspace and needs a source column.
  2. Keep `noc_status_history` separate (NOC nodes are not always RF contacts) and have
     the NOC page and [14]'s device-history page read from whichever store holds the
     row. Lower coupling, some duplication.
  Recommendation: (2) for the registry (NOC nodes exist independent of RF contacts),
  but reuse [14]'s **charting/history-endpoint conventions and pruning** so both pages
  render identically. Mark this a hard cross-plan dependency (§6).
- Gate on plan [10]: firmware detection ([10]) decides which management actions are
  even offered per node; the NOC page must consume [10]'s firmware/option-gating rather
  than re-deriving capability (`docs/plans/README.md:88-93,138`).

### 4.5 NOC page (frontend)

New top-level view, following the existing surface-branching + hash-routing pattern:

- Add a hash route (e.g. `#noc`) to `utils/urlHash.ts` and a branch in
  `ConversationPane.tsx` / `AppShell.tsx` (mirrors `#raw`, `#map`, `#visualizer`,
  `frontend/AGENTS.md` §"URL Hash Navigation"). A NOC entry point in the sidebar.
- Layout: a **node list** (one row per `noc_nodes` device, showing origin name, IATA,
  model, firmware, last-seen, online dot) plus a **detail panel** with tabbed
  historical sub-panels that map 1:1 to the topic types:
  - Status: battery / uptime / noise-floor / packet counters over time (reuse the
    telemetry-history chart component pattern from
    `RepeaterTelemetryHistoryPane.tsx`).
  - Config: rendered read-only tree of the config payload (radio / repeat / region /
    mqtt / bridge / gps / alert), with change-over-time diffing across
    `noc_config_history` rows.
  - Filter: drop-stats totals + region-gate duty/level time series.
  - Neighbors: table of `{pubkey, snr, heard_secs_ago, scopes, status}`, optional
    mini-map reuse (`NeighborsMiniMap.tsx`).
  - Management (conditional): only when the node is also an RF-reachable repeater/room
    contact AND plan [10] reports a firmware that supports the action, surface the
    existing RF-CLI actions (login, command console, reboot, set-config) via the
    current repeater endpoints. If the node is MQTT-only (no RF contact), management is
    **not available** and the panel says so (see §3.4).
- Typed contracts: add `NocNode`, `NocStatusSnapshot`, `NocConfigSnapshot`,
  `NocFilterSnapshot`, `NocNeighborsSnapshot` to `frontend/src/types.ts`, REST methods
  to `api.ts`, and WS event types to `wsEvents.ts` (`frontend/AGENTS.md`
  §"WebSocket" and §"Types and Contracts").

### 4.6 REST + WebSocket surface

- REST (read-only, no radio access needed): `GET /api/noc/nodes`,
  `GET /api/noc/nodes/{device_key}`, `GET /api/noc/nodes/{device_key}/status-history`,
  `.../config-history`, `.../filter-history`, `.../neighbors` (mirror the existing
  `telemetry-history` read-only endpoint style, `app/AGENTS.md` API table). Management
  actions **reuse existing** `POST /api/contacts/{public_key}/command` and repeater
  endpoints; do not add MQTT-write endpoints (none possible, §3.4).
- WebSocket: new event types dispatched from the subscriber on each ingested payload,
  e.g. `noc_status`, `noc_config`, `noc_filter`, `noc_neighbors`, `noc_node` (registry
  upsert). Route them through the typed serializer in `app/events.py` and the
  `broadcast_event()` helper (`app/websocket.py`), and add matching handlers in
  `useWebSocket.ts` / `wsEvents.ts` and `useRealtimeAppState.ts`
  (`frontend/AGENTS.md` §"WebSocket"). These are **additive**; they must not collide
  with existing `contact` / `raw_packet` / `message` events.

### 4.7 Typed contracts (backend)

Add Pydantic models in `app/models.py` for each snapshot type and a typed repository
write contract per new table (`app/repository/`), consistent with the repo's
"typed write/read contracts over ad hoc dicts" rule (`app/AGENTS.md` §"Data Model
Notes"; `app/fanout/AGENTS_fanout.md` payload shapes). Parse firmware JSON into these
models at ingest so malformed / partial payloads (truncated neighbors, omitted stats)
are handled explicitly rather than propagated as loose dicts.

## 5. Phasing

1. **Phase 1 - Ingest + live display (MVP).** Inbound subscriber (Option A) reusing
   broker config; subscribe to `status` + `config` + `neighbors` + `filter` (skip
   high-volume `packets`/`raw`); `noc_nodes` registry + latest-snapshot cache; NOC page
   node list + live status/config/neighbors panels fed by WS. No history tables yet
   (show latest only). Delivers the contributor's core ask.
2. **Phase 2 - History + charts.** Add the `*_history` tables (migration `_069`+),
   time-series endpoints, and charted sub-panels; wire retention/pruning; de-conflict
   with plan [14] per §4.4 (shared charting + pruning conventions).
3. **Phase 3 - Remote management (RF-CLI only, gated).** Surface management actions
   **only** for NOC nodes that are also RF-reachable repeater/room contacts, reusing
   existing CLI endpoints and plan [10]'s firmware/option gating. Explicitly document
   that MQTT-only nodes cannot be managed (no inbound MQTT command topic, §3.4).
   Optional `packets`/`raw` ingest into the existing raw-packet feed is a Phase 3
   stretch, decided by the §6 open question.

## 6. Risks / open questions

- **Remote-management security.** Even RF-CLI management is powerful (reboot,
  reconfigure). RTFM-EV has no per-user authz (`app/AGENTS.md` §"Intentional Security
  Design Decisions"). Management must inherit the existing repeater-login gate and stay
  behind the same trusted-network posture; do not add a new privileged surface that
  bypasses login. OPEN QUESTION: should management actions be feature-flagged off by
  default (env var) given the NOC page makes them one click from a dashboard?
- **Broker trust / spoofing.** `origin_id` (device pubkey) in a payload is **not
  authenticated** by the subscriber - anyone who can publish to the broker can claim
  any `device_key`. The NOC registry must treat ingested identity as **observed, not
  verified**, and never let an MQTT payload mutate authoritative RF-contact state (keep
  `noc_*` tables separate from `contacts`, join only for display). OPEN QUESTION:
  minimum viable trust - restrict to a broker the operator controls, and/or
  allowlist device keys?
- **Multi-node scale.** status every 5 min + filter every 60 s + neighbors, per node,
  across many nodes and possibly multiple broker configs, is a real write rate. Needs
  per-node row caps, pruning, and a bound on how many `packets`/`raw` (if ever
  subscribed) are retained. Confirm SQLite write load is acceptable alongside the
  existing radio pipeline.
- **Windows Proactor.** The subscriber inherits the paho/aiomqtt Proactor
  incompatibility (`app/fanout/mqtt_base.py:274-300`). Reuse the existing guard; do not
  ship a second, subtly-different detection.
- **Retain vs live.** On `allow_retain=false` brokers the NOC page is empty until the
  next interval tick (§3.3); the UI must show "awaiting first publish" rather than
  imply the node is down.
- **Custom topic templates.** Nodes on `custom` presets may publish to arbitrary
  topics (§3.1). The default `meshcore/#` subscription misses them; expose the
  subscribe pattern to the operator. UNVERIFIED which templates real DMC-LAN nodes use.
- **packets/raw ingest scope.** OPEN QUESTION: do we ingest `packets`/`raw` at all? It
  duplicates data the local radio already hears, at high volume. Leaning **no** by
  default; if yes, feed the existing raw-packet feed/store, not a NOC table.
- **[14]/[10] sequencing.** Phase 2 depends on plan [14]'s history model decisions and
  Phase 3 depends on plan [10]'s firmware detection. If [11] is built before those, it
  risks a parallel history store and re-derived capability gating. Sequence [10] → [14]
  → [11] as the README dependency graph already implies
  (`docs/plans/README.md:129-153`).

## 7. Verification plan

Before any "works" claim, per CLAUDE.md "Never claim it works without proof":

1. **Firmware schema pin (unit).** Add host-side fixtures capturing one real JSON
   sample per topic type (status/packets/raw/neighbors/filter/config) and assert the
   parser maps every documented field (§3.2). If a firmware sample is unavailable,
   generate from the builder field lists and mark the fixture `UNVERIFIED against live
   device` until a real capture is diffed in.
2. **Subscriber integration (backend, mocked broker).** Publish crafted payloads to a
   test broker / mocked `aiomqtt` client, assert `noc_nodes` upsert, history rows, and
   WS events, following the fanout integration-test pattern
   (`tests/test_fanout_integration.py`, `tests/test_mqtt.py`). Include a malformed /
   truncated-neighbors payload and a spoofed-`origin_id` case (assert no contact-table
   mutation).
3. **Live end-to-end (observed, not reasoned).** With a real DMC-MQTT node on branch
   `dmc-observer-dev-1171-regiongating` publishing to a local Mosquitto, run RTFM-EV,
   open `#noc`, and observe the node appear with live status/config/neighbors, then
   watch a status tick update after ~5 min. Record what was observed. Compiling/type
   checks are not evidence the page renders (CLAUDE.md).
4. **Regression.** `./scripts/quality/all_quality.sh` green (note: ~14 Windows-only
   backend failures + charmap collection errors are pre-existing env issues per user
   memory, not regressions). Confirm no new collision on existing WS event names.
5. **Negative control.** With the subscriber disabled, confirm the NOC page shows the
   empty/awaiting state and no `noc_*` tables are written.

## 8. Effort

Rough order-of-magnitude (Opus-class, multi-surface):

- Phase 1 (ingest + live page): **Large.** New subscriber component + `BaseMqttSubscriber`
  seam, 6-type JSON parsing + typed models, `noc_nodes` registry + repo, new REST +
  WS events, new frontend view with 3-4 live panels, hash route, tests. Highest-risk
  piece is the subscriber lifecycle reuse (do not fork the Proactor/backoff logic).
- Phase 2 (history + charts): **Medium.** Migration `_069`+ for `*_history` tables,
  time-series endpoints, charted panels (reuse `RepeaterTelemetryHistoryPane`
  patterns), retention/pruning, [14] de-conflict.
- Phase 3 (RF-CLI management, gated): **Small-Medium.** Mostly wiring the NOC detail
  panel to existing repeater CLI endpoints + plan [10] gating; no new protocol work
  (and no MQTT-write work, since none is possible).

Dependencies gate the total: [10] (firmware gating) and [14] (history model) should
land first (§6). Standalone, Phase 1 alone is the deliverable that satisfies the
contributor's "My Mesh NOC" request.
