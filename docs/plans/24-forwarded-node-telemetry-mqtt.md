# [24] Forwarded node telemetry / neighbors / regions over MQTT (`subject_id` attribution)

Date: 2026-09-12
Category: F (DMC firmware-aware node management / MQTT export parity)
Model: Opus
State: Partial (extends existing fanout bus + Community MQTT sink + telemetry-history; no new subsystem)
Scope: local planning + implementation in **RTFM-EV only**. Handoff notes (docs, no code) left in the two local sibling repos for other agents. Firmware repos are read-only research. Code-is-truth: non-obvious claims cite `file:line` or `file::symbol`.

Relates to parity backlog `docs/parity-audit.md`: **X1** (MQTT export), **L3** (MQTT neighbors/config publish), **L2** (telemetry graphs). This plan realises the "forward data *received from other nodes*" half of X1/L3 with correct origin attribution, plus the local-history half of L2 for neighbor/region counts.

---

## 1. Summary

RTFM-EV already **requests** telemetry, neighbor tables, and region tables **from remote nodes** (repeaters/room-servers) over the MeshCore RF/serial CLI, and already publishes an observer-style feed to a community MQTT broker. Today that feed carries only the local radio's own **raw packets** and **status**, both stamped with the local (self) public key.

This plan lets RTFM-EV **forward the per-remote-node data it receives after those requests** onto the same MQTT feed, attributed to the node the data actually came from — not to the publishing radio. It also folds neighbor/region **counts** into RTFM-EV's own tracked telemetry time-series so they chart locally.

### The problem this solves (user's words)

> "the id of the heard node being different than the id of the mqtt node."

When a bridge forwards data it heard from node **R**, the MQTT publisher identity is the bridge, not **R**. Every downstream consumer keys the reading on the publisher, so **R**'s telemetry/neighbors/regions get misattributed to the bridge.

### The fix (one convention, all three streams)

Every forwarded message carries:

