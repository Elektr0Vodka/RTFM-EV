# [12] Wardrive / mobile-GPS fanout

Date: 2026-09-10
Category: F (DMC firmware-aware node management)
Model: Opus
State: Speculative (feasibility assessment first; no committed design until the
position-transport question below is answered)
Scope: local planning only. No PRs, no issues, no commits. Code-is-truth: every
non-obvious claim cites `file:line` in RTFM-EV, the meshcore Python lib, or the
meshcomod / wardrive reference repos. Claims that could not be confirmed from code
are marked UNVERIFIED.

## Origin of this plan (user intent, verbatim)

> "fanout wardrive mqtt info when a user is connected to RTFM instance with a
> phone/meshcomod device so the phone gps can be used."

Plus a networking wrinkle the user hit before:

> a mobile meshcomod node (TCP/USB/BLE) connected via phone/USB/wifi-hotspot with
> tailscale/VPN to the home RTFM instance still shows its HOME LAN IP (e.g.
> 192.168.1.60) inside the instance, so the device is not distinguished as mobile.

Reading: while wardriving (moving around with a companion radio), publish each
heard packet to MQTT tagged with the current GPS position, so downstream tools
(triangulator, wardrive collector) can use the observation. The GPS should come
from the phone. The device-identity problem is: how does the instance know it is
mobile and attach a moving position instead of the static home location.

---

## 1. Summary and FEASIBILITY VERDICT

**Verdict: FEASIBLE, under one condition.** RTFM-EV can publish wardrive records
over the existing fanout MQTT bus with minimal new machinery. The packet-observation
half already exists verbatim (`app/fanout/community_mqtt.py` builds and publishes
per-packet RSSI/SNR/path records). The missing half is a **live, moving position**
fed to the backend so a fanout module can tag each observation with it.

The condition: **a live position must reach the backend fanout layer.** Three
candidate sources exist; their status:

