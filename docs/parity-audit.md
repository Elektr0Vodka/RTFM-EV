# RTFM-EV Parity & Gap Audit

Date: 2026-09-10
Status: backlog in progress (reconciled 2026-09-11). SHIPPED: N1, N2 (PR #24, merged), X1 (PR #41, merged), X2 core, X2b per-link signal history (PR #47). PARTIAL: L1, L2, L4. Next buildable: L3 (MQTT neighbors/config publish), now unblocked since X1+X2 are done. See §7 for per-item status.
Author: Elektr0Vodka (with agent research)

This is a living document. It compares the current RTFM-EV against two reference
sets, records what is Present / Partial / Absent, classifies each gap by
applicability to a web-terminal product, and ranks the gaps into a single
backlog. It supersedes ad-hoc feature lists and reconciles with the
`rtfm-ev-fork-port-plan` working backlog.

Every capability claim about RTFM-EV, the official app, and the DMC firmware in
this document comes from source inspection on 2026-09-10 (file:line citations
where a specific fact is load-bearing). Claims sourced only from secondhand web
summaries are marked **[web]** and treated as lower-confidence.

---

## 1. Purpose and scope

Goal: decide, on evidence, which features RTFM-EV should build and in what order,
so that i18n, MQTT export, and neighbor/region work land as one coherent roadmap
rather than four disconnected efforts.

Non-goal: literal "100% mirror" of the official app. RTFM-EV is a server + browser
terminal that connects to a companion radio; the official app is a BLE/USB mobile
client. Some official features are category-mismatched and are documented here as
N/A rather than pretended into the backlog.

## 2. Reference sets

**A. Official MeshCore companion app** (Liam Cottle). Closed source.
- Play Store `com.liamcottle.meshcore.android`; iOS `id6742354151`.
- Readable web build mirror: https://github.com/liamcottle/meshcore-web
- MQTT is **not** an official-app feature. It is a firmware/server concern.
  RTFM-EV MQTT export is therefore a differentiator, not parity.
- Feature facts below marked **[web]** were aggregated from meshcore.co.uk,
  mesh-sn.de, and store/changelog summaries; they were not read from a canonical
  changelog and should be confirmed against the `meshcore-web` source or the
  installed app before being treated as firm.

**B. DMC observer firmware** - branch `dmc-observer-dev-1171-regiongating`
(local checkout: `G:\Github\repositories\Dutch-MeshCore\MeshCore`, HEAD
`c55f3905`). First-class parity target for MQTT / neighbor / region features.

Crediting reference for the i18n work (separate sub-project): Marcel Verdult's
`kiekr-i18n` (https://github.com/marcelverdult/kiekr-i18n), CC-BY 4.0. See §9.

## 3. Method and legend

Each feature is one matrix row. Columns:

- **Status in RTFM-EV**
  - `Present` - exists and is usable
  - `Partial` - exists in some form, needs extension to reach parity
  - `Absent` - not present
  - `Unverified` - not inspected in the RTFM-EV codebase yet; confirm before scoping
- **Applicability** (does it make sense for a server + browser terminal?)
  - `App` - applicable, build it
  - `Adapt` - applicable but must be adapted from the mobile/firmware form
  - `N/A` - hardware- or mobile-only; documented, not backlogged
- **Ref** - which reference set the feature comes from (Off = official app,
  DMC = DMC firmware, both, or RTFM = RTFM-EV-native differentiator).

Effort/risk are captured in §7, not the matrix, to keep the matrix scannable.

## 4. RTFM-EV baseline (what exists today)

Backend (`app/`, FastAPI + aiosqlite, custom per-version migrations; `_063`
message region scope, `_064` Mention Ticker landed since - confirm current max
before adding one):
- Connects to a companion radio via the `meshcore` Python lib (BLE / serial / TCP).
- Multi-broker fanout via `fanout_configs` table; MQTT module types
  `mqtt_private`, `mqtt_community`, `mqtt_ha` (`app/fanout/*`, `app/routers/fanout.py`).
- Community MQTT already publishes a retained `/status` topic (hardcoded 5-min
  heartbeat, LWT offline) and raw-packet topics with SNR/RSSI/route/path
  (`app/fanout/community_mqtt.py`).
- `raw_packets` table stores `id/timestamp/data/message_id/payload_hash` only -
  **no `rssi`, `snr`, or `payload_type`** persisted (`app/database.py:70-77`).
  Signal values flow only through live events, never to the DB.
- Telemetry history exists (`_061`, `_062`); message region scope exists
  (`_063`: `messages.region`, `messages.transport_code`, `app_settings.known_regions`).

Frontend (`frontend/`, React 18 + TS + Vite, ~111 `.tsx`):
- DM + channel messaging, contact/channel info panes, repeater console,
  path discovery / direct trace, raw packet feed, Leaflet (Esri raster) map,
  network-graph + Three.js visualizer, settings (theme/fanout/database/radio/
  statistics/meshcomod).
- **Zero i18n infrastructure**: no library, no locale setting, all strings
  hardcoded English, hand-rolled pluralization.

## 5. Feature matrix

### Connectivity
| Feature | Ref | RTFM-EV | Appl. | Notes |
|---|---|---|---|---|
| BLE / USB-serial / TCP to node | Off | Present | Adapt | RTFM-EV connects server-side via `meshcore` lib, not phone BLE. |
| On-device pairing UX | Off | Absent | N/A | Mobile-only interaction model. |

### Messaging & contacts
| Feature | Ref | RTFM-EV | Appl. | Notes |
|---|---|---|---|---|
| Direct messages | Off | Present | App | |
| Channels | Off | Present | App | |
| Room-server connectivity | Off | Unverified | App | RTFM-EV depth not inspected; verify before scoping. **[web]** |
| Auto contact discovery | Off | Unverified | App | RTFM-EV behavior not inspected; verify vs app. **[web]** |
| Mute channel | Off | Absent | App | Small UI feature. **[web]** |
| Inline `<pubkey:1:Name>` contact sharing | Off | Absent | App | Upstream issue #347 (already in fork-port plan). |

### Repeater / admin
| Feature | Ref | RTFM-EV | Appl. | Notes |
|---|---|---|---|---|
| Repeater/room pairing + remote admin | Off | Present | App | Repeater console exists. |
| Run CLI on node | DMC | Partial | App | Companion `CMD_RUN_CLI_COMMAND 66` (v14+) available to host. |

### Adverts / path / map
| Feature | Ref | RTFM-EV | Appl. | Notes |
|---|---|---|---|---|
| Advert / message path viewer | Off | Present | App | Path discovery + network graph. |
| Slippy-tile map | Off | Present | App | Leaflet + Esri raster. |
| Antenna coverage tool | Off | Absent | Adapt | Heavy; mobile-oriented. **[web]** |
| Line-of-sight analysis | Off | Absent | Adapt | Heavy; mobile-oriented. **[web]** |
| Phone GPS location sharing | Off | Absent | N/A | No device GPS in a server context. |

### Telemetry
| Feature | Ref | RTFM-EV | Appl. | Notes |
|---|---|---|---|---|
| Telemetry history (battery etc.) | Off | Present | App | `_061`/`_062`. |
| Noise-floor viewer | Off | Absent | App | Needs signal-storage foundation (see §6). **[web]** |
| Receive-error graphs | Off | Absent | App | Needs signal-storage foundation. **[web]** |
| Direct/Flood packet metrics | Off | Partial | App | Needs signal-storage foundation. **[web]** |

### Neighbor discovery
| Feature | Ref | RTFM-EV | Appl. | Notes |
|---|---|---|---|---|
| Query a repeater's neighbors | both | Present | Adapt | `POST /contacts/{key}/repeater/neighbors` → `fetch_all_neighbours` (`REQ_TYPE_GET_NEIGHBOURS 0x06` via companion `CMD_SEND_BINARY_REQ 50`). Repeater-only opcode; room servers return "unknown command". |
| Neighbors on map + per-link signal | Off | Present | App | `RepeaterNeighborsPane` + `NeighborsMiniMap` (SNR/distance/last-heard + map). `scopes`/`status` are companion-unreachable (firmware `NeighborDiscoverEntry`/MQTT-only → L3), NOT in the binary response. |
| Per-link signal history (X2b) | Off | Present | App | `link_signal` table + inline sparkline / detail chart; repeater-query + passive 0-hop traffic perspectives. |

### Regions / scopes
| Feature | Ref | RTFM-EV | Appl. | Notes |
|---|---|---|---|---|
| Message region scope | both | Partial | App | `_063` exists; not yet surfaced/complete. |
| RegionMap scope tree display | DMC | Absent | Adapt | DMC `config` topic `region.scopes[]`, companion `CMD_GET_DEFAULT_FLOOD_SCOPE 64`. |
| Region-gating (duty-cycle) state | DMC | Absent | Adapt | DMC-only; `region_gate{}` in `filter`/`config` topics. Repeater-side; RTFM-EV can display if bridged. |
| IATA routing code | DMC | Partial | App | Community MQTT has `iata`. |

### MQTT export (RTFM-EV as the companion bridge)
| Feature | Ref | RTFM-EV | Appl. | Notes |
|---|---|---|---|---|
| `status` topic | DMC | Present | App | Community MQTT only; interval hardcoded 5 min. |
| `packets` topic | DMC | Present | App | Community MQTT raw-ish format. |
| `raw` topic | DMC | Partial | App | Private MQTT has `.../raw/...`; no per-broker toggle. |
| Per-broker per-topic toggles | DMC | Absent | App | DMC: `mqtt_status_enabled=1`, `mqtt_raw_enabled=0` default off. |
| Configurable status interval | DMC | Absent | App | DMC limits: 1-60 min (CLI) / 1000ms-3600000ms (bridge), default 5 min. |
| `neighbors` topic publish | DMC | Absent | Adapt | Reconstruct host-side. |
| `filter` stats topic | DMC | Absent | N/A | Repeater packet-filter concept; no companion analog. |
| `config` topic (NEW this branch) | DMC | Absent | Adapt | Full node config snapshot; RTFM-EV could mirror its own config. |
| Wire-compatible DMC payload schemas | DMC | Absent | App | Mirror `MQTTPayloadBuilder`/`MQTTMessageBuilder` JSON shapes. |

### Internationalization
| Feature | Ref | RTFM-EV | Appl. | Notes |
|---|---|---|---|---|
| UI language selection (EN/NL/DE) | RTFM | Absent | App | Whole sub-project; see §9 and separate spec. |

## 6. Key findings and corrections

1. **Companion firmware exposes no MQTT.** The DMC observer (all six topics) is
   repeater/room-server-only; no `platformio.ini` env combines `companion_radio`
   with `WITH_MQTT_BRIDGE`. RTFM-EV is the correct bridge: it reconstructs the
   payloads host-side and publishes them itself.

2. **Host-side reconstruction path** (companion `CMD_*` API, protocol v14 /
   `FIRMWARE_VER_CODE 14`):
   - `CMD_GET_STATS 56` (core/radio/packets counters) → `status`-equivalent payload.
   - `CMD_SEND_BINARY_REQ 50` relaying `REQ_TYPE_GET_NEIGHBOURS 0x06` to repeaters
     → `neighbors` data.
   - `CMD_GET_DEFAULT_FLOOD_SCOPE 64` → companion's own scope/region.
   - `CMD_RUN_CLI_COMMAND 66` → arbitrary node CLI.
   - Raw packets RTFM-EV already receives → `raw`/`packets`.

3. **MQTT is a differentiator, not parity.** It is absent from the official app,
   so it will not appear in any "official app" comparison; it is justified by the
   DMC ecosystem instead.

4. **DMC payload schemas are the interop contract.** To be wire-compatible,
   RTFM-EV should mirror the JSON field sets of `MQTTPayloadBuilder.cpp` (status,
   packets, raw, neighbors) and `MQTTMessageBuilder.cpp` (filter, config), and the
   `meshcore/{iata}/{device}/{type}` topic layout.

5. **Official status-interval limits** (answering the explicit request):
   **1-60 minutes** at the CLI (`set mqtt.interval`), bridge-clamped
   1000ms-3600000ms, **default 5 minutes**. Neighbors publish 12-336 h (default
   24 h); filter stats 60-600 s (default 60 s, 0=off); packets are event-driven
   (toggle only, no interval).

6. **Signal-storage foundation is a prerequisite**, not a feature. Noise-floor
   viewer, receive-error graphs, Direct/Flood metrics, and per-link neighbor
   signal all depend on persisting `rssi/snr/payload_type` (see
   `raw-packets-no-signal-columns` memory). It should land before the telemetry
   and neighbor-signal parity items.

7. **`config` topic (type 5) is new in this branch** and carries a full node
   config snapshot including `region_gate`, `region.scopes[]`, `repeat{}`. It is
   the richest single source for region/scope surfacing.

## 7. Prioritized backlog

Ranking axes: value, effort, protocol/firmware risk, differentiator-vs-parity.
Each "Now/Next" item gets its own brainstorm → spec → plan cycle.

### Now
- **N1. Signal-storage foundation** - ✅ SHIPPED (PR #12, migrations `_065`/`_066`;
  `rssi/snr/payload_type` on `raw_packets`, `/api/packets/recent|timeseries`).
  Unblocked Phase-3 (packet-feed history, My Node, MeshHealth - all merged).
- **N2. i18n (EN/NL/DE)** - ✅ IMPLEMENTED, PR #24 open + MERGEABLE (custom runtime
  in `frontend/src/i18n/`, EN/NL/DE catalogs, `no-literal-string` guard at error).
  NL/DE machine-drafted, native review still outstanding. Credit Marcel (§9).

### Next
- **X1. MQTT export parity** - ✅ IMPLEMENTED, PR #41 open + MERGEABLE
  (`feat/mqtt-dmc-observer-export`). New `mqtt_dmc_observer` fanout type: per-topic
  toggles (`status`/`packets` on, `raw` off), configurable status interval
  (1-60 min, clamp 1000-3600000 ms), faithful DMC firmware wire schema
  (`meshcore/{IATA}/{DEVICE}/{status|packets|raw}`, string SNR/RSSI, array path,
  `+00:00` timestamps, no LWT). Spec + plan under `docs/superpowers/`.
- **X2. Neighbor discovery** - DONE. The core (query a repeater's neighbors via
  `REQ_TYPE_GET_NEIGHBOURS 0x06` / `CMD_SEND_BINARY_REQ 50`; neighbor list +
  per-link signal + neighbors-on-map) was already shipped upstream and predates
  this audit; the rows above were mis-marked Absent. Verified out of reach:
  `scopes`/`status` are not in the binary response (firmware `NeighborDiscoverEntry`
  overlay, MQTT-only → L3); room servers do not answer `0x06` (repeater-only
  opcode). The buildable increment **X2b (per-link signal history)** shipped:
  `link_signal` table, opportunistic + tracked-cycle + passive 0-hop-traffic
  capture, history endpoint, sparkline + detail chart. Spec + plan under
  `docs/superpowers/`.

### Later
- **L1. Region / scope surfacing** - mirror DMC `config` topic `region.scopes[]`,
  `region_gate{}`; extend `_063` message region scope; `CMD_GET_DEFAULT_FLOOD_SCOPE`.
- **L2. Telemetry graph parity** - noise-floor viewer, receive-error graphs,
  Direct/Flood metrics (all gated on N1).
- **L3. MQTT `neighbors` / `config` topic publishing** (gated on X1 + X2).
- **L4. Small messaging parity** - mute channel, inline contact sharing (#347),
  auto contact discovery confirmation.

### Won't / N/A
- On-device pairing UX, phone GPS location sharing - mobile-only.
- `filter` stats topic - repeater packet-filter concept with no companion analog.
- Antenna coverage / line-of-sight tools - deferred as heavy/optional; revisit
  only if there is user demand.

## 8. Reconciliation with `rtfm-ev-fork-port-plan`

- The fork-port plan's "signal-storage foundation FIRST" == **N1**. Consistent.
- Fork-port Phase 3 (packet-feed history, My Node, MeshHealth) sits behind N1 and
  overlaps **L2**.
- Independent wins issue #347 (inline contact sharing) maps to **L4**;
  issue #354 (reaction format) is unaffected by this audit.
- i18n (**N2**) and MQTT export (**X1**) are new here and should be added to the
  fork-port plan backlog. Neighbor/region (**X2**/**L1**) are new DMC-parity items.

## 9. Crediting Marcel Verdult (i18n sub-project)

`kiekr-i18n` is CC-BY 4.0. When RTFM-EV adopts its semantics or any of its NL/DE
strings, attribution is required:

> Internationalization approach and translation strings adapted from
> kiekr-i18n by Marcel Verdult (@marcelverdult),
> https://github.com/marcelverdult/kiekr-i18n, licensed CC-BY 4.0.

Note: kiekr-i18n keys map to the KiekR app's UI, not RTFM-EV's React components,
so the *approach* (flat JSON, `%1$s` placeholders, ICU plural objects, `_meta`
blocks, English fallback) ports cleanly, but the key set must be authored against
RTFM-EV's own components. NL/DE string reuse is opportunistic where UI text
matches. This is detailed in the i18n sub-project spec, not here.

## 10. Next steps

1. You review this audit and the ranking.
2. On approval, reconcile the `rtfm-ev-fork-port-plan` memory with §7/§8.
3. Brainstorm the first "Now" item into its own spec (recommend **N2 i18n**, since
   you named it first and it has the least protocol risk; **N1** if you prefer to
   unblock telemetry/neighbor parity first).