- `origin_id` = **self** (the publishing radio's pubkey) — unchanged, satisfies the broker's publisher==origin rule untouched.
- **`subject_id`** (new) = **R**, the heard/origin node the data is about. Plus `subject_name`.
- the data (`stats` / `lpp` / `neighbors` / `regions`).

Forwarded messages use MQTT **kinds the analyzer does not yet recognise**, so until the analyzer adds ingest paths they are **safely dropped, never misattributed** (see §4.3). No downstream corruption in the interim.

---

## 2. Current state (cited)

### 2.1 RTFM-EV requests remote-node data (subject is always a specific remote node)

- Neighbors: `repeater_neighbors(public_key)` calls `mc.commands.fetch_all_neighbours(contact.public_key, …)` — the neighbor table **of repeater `contact`**, not of the local radio (`app/routers/repeaters.py:246`, fetch at `:258`). Each entry is `NeighborInfo{pubkey_prefix, name, snr, last_heard_seconds}` (`app/models.py:704`); the response is `RepeaterNeighborsResponse{neighbors, reported_count}` (`app/models.py:724`). **No** `scopes`/`status` fields are fetched — region membership does not ride on neighbor entries.
- Telemetry: `_collect_repeater_telemetry` / manual fetch build a payload from the polled `Contact` and broadcast it with the **remote contact's** public key already attached (`app/radio_sync.py` ~`1902-1911`: `{"public_key": contact.public_key, "name": …, "timestamp": …, **data}`). Mirrored at the contact auto-collect, `app/routers/repeaters.py` manual repeater fetch, and `app/routers/contacts.py` manual contact fetch.
- Regions: `repeater_regions()` parses a remote repeater's admin `region` CLI dump into `RepeaterRegionEntry{name, depth, flood_allowed, is_home, …}` (`app/routers/repeaters.py`, `app/models.py`). Subject = that repeater.

So the identity of the subject node **R** is already known at every producer site (it is the contact whose data was requested).

### 2.2 The fanout bus and the Community sink

- `FanoutManager` dispatches `broadcast_message` / `broadcast_raw` / `broadcast_contact` / `broadcast_telemetry` / `broadcast_health_fanout` to module hooks (`app/fanout/manager.py` ~`262-305`). `broadcast_telemetry` is **always-match** (every module sees it). **There is no `broadcast_neighbor` / `broadcast_region`.**
- The Community sink speaks the observer protocol to a community broker (`app/fanout/mqtt_community.py`, `app/fanout/community_mqtt.py`). It publishes exactly two topics, both keyed by the **self** pubkey:
  - `meshcore/{IATA}/{SELF_PUBKEY}/packets` — template `_DEFAULT_PACKET_TOPIC_TEMPLATE` (`app/fanout/mqtt_community.py:17`), only `{IATA}`/`{PUBLIC_KEY}` placeholders allowed (`_render_packet_topic`).
  - `meshcore/{IATA}/{SELF_PUBKEY}/status` — `_build_status_topic` (`app/fanout/community_mqtt.py` ~`214`).
  - Packet/status payloads stamp `origin_id` = self pubkey (`community_mqtt.py::_format_raw_packet`, `::_publish_status`). `on_message` is a no-op; the sink **never** publishes telemetry, neighbors, or regions.
- Self identity for the sink comes from the keystore (`app/keystore.py::get_public_key`) and runtime `self_info`.
- Community config blob (`app/routers/fanout.py::_validate_mqtt_community_config`): `iata` (required), `topic_template`, `publish_status`, `publish_packets`, `status_interval_ms`, auth fields. Stored in `fanout_configs` (`app/migrations/_036_create_fanout_configs.py`).

### 2.3 Tracked telemetry time-series (local)

- Repeater snapshots stored as a JSON `data` blob per row in `repeater_telemetry_history` (`app/migrations/_050_repeater_telemetry_history.py`), contact snapshots in `contact_telemetry_history` (`_062`). Collected on a schedule by `_collect_repeater_telemetry` / `_collect_contact_telemetry` (`app/radio_sync.py`).
- Charted metrics + CSV export defined in `frontend/src/components/repeater/RepeaterTelemetryHistoryPane.tsx` (`BUILTIN_METRIC_CONFIG` / `BUILTIN_METRICS` plus dynamic LPP series).
- Neighbor signal history is a **separate** store (`app/repository/link_signal.py`, table `_075_create_link_signal.py`); region hierarchy is fetched live and **not** historised.

### 2.4 Downstream (verified; context only — not modified here)

- **collector-wardrive** (`G:\Github\repositories\Dutch-MeshCore\collector-wardrive`) is an Aedes **broker**, not a subscriber. It authenticates the publisher pubkey from the CONNECT username (`v1_{PUBKEY}`), and **rejects** any message whose topic pubkey segment or payload `origin_id` differs from that authenticated key (`src/server.ts::authorizePublish`, the topic-match check and the `origin_id` gate). It stores/forwards by publisher pubkey; extra payload fields pass through untouched. → our `origin_id`=self satisfies it; `subject_id` rides through as an extra field.
- **EU-Meshcore-Analyzer** (`G:\Github\repositories\Elektr0Vodka\EU-Meshcore-Analyzer`) subscribes `meshcore/#`; `Convert` dispatches on the topic `kind` = the 4th `/`-segment (`internal/ingest/convert.go:155-170`, `splitTopic` uses `SplitN(t,"/",4)` at `:330`). Recognised kinds: `status`, `neighbors`, `filter`, `config`, else the packets/sighting path; **any other kind returns "no canonical data" — dropped** (`convert.go:168`). It decodes only RF type/path from raw frames (`internal/meshcore/packet.go::PayloadType`), never app-layer telemetry values. Neighbor ingest keys edges to the **observer** (topic pubkey) — so reusing kind `neighbors` for a forwarded remote table would create false `self ↔ neighbor` edges.

---

## 3. Design

### 3.1 Feed contract — flat kinds under `meshcore/{IATA}/{SELF_PUBKEY}/…`

Flat, observer-style kinds under the self-pubkey topic base. Three peer kinds — `node_telemetry`, `node_neighbors`, `node_regions` — each a **new** kind the analyzer does not yet recognise, so every one is drop-safe and can be enabled immediately (§4.2, §4.3). All forwarded messages share the envelope: `origin` (self name), `origin_id` (self pubkey, upper hex), `timestamp` (ISO-8601), plus the new **`subject_id`** (R pubkey, upper hex) and `subject_name` (R name).

**The `subject_id` convention (the whole id fix, one rule):** `origin_id` stays the publisher (self — satisfies the broker untouched); **`subject_id` is the heard node R the data is about.** A consumer keys the row on `subject_id`. It is present from day one, so the messages the cache buffers before the analyzer has a path are already correctly attributed when that path lands.

Why distinct kinds rather than reusing `neighbors`/`config`: those are already interpreted and keyed to the observer, so reusing them would misattribute to self *now*. New kinds are simply dropped until supported — that is what makes "flip it on now" safe across all three streams.

**`node_telemetry`**
```json
{
  "origin": "<self name>", "origin_id": "<SELF_PUBKEY>",
  "timestamp": "<iso8601>", "type": "TELEMETRY",
  "subject_id": "<R_PUBKEY>", "subject_name": "<R name>",
  "stats": { "battery_mv": 4100, "uptime_secs": 3600, "packets_sent": 42,
             "packets_received": 128, "noise_floor": -110, "tx_air_secs": 12,
             "rx_air_secs": 340, "recv_errors": 2, "queue_len": 0, "internal_heap": 102400 },
  "lpp": [ { "channel": 1, "type_name": "temperature", "value": 21.4 } ]
}
```
`stats` reuses the observer `/status` key names (RTFM-EV's `battery_volts` → `battery_mv`, etc.) so the analyzer can reuse its status extractor, keyed on `subject_id`. `stats` present for repeater status; `lpp` present for LPP sensors; either may be absent.

**`node_neighbors`** (new kind; subject = the repeater R whose table this is)
```json
{
  "origin": "<self name>", "origin_id": "<SELF_PUBKEY>",
  "timestamp": "<iso8601>", "type": "NEIGHBORS",
  "subject_id": "<R_PUBKEY>", "subject_name": "<R name>",
  "reported_count": 8,
  "neighbors": [ { "pubkey": "<NEIGHBOR_PREFIX>", "name": "<resolved or null>",
                   "snr": 9.75, "heard_secs_ago": 42 } ]
}
```
Neighbor `pubkey` is the **prefix** RTFM-EV has (`NeighborInfo.pubkey_prefix`); the analyzer edge is **R ↔ neighbor**, never self. (Data-quality note for the analyzer: entries are prefixes, not full keys.)

**`node_regions`** (new kind; subject = the repeater R whose region table this is)
```json
{
  "origin": "<self name>", "origin_id": "<SELF_PUBKEY>",
  "timestamp": "<iso8601>", "type": "REGIONS",
  "subject_id": "<R_PUBKEY>", "subject_name": "<R name>",
  "source": "cli", "truncated": false,
  "regions": [ { "name": "DEN", "depth": 1, "flood_allowed": true, "is_home": true } ]
}
```
(`RepeaterRegionEntry` has no `parent`; hierarchy is encoded by `depth`.)

### 3.2 RTFM-EV publish side (the only code that ships here)

1. `FanoutModule` base (`app/fanout/base.py`): add no-op `on_neighbor` / `on_region` hooks (async), alongside existing `on_telemetry`.
2. `FanoutManager` (`app/fanout/manager.py`): add `broadcast_neighbor(data)` and `broadcast_region(data)`, both **always-match**, mirroring `broadcast_telemetry`. `broadcast_telemetry` is reused unchanged (it already carries `public_key` = R).
3. Community sink (`app/fanout/mqtt_community.py` + `app/fanout/community_mqtt.py`): implement `on_telemetry` / `on_neighbor` / `on_region`. Each: gate on the matching opt-in flag; build the envelope with `origin_id` from the keystore self key and `subject_id` from the event's remote pubkey; publish to the corresponding kind topic. Topic base derived from the existing IATA + self-pubkey rendering (no new template placeholders).
4. Producers (fire "directly after requests"):
   - Telemetry: already broadcasts — no producer change, only the sink gains `on_telemetry`.
   - Neighbors: add `fanout_manager.broadcast_neighbor({... subject public_key = contact.public_key, neighbors, reported_count})` at the end of `repeater_neighbors()` (`app/routers/repeaters.py:246`), best-effort (never fail the HTTP response on a fanout error).
   - Regions: add `fanout_manager.broadcast_region({...})` at the end of the region fetch handler.
5. Config (`app/routers/fanout.py::_validate_mqtt_community_config`): add opt-in booleans `publish_telemetry`, `publish_neighbors`, `publish_regions` (all default **false**), read in `mqtt_community.py::_config_to_settings`. No migration needed (config is a JSON blob in `fanout_configs`); defaults keep existing rows behaviour-identical.

### 3.3 Local time-series fold (repeater telemetry only)

- In `_collect_repeater_telemetry` (`app/radio_sync.py`), add summary metrics `neighbor_count` and `region_count` into the snapshot `data` blob. Use **most-recently-known** values (last neighbor/region fetch for that repeater) rather than forcing a fresh RF fetch each telemetry cycle — duty-cycle safe. If no value is known, omit the key (charts tolerate gaps).
- Frontend: add `neighbor_count` and `region_count` to `BUILTIN_METRIC_CONFIG` / `BUILTIN_METRICS` in `RepeaterTelemetryHistoryPane.tsx` so they chart and CSV-export alongside battery/noise. New i18n keys in EN/NL/DE (enforced — see repo rules).
- Contacts have no neighbor/region tables → fold is repeater-only. `contact_telemetry_history` unchanged.

### 3.4 Handoff notes (local sibling repos; docs only, no code)

- **EU-Meshcore-Analyzer**: new `docs/handoff-rtfm-forwarded-node-data.md` specifying the three kinds (`node_telemetry`, `node_neighbors`, `node_regions`), the `subject_id` convention, per-kind row keying **on `subject_id` (not the observer)**, the explicit rule that `node_neighbors` edges are R ↔ neighbor and must **not** produce observer self-edges, the prefix-not-full-key caveat on neighbor entries, and the `scripts/migration-numbers.sh` requirement for any new migration.
- **collector-wardrive**: new `docs/handoff-rtfm-forwarded-node-data.md` confirming the broker already passes these (topic pubkey + `origin_id` are both self), and flagging whether `SUBSCRIBER_FILTER_RULES` should be extended to the new subtopics. Expected outcome: **doc-only, no code change**.
- Firmware repos (official `dev`, DMC `dmc-observer-dev`) are **not local** → no notes; relevant firmware facts captured in §2/§6 here.

---

## 4. Key decisions & rationale

### 4.1 Why `subject_id`, not a remote-keyed topic or `origin_id`

The collector broker forces topic-pubkey == payload `origin_id` == authenticated publisher key (§2.4). RTFM-EV authenticates with its **own** radio key and cannot publish under R's key. So R must be a **payload field**, not the topic or `origin_id`. This mirrors how the observer `/neighbors` payload already carries per-entry `pubkey` distinct from the observer `origin_id`.

### 4.2 Kind naming: flat, observer-style, drop-safe

Use the observer's flat kind convention. `node_telemetry` is a brand-new peer kind the analyzer does **not** recognise, so central `Convert` skips it (`convert.go:168`) while the cache/ingestor buffers it verbatim — safe to enable immediately, no coordination. The neighbor and region forwards need the **same** drop-safe property; that only holds for kinds the analyzer does not already interpret. Reusing the recognised `neighbors` / `config` kinds would be interpreted *now* and misattributed to self (`convertNeighbors` keys to the observer), so those forwards use **distinct new kinds** too — proposed `node_neighbors` and `node_regions` (final names, §6.1) — keeping the flip-on-now guarantee across all three.

### 4.3 Safe to flip on immediately (confirmed model)

The ingestor/cache subscribes `meshcore/#` and buffers every message verbatim; central `Convert` skips kinds it does not recognise (`convert.go:168`; buffered until GC, reversible per the store's §5 note). So publishing a not-yet-recognised kind corrupts nothing — the analyzer drops it, then adds a path later and can re-process the retained buffer. This is why the publish flags can be enabled without waiting on the analyzer, **provided the kinds are new** (which is why neighbor/region forwards do not reuse `neighbors`/`config`). Verified: `convert.go:155-170`.

### 4.4 `subject_id` still required for correct attribution

Being dropped safely is only the interim state. Once the analyzer adds paths, every forwarded stream carries a *remote* subject (R), so the analyzer must key rows on `subject_id`, not the observer. The `subject_id` field is present from day one so the retained buffer is already correct when the path lands.

---

## 5. Testing / verification (repo rule: no "works" without proof)

- **Backend, TDD-first**: payload builders emit correct `origin_id`(self)/`subject_id`(R)/schema for each kind; config validator accepts+defaults the three flags; `broadcast_neighbor`/`broadcast_region` dispatch reaches the Community sink; opt-in flags gate publishing; fanout errors never break the HTTP request.
- **Frontend**: `neighbor_count`/`region_count` render in the history chart + CSV; i18n parity (EN/NL/DE) test passes; `prettier --check` passes (CI gate).
- **Runtime (must be observed, not reasoned)**: via the local Docker instance, point a Community config at a scratch MQTT broker, trigger a neighbor + telemetry + region fetch, and capture the actual published topics/payloads (`mosquitto_sub`), plus the history chart rendering the new series. Anything not runtime-observed is marked **NOT VERIFIED**.
- Two independent checks minimum before any "done" claim; confirm branch/build/URL match the change.

---

## 6. Open questions / assumptions

1. **Kind strings** — `node_telemetry` / `node_neighbors` / `node_regions` proposed (flat, observer-style). The one hard constraint: they must be **distinct** from the analyzer's recognised kinds (`status`/`neighbors`/`filter`/`config`/`packets`) so they are dropped, not misattributed. Confirm exact names before the analyzer handoff freezes them.
2. **Full pubkey for R** — producers pass `contact.public_key` (full). For neighbor *entries* only prefixes exist; documented as a downstream caveat. (Fact: `NeighborInfo.pubkey_prefix`.)
3. **Region fetch cadence for the fold** — `region_count` uses last-known value; no new scheduled RF fetch is added. (Assumption: acceptable; a scheduled region refresh is out of scope.)
4. **Which broker** — the Community sink's broker is operator-configured; this plan is broker-agnostic and assumes the DMC/collector broker's publisher==origin rule as the strict case.

---

## 7. Phasing

1. Fanout plumbing: base hooks + `broadcast_neighbor`/`broadcast_region` + Community `on_*` builders + config flags. (Backend, tested.)
2. Producers: wire broadcasts into neighbor/region fetch handlers. (Backend, tested.)
3. Local fold: `neighbor_count`/`region_count` into snapshot + history chart + i18n. (Backend + frontend, tested.)
4. Handoff docs into the two local repos.
5. Runtime verification against the local Docker instance + scratch broker.

No commits, PRs, or pushes without explicit instruction (repo rule).

---

## 8. Implementation status (2026-09-12)

TDD, verified in the `rtfm-ev-local` container venv (`/app/.venv`). All new + touched suites green (364 passed across fanout/community/repeater suites).

- **DONE — Phase 1 (publish side).** `_format_node_telemetry` / `_format_node_neighbors` / `_format_node_regions` builders (`app/fanout/community_mqtt.py`); `on_telemetry`/`on_neighbor`/`on_region` handlers + `_publish_node_report` in `app/fanout/mqtt_community.py` (topics `meshcore/{IATA}/{SELF}/node_telemetry|node_neighbors|node_regions`, opt-in gated); base hooks `on_neighbor`/`on_region` (`app/fanout/base.py`); `broadcast_neighbor`/`broadcast_region` (`app/fanout/manager.py`); config flags `publish_telemetry|neighbors|regions` default off (`app/routers/fanout.py`). Tests: `tests/test_community_forward.py`, `tests/test_community_forward_publish.py`, `tests/test_fanout_forward_dispatch.py`, `tests/test_fanout_router_community.py`.
- **DONE — Phase 2 (producers).** `broadcast_neighbor` after `repeater_neighbors`, `broadcast_region` after `repeater_regions` (`app/routers/repeaters.py`), best-effort. Telemetry already broadcast. Tests in `tests/test_repeater_routes.py`.
- **DONE — Phase 4 (handoff docs).** `docs/handoff-rtfm-forwarded-node-data.md` in both `EU-Meshcore-Analyzer` (add ingest paths) and `collector-wardrive` (broker passes it; filter-rule decision).
- **DONE — Phase 3 (local time-series fold).** Decision: fetch both on the telemetry schedule. `_collect_repeater_telemetry` (`app/radio_sync.py`) now also fetches `fetch_all_neighbours` (→ `neighbor_count`, preferring firmware `neighbours_count`) and `req_regions_sync` (→ `region_count` = non-empty anon names), both best-effort/non-fatal, folded into the snapshot `data`. Frontend: `neighbor_count`/`region_count` added to `BUILTIN_METRIC_CONFIG`, `chartData`, and CSV columns (`RepeaterTelemetryHistoryPane.tsx`); i18n keys `repeater_metric_neighbor_count`/`repeater_metric_region_count` in EN/NL/DE (parity verified). Tests: `tests/test_radio_sync.py::TestCollectRepeaterTelemetryLpp` (counts folded + fetch-failure tolerance). Frontend gates: prettier clean, no new tsc errors in touched files, locale parity 0-diff. (The full vitest suite cannot run in this worktree — pre-existing missing map deps `maplibre-gl`/`deck.gl`.)
- **PENDING — Phase 5 (runtime verification).** Publish to a scratch broker from the live container and observe topics/payloads (`mosquitto_sub`). Needs a connected radio + broker session; automated tests cover the publish path and payload shapes in the meantime.