1. **Operator browser geolocation (RECOMMENDED, and the literal "phone GPS" the
   user asked for).** Already shipping for two other features
   (`frontend/src/components/MapView.tsx:383-393` centers the map on
   `navigator.geolocation`; `frontend/src/components/settings/SettingsRadioSection.tsx:335-357`
   "Use My Location" fills the radio's advertised lat/lon). On a phone, the browser's
   geolocation *is* the phone GPS. **Gap:** geolocation lives in the browser; the
   fanout bus runs backend-side. There is **no existing channel to push a live
   operator position from browser to backend** (verified: no operator-position store
   or WebSocket client-position handler exists in `app/`). This is the one piece of
   genuinely new plumbing the feature needs.

2. **Companion radio's own advertised position** (`self_info["adv_lat"]/adv_lon`).
   Readable backend-side today (`app/routers/radio.py:397-398`). This is a live fix
   **only if** the connected meshcomod device runs onboard-GPS firmware that keeps
   `node_lat` fresh. The onboard GPS driver exists in meshcomod
   (`src/helpers/sensors/EnvironmentSensorManager.cpp:178-213`, RAK12500 u-blox GNSS)
   but the interval wiring that would copy the live fix into the advertised
   `node_lat` is **UNVERIFIED** on the meshcomod `main` branch (see 3.1). Most
   companions have no GPS chip; their `adv_lat` is a manually set static home value.

3. **Self-telemetry LPP GPS** (`get_self_telemetry`, meshcore lib
   `commands/device.py:203`; LPP type 136 = gps,
   `.venv/Lib/site-packages/meshcore/lpp_json_encoder.py:32`). Same onboard-GPS
   dependency as (2), and RTFM currently *discards* multi-value GPS telemetry
   (`app/radio_sync.py:1838` "Skip multi-value sensors (GPS, accelerometer, etc.)").

**The device-identity / home-IP problem is largely dissolved, not solved, by
choosing source (1).** If position comes from the operator's browser
(per-client, genuinely mobile), the instance never needs to infer mobility from the
network connection, so the tailscale-shows-LAN-IP issue does not block wardriving.
Attempting the opposite (auto-detecting "this device is mobile" from the connection)
is **NOT cleanly solvable** and is filed as an OPEN QUESTION in 6.2: RTFM connects to
exactly one radio chosen by env var (`app/config.py:60-65`), tracks no per-connection
client IP, and a VPN/tailscale tunnel deliberately presents a stable LAN address.

**Recommended path:** browser-geolocation source (1) + a new lightweight
"operator live position" backend endpoint/store + a new `wardrive` fanout module
that tags `on_raw` packets with that position and publishes to a wardrive topic. A
manual "I am wardriving" toggle replaces any attempt at automatic mobile detection.

---

## 2. Current state (cited)

### 2.1 Fanout bus: what a packet observation already looks like

The fanout bus dispatches radio events to integration modules
(`app/fanout/AGENTS_fanout.md`). Relevant hooks:

- `on_raw(data)` receives every raw RF packet. Payload fields:
  `id`, `observation_id`, `raw` (hex), `timestamp`, optional `decrypted_info`
  (`app/fanout/AGENTS_fanout.md` "on_raw(data)").
- Scope gating: a module with `{"messages":"none","raw_packets":"all"}` receives
  only raw packets. Community MQTT enforces exactly this
  (`app/fanout/AGENTS_fanout.md` "Scope Matching").

The **community MQTT module already builds a full packet observation record** and
publishes it. Fields in the published dict
(`app/fanout/community_mqtt.py:180-195`):

```
time, date, len, packet_type, route, payload_len, raw, SNR, RSSI, hash
```

plus `path` (comma-separated hop identifiers) for direct packets
(`app/fanout/community_mqtt.py:192-195`). It publishes to a fixed topic
`meshcore/{IATA}/{PUBKEY}/packets` (`_build_status_topic` pattern,
`app/fanout/community_mqtt.py:197-200`, uses the operator IATA region code). This is
exactly the "packet observation + signal" half of a wardrive record. What it lacks
is a per-packet position.

### 2.2 A fanout module that already reads live position

`map_upload` (`app/fanout/map_upload.py`) demonstrates the pattern of a raw-only
fanout module that reads the radio's live position at dispatch time:

- Scope fixed to `{"messages":"none","raw_packets":"all"}`
  (`app/fanout/AGENTS_fanout.md` "map_upload").
- Geofence center read **live** from `self_info` at upload time, not stored in config
  (`app/fanout/map_upload.py:207-209`: `adv_lat`/`adv_lon` from
  `radio_runtime.meshcore.self_info`).
- Silently skips when the radio lat/lon is `(0,0)` or disconnected
  (`app/fanout/AGENTS_fanout.md` "Geofence notes").

A wardrive module would follow this shape but read position from an operator-position
source rather than the static radio advert.

### 2.3 Existing live-GPS use in the app (reclassifies the parity "N/A" entry)

Live browser geolocation already ships in two places:

- Map auto-centre: `navigator.geolocation.getCurrentPosition` in
  `frontend/src/components/MapView.tsx:383-393`.
- "Use My Location" button that writes the browser fix into the radio's advertised
  coordinates: `frontend/src/components/settings/SettingsRadioSection.tsx:335-357`
  (getter) and `:1074` (button). It posts lat/lon through the radio-config update
  path, which calls `mc.commands.set_coords(...)`
  (`app/services/radio_commands.py:84-87`).

This is why the parity-audit entry "phone GPS sharing = N/A" is stale: the browser
(a phone's browser on a phone) already provides a fix the app consumes. See 9.

### 2.4 Position primitives available backend-side

- **Set** the radio's advertised coords: meshcore lib `set_coords(lat, lon)` is the
  only location-write command (`.venv/Lib/site-packages/meshcore/commands/device.py:53-61`;
  wraps companion frame `0x0e`).
- **Read** the radio's advertised coords: `self_info["adv_lat"]/adv_lon`
  (`.venv/Lib/site-packages/meshcore/reader.py:171`; surfaced via
  `GET /api/radio/config`, `app/routers/radio.py:397-398`). `adv_loc_policy`
  distinguishes "off" vs "current" (`app/routers/radio.py` `AdvertLocationSource`).
- **Self-telemetry** including LPP: `get_self_telemetry()`
  (`.venv/Lib/site-packages/meshcore/commands/device.py:203-206`); LPP GPS is type
  136 (`.venv/Lib/site-packages/meshcore/lpp_json_encoder.py:32`). RTFM currently
  drops multi-value GPS readings (`app/radio_sync.py:1838`).

### 2.5 What does NOT exist today (verified absence)

- **No operator / browser live-position store or endpoint.** `git grep` for
  `operator.*lat`, `my_position`, `operator_position`, `live_position`, `mobile` in
  `app/` returns only unrelated matches (PWA manifest screenshots). The map's "our
  position" comes from `self_info.adv_lat/adv_lon`, not a browser feed
  (`app/routers/radio.py:397-398`).
- **No per-connection client IP tracking.** The WebSocket manager logs only a
  connection count, never `request.client` / peer address
  (`app/websocket.py:29-35`).
- **Single-radio, env-chosen transport.** Exactly one of serial/TCP/BLE is active,
  decided at startup by env var (`app/config.py:40-65`). There is no notion of
  multiple or "mobile vs home" radios in one instance.

---

## 3. Reference research

### 3.1 meshcomod GPS exposure (cited / UNVERIFIED)

Local: `G:\Github\repositories\Elektr0Vodka\meshcomod`, branch `main`.

VERIFIED facts:

- GPS prefs exist and are **off by default**: `gps_enabled`, `gps_interval`
  (`examples/companion_radio/NodePrefs.h:28-29`); defaults
  `gps_enabled=0`, `gps_interval=0` "No automatic GPS updates by default"
  (`examples/companion_radio/MyMesh.cpp:2335-2336`).
- The node keeps a single position pair `sensors.node_lat` / `sensors.node_lon`, used
  when building self-adverts (`examples/companion_radio/MyMesh.cpp:2901,2994,4294`).
- The **host can push a position** via companion frame `CMD_SET_ADVERT_LATLON`, which
  writes `node_lat`/`node_lon` (`examples/companion_radio/MyMesh.cpp:2865-2879`). This
  is the wire path behind `set_coords` (2.4). It is the "phone pushes its GPS to the
  companion" model the sources-of-truth doc calls "phone-GPS support"
  (`docs/sources-of-truth.md` meshcomod entry).
- A meshcomod-specific CLI exposes and edits the position: `get` returns
  `lat`/`lon` from `node_lat/node_lon`
  (`examples/companion_radio/MyMesh.cpp:546-548`); `set gps` / `set gps_interval`
  guarded by `#if ENV_INCLUDE_GPS == 1`
  (`examples/companion_radio/MyMesh.cpp:3589-3596`).
- An **onboard GPS driver exists** for RAK boards: a `LocationProvider` around a
  RAK12500 u-blox GNSS over i2c, whose `loop()` reads a live fix into `_lat/_lng`
  (`src/helpers/sensors/EnvironmentSensorManager.cpp:166-213`). Compiled only under
  `ENV_INCLUDE_GPS && defined(RAK_BOARD)`
  (`src/helpers/sensors/EnvironmentSensorManager.cpp:166-168`).
- Telemetry can carry a location permission bit `TELEM_PERM_LOCATION`
  (`examples/companion_radio/MyMesh.cpp:2016-2018`), consistent with LPP GPS being
  offered in (self-)telemetry.

UNVERIFIED / could not confirm from code:

- Whether the onboard `LocationProvider` fix is **automatically copied into
  `node_lat`** on `gps_interval`, i.e. whether the advert (and therefore
  `self_info.adv_lat`) tracks the live GPS on the meshcomod `main` branch. Searching
  `MyMesh.cpp` for a provider->`node_lat` interval write found only the prefs, not the
  copy. A `cad-companion-status-*` worktree branch carries more GPS files; the auto
  update may live there rather than on `main`. Treat "onboard GPS auto-updates the
  advertised position" as UNVERIFIED until the specific firmware build is inspected.

Consequence for RTFM: the **verified** backend-visible position from the companion is
whatever `set_coords` last wrote (host-pushed). A live onboard-GPS fix arriving
through `self_info` without host help is UNVERIFIED and hardware/firmware dependent.
This is why source (1) (browser) is recommended over sources (2)/(3).

### 3.2 Wardrive payload references (cited)

**collector-wardrive** (`G:\Github\repositories\Dutch-MeshCore\collector-wardrive`)
is an MQTT **broker/collector**, not a publisher. It defines the topic grammar a
wardrive publisher must use (`docs/observer-feed-contract.md`):

- Topic: `meshcore/{region}/{pubkey}/{subtopic}`.
- `region` may be an IATA code, `test`, or a **reserved stream label**; the default
  reserved labels are `wardriver` and `hunter`
  (`docs/observer-feed-contract.md` "Topic grammar"; `src/config.ts:92`
  `RESERVED_REGION_LABELS ?? 'wardriver,hunter'`).
- Known wardrive subtopics: **`wardriver/obs`** and **`wardriver/track`**
  (`docs/observer-feed-contract.md` "Topic grammar"; referenced in
  `src/message-filter.ts:8`).
- `pubkey` must be the publisher's 64-hex MeshCore public key and must match the
  authenticated key and the payload `origin_id`
  (`docs/observer-feed-contract.md` "Topic grammar").
- Role-3 subscribers get `SNR`, `RSSI`, `score` stripped from `packets`
  (`docs/observer-feed-contract.md` "How end users get the filtered view"). A
  wardrive record's signal fields are therefore whitelist-gated downstream.
- QoS 0; wardrive subtopics are not retained
  (`docs/observer-feed-contract.md` "Retain and QoS").

**meshcore_mqtt_triangulator** (`G:\Github\repositories\Elektr0Vodka\meshcore_mqtt_triangulator`,
"MC-Gluurbuur") is a **consumer** of the same feed. It correlates, per observation
(`README.md` "How it works"):

- the advert's `path` (relay sequence) as heard by each receiving radio,
- where each relay is (GPS learned from adverts),
- **where the receiving radio is** (its GPS, "from their adverts or from operator
  metadata").

So the triangulator's requirement on a wardrive publisher is exactly: publish the
packet as heard (raw + path + RSSI/SNR) **tagged with the receiver's current GPS**.
That matches the record defined in 4.2.

---

## 4. Design IF feasible

Design assumes the recommended path: browser-geolocation source + operator-position
backend store + a new `wardrive` fanout module. Each sub-section marks what is new vs
reused.

### 4.1 GPS source selection

Priority order the wardrive module resolves at publish time, first available wins:

1. **Operator live position** pushed from the browser (NEW plumbing, 4.4). Preferred
   because it is per-operator, mobile-accurate, and needs no GPS chip.
2. **Radio `self_info.adv_lat/adv_lon`** if non-`(0,0)` (REUSE, 2.4). Only useful when
   onboard-GPS firmware keeps it fresh (UNVERIFIED, 3.1); otherwise it is the static
   home location and must not be used for wardriving. Gate behind an explicit
   "position source = radio GPS" operator choice so a stale home value is never
   published as a moving fix.
3. **None** -> the module drops the observation (mirrors `map_upload`'s
   `(0,0)`/disconnected skip, `app/fanout/AGENTS_fanout.md` "Geofence notes").

Selection is an explicit config field, not auto-magic. Do not attempt to infer the
source from the connection (see 6.2).

### 4.2 Wardrive record (proposed shape)

Reuse the community-MQTT observation builder (`app/fanout/community_mqtt.py:180-195`)
and add position + fix metadata. Proposed record for `wardriver/obs`:

```
{
  "origin_id":  "<64-hex publisher pubkey>",   // must equal topic pubkey (3.2)
  "timestamp":  "<UTC ISO8601>",
  "raw":        "<packet hex, upper>",          // from on_raw.raw
  "hash":       "<packet hash>",
  "packet_type":"<type>",
  "route":      "F|D",
  "path":       "<comma-separated hops>",       // direct packets only
  "len":        <int>, "payload_len": <int>,
  "SNR":        <float>, "RSSI": <int>,          // whitelist-gated downstream (3.2)
  "lat":        <float>, "lon":  <float>,        // NEW: receiver position at RX
  "pos_source": "browser|radio_gps",            // NEW: provenance
  "pos_age_s":  <float>                          // NEW: seconds since fix, for QA
}
```

Assumption (not verified against a live collector schema): field names for `raw`,
`SNR`, `RSSI`, `path`, `hash` mirror the community-MQTT record so existing consumers
parse them unchanged. `lat`/`lon`/`pos_source`/`pos_age_s` are additive. OPEN
QUESTION 6.4 covers confirming the exact `wardriver/obs` field contract with a
collector maintainer.

`wardriver/track` (a breadcrumb of operator position over time, independent of any
packet) is a possible second publish; deferred to a later phase (5).

### 4.3 Fanout topic and module

New fanout module type `wardrive` following the AGENTS_fanout "Adding a New
Integration Type" checklist (`app/fanout/AGENTS_fanout.md`):

- `app/fanout/wardrive.py`: `WardriveModule(FanoutModule)`, scope fixed to
  `{"messages":"none","raw_packets":"all"}`, `on_raw` builds the 4.2 record and
  publishes it. Reuse `BaseMqttPublisher` (`app/fanout/mqtt_base.py`) for the wire, as
  `mqtt_community` does.
- Topic: `meshcore/wardriver/{PUBKEY}/obs` (reserved label `wardriver`, 3.2).
- Register in `app/fanout/manager.py` `_register_module_types()`, add to
  `_VALID_TYPES` + validator + scope enforcement in `app/routers/fanout.py`, add
  editor in `frontend/src/components/settings/SettingsFanoutSection.tsx` (all per the
  checklist).
- Config blob: `broker_host`, `broker_port`, auth fields, `pos_source`
  (`browser`|`radio_gps`), optional `min_fix_interval_s`. Reuse the community/private
  MQTT config field patterns.

Design decision: a **new module** rather than extending `mqtt_community`, because
community MQTT hard-codes the IATA-region topic and a fixed scope
(`app/fanout/community_mqtt.py:197-200`; `app/fanout/AGENTS_fanout.md` "Scope
Matching"), and wardriving needs a different topic label and a position tag.

### 4.4 Device identity and the moving-position problem

The honest framing: **the instance cannot reliably auto-detect that its companion is
mobile**, and it does not need to. Resolution:

- **Position provenance replaces mobility detection.** The operator explicitly turns
  on wardriving; position comes from the browser (per-client, moving) or a
  GPS-firmware radio. No IP heuristic is involved.
- **Browser -> backend position channel (the one new primitive).** Options, to be
  decided in 6.1:
  - (a) A `POST /api/wardrive/position` endpoint the frontend calls on each
    `watchPosition` update; backend keeps the latest fix in a small in-memory store
    the `wardrive` module reads (analogous to how `map_upload` reads `self_info`
    live). Simplest; survives no restarts, which is fine for a live feed.
  - (b) A WebSocket client->server message carrying position. Reuses the existing
    socket but the current manager is broadcast-only with no inbound
    position handler (`app/websocket.py:29-35`), so this is more work.
  - Recommendation: (a).
- **The tailscale/home-IP observation is real but orthogonal.** Because RTFM connects
  to one env-chosen radio and tracks no client IP (2.5), and a VPN presents a stable
  LAN address by design, there is no code path today that could label a connection
  "mobile". Trying to build one is out of scope; see 6.2.

### 4.5 If the condition cannot be met (requirements to unblock)

If browser->backend position (4.4) is rejected and no onboard-GPS firmware is
available, the feature is **blocked**. Minimum to unblock:

1. Confirm at least one live position source reaches the backend (browser endpoint,
   or a verified onboard-GPS meshcomod build whose fix appears in `self_info.adv_lat`,
   resolving 3.1's UNVERIFIED item).
2. Confirm the `wardriver/obs` field contract with a collector maintainer (6.4).

---

## 5. Phasing

Each phase is independently shippable and independently verifiable.

- **Phase 0 (spike, no user-visible change): resolve the condition.** Verify browser
  geolocation can reach the backend (prototype endpoint 4.4a) and confirm the
  `wardriver/obs` contract (6.4). Exit criterion: a logged position + a hand-built
  record accepted by a test broker.
- **Phase 1: operator-position store + endpoint.** `POST /api/wardrive/position`,
  in-memory latest-fix store, frontend `watchPosition` sender behind a "Wardrive"
  toggle. No MQTT yet. Verify via the endpoint + a UI position readout.
- **Phase 2: `wardrive` fanout module.** New module publishing `wardriver/obs` from
  `on_raw` + the Phase 1 store, following the AGENTS_fanout checklist. Verify against
  a local broker and the triangulator ingest.
- **Phase 3 (optional): `wardriver/track` breadcrumbs** and a radio-GPS position
  source once 3.1 is verified.

Dependency note: `docs/plans/README.md` sequences [12] after [11] "wardrive-gps
depends on [11] ingestion transport + device identity". Reassess: the **outbound**
MQTT plumbing this plan needs already exists (`app/fanout/mqtt_base.py`,
community/private MQTT modules), so [12] does **not** strictly depend on [11]'s
*inbound* subscriber. The shared surface is broker config, which [12] reuses from
`fanout_configs` directly. Recommend decoupling [12] from [11] in the README dependency
graph (see 9).

---

## 6. Risks and OPEN QUESTIONS

### 6.1 OPEN QUESTION: browser->backend position transport
Endpoint (4.4a) vs WebSocket inbound (4.4b). Recommendation is (a); needs sign-off.
Also: update cadence, and whether the latest-fix store should be per-connected-client
or a single global "current operator" (single global is simpler and matches the
single-radio model, 2.5).

### 6.2 OPEN QUESTION (NOT cleanly solvable): auto-detect "mobile" device
RTFM cannot distinguish a mobile companion from a home one via the network: single
env-chosen radio (`app/config.py:60-65`), no client-IP tracking
(`app/websocket.py:29-35`), and tailscale/VPN presents a stable LAN IP by design.
**Resolution: do not attempt auto-detection; use an explicit wardrive toggle +
position provenance (4.4).** Filed here so the idea is not silently reintroduced.

### 6.3 Risk: publishing a stale home location as a "moving" fix
If `pos_source = radio_gps` but the firmware has no live GPS (3.1 UNVERIFIED), the
module would publish the static home coordinate on every packet, poisoning
triangulation. Mitigation: default `pos_source = browser`; require explicit opt-in
for `radio_gps`; publish `pos_age_s` so consumers can reject stale fixes; skip when
position is `(0,0)` (mirrors `map_upload`, 4.1).

### 6.4 OPEN QUESTION: exact `wardriver/obs` field contract
The record in 4.2 is inferred from the community-MQTT record
(`app/fanout/community_mqtt.py:180-195`) and the topic grammar
(`collector-wardrive/docs/observer-feed-contract.md`). The precise field names
`wardriver/obs` expects are UNVERIFIED against collector code (the collector strips
fields but its ingest schema for that subtopic was not located in
`collector-wardrive/src`). Confirm with a maintainer or a collector schema before
Phase 2.

### 6.5 Risk: privacy
Publishing a live operator position to a public broker is a location-disclosure
feature. It must be off by default, clearly labelled, and gated behind the explicit
toggle. Note the downstream feed already treats mapper identity + radio metrics as
whitelist-only (`collector-wardrive/docs/observer-feed-contract.md` "Listen-only
posture").

### 6.6 Risk: firmware-branch drift (3.1)
The onboard-GPS auto-update wiring may exist on a meshcomod feature branch but not
`main`. Any `radio_gps` source work must pin the exact firmware build inspected.

---

## 7. Verification plan

Per repo rule "never claim it works without proof", each phase needs two independent
checks:

- **Phase 1:** (a) `curl POST /api/wardrive/position` then read the store back and see
  the fix; (b) open the app on a phone browser, toggle wardrive, observe the position
  readout update while walking (runtime observation, not reasoned).
- **Phase 2:** (a) point the module at a local Mosquitto broker and `mosquitto_sub -t
  'meshcore/wardriver/#'` to see records with `lat/lon` while packets arrive; (b) feed
  that broker into the triangulator (`meshcore_mqtt_triangulator` collector) and
  confirm it ingests the observations without schema errors.
- **Cross-checks:** run `./scripts/quality/all_quality.sh` (repo end-to-end gate,
  `AGENTS.md`); confirm the module appears in `GET /api/fanout` and the
  `SettingsFanoutSection` editor renders (frontend test in
  `frontend/src/test/fanoutSection.test.tsx`).
- Confirm the thing tested is the thing changed: right branch, right broker, records
  carrying a *moving* `lat/lon` (not the static home value).

Anything not runtime-observed (e.g. onboard-GPS `self_info` freshness) stays marked
UNVERIFIED until observed on hardware.

## 8. Effort

Rough, assuming the condition (browser position) is chosen:

- Phase 0 spike: 0.5 day (mostly the contract question 6.4 and firmware check 3.1).
- Phase 1 (endpoint + store + frontend toggle/sender): ~1 to 1.5 days.
- Phase 2 (`wardrive` fanout module + full AGENTS_fanout checklist + tests): ~1.5 to
  2 days.
- Phase 3 (track breadcrumbs, radio-GPS source): ~1 day, only after 3.1 verified.

Total to a usable wardrive feed (Phases 0-2): ~3 to 4 days. The single largest
unknown is not code volume but the two OPEN QUESTIONS (6.1 transport choice, 6.4
contract confirmation); both are cheap to resolve before building.

---

## 9. Reconciliation with existing planning artifacts

- **`docs/plans/README.md` entry [12]** (State: Speculative; depends on [11]): this
  document keeps the Speculative classification and delivers a feasibility verdict as
  its primary output (FEASIBLE under one condition, 1). It **challenges the stated
  dependency on [11]**: the outbound MQTT plumbing already exists
  (`app/fanout/mqtt_base.py`, community/private modules), so [12] needs only broker
  config from `fanout_configs`, not [11]'s inbound subscriber. Recommend loosening the
  README dependency edge from "depends on [11]" to "shares broker config with [11]".
- **`docs/parity-audit.md` "phone GPS sharing = N/A"** (lives on branch
  `feat/i18n-en-nl-de`): this plan **reclassifies that entry from N/A to
  Partially-shipped/Feasible**. Live browser GPS already reaches the app
  (`frontend/src/components/MapView.tsx:383-393`;
  `frontend/src/components/settings/SettingsRadioSection.tsx:335-357`), and the
  remaining wardrive-specific work is the browser->backend position channel plus the
  fanout module, not a from-scratch GPS capability. README already flagged this entry
  as "already partially reclassified by the shipped copy-location-to-chat feature"
  (`docs/plans/README.md` reconciliation section).
- **`docs/sources-of-truth.md`**: meshcomod is cited as the "source of CAD and
  phone-GPS support" (meshcomod entry). This plan confirms the phone-GPS wire path is
  the host-push `CMD_SET_ADVERT_LATLON` / `set_coords` frame
  (`meshcomod .../MyMesh.cpp:2865-2879`; meshcore lib `commands/device.py:53-61`), and
  that an onboard-GPS driver exists but its advert auto-update is UNVERIFIED on `main`
  (3.1). collector-wardrive and meshcore_mqtt_triangulator are used per their
  sources-of-truth roles (wardrive ingest reference; triangulation consumer).
