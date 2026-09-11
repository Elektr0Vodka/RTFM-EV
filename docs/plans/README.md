# RTFM-EV Feature Planning Backlog

Date: 2026-09-10
Status: living index
Scope: local planning only. No PRs, no issues, no commits from these plans.

This directory turns a single brain-dump of feature ideas into a set of
categorised, de-duplicated, individually-scoped plans. Each plan is a standalone
`NN-slug.md` file. This README is the map: categories, how ideas were combined,
per-plan model assignment, dependencies, and how everything reconciles with the
two existing planning artifacts.

Product framing: RTFM-EV is a **MeshCore** server + browser terminal that drives a
companion radio (BLE / serial / TCP). It is not Meshtastic and it is not the
official mobile app. Firmware references are MeshCore / DMC-MeshCore.

## Existing planning artifacts (do not duplicate; reconcile against these)

- `docs/parity-audit.md` (lives on branch `feat/i18n-en-nl-de`) - ranked backlog
  vs the official companion app + DMC observer firmware. Defines N1 signal-storage
  foundation (SHIPPED as PR #12), N2 i18n, X1 MQTT export, X2 neighbor discovery,
  L1 region/scope, L2 telemetry graphs, L3 MQTT neighbors/config publish, L4 small
  messaging parity.
- `rtfm-ev-fork-port-plan` (agent memory) - porting old-fork features + upstream
  picks. Phase 1/2 shipped; Phase 3 (packet-feed history, My Node, MeshHealth) is
  unblocked by N1.
- `docs/sources-of-truth.md` - canonical firmware/tooling repo pointers (written
  alongside this index; linked from `AGENTS.md`).

## Legend

- **Model**: suggested agent model for producing the plan and, later, the work.
  `Haiku` = mechanical / low-ambiguity. `Sonnet` = standard feature scoping.
  `Opus` = high complexity, cross-cutting, protocol/firmware or feasibility risk.
- **State**: `Absent` (greenfield), `Partial` (extends existing code), `Blocked`
  (has a hard dependency), `Speculative` (feasibility not established).
- Every plan must obey the repo rules: smallest change, code-is-truth (cite
  file:line), mark facts vs assumptions, surface open questions instead of
  inventing answers, no commits.

## Categories and combination decisions

The raw brain-dump items collapse into 9 themed categories and 17 plans (03-19).
Items that were the same underlying capability were merged; items that only shared
a reference repo were kept separate. Plans [15] and [16] were added after the first
review round (user requests: wire the Channel Registry into channel import/export,
and resolve node names from analyzers to fill in short-id displays). Plans
[17]-[19] were added 2026-09-11 (user requests: port the old-fork sidebar
customisation; add multi-radio identity/history so a swapped or replaced feeding
radio stays coherent; and broaden persistence toward an "analyzer with one node
feeding it").

### A. Hygiene & docs
- **A0. Em-dash removal** - VERIFIED near-complete: `git grep` finds **0** em-dashes
  (U+2014) and 0 en-dashes (U+2013) in tracked files on this branch. The
  `no-em-dashes` policy already scrubbed the mainline. Remaining work is a *guard*
  (pre-commit / lint) to prevent reintroduction, plus a sweep of unmerged feature
  branches. Handled inline in this index (see "Em-dash status" below); no separate
  plan file needed unless the guard grows.
- **A1. Sources-of-truth doc** - DONE in this pass: `docs/sources-of-truth.md`,
  linked from `AGENTS.md`. Points at DMC firmware (both flavours), meshcomod-ev,
  official MeshCore, and the analyzer/toolbox tooling.

### B. Contacts & messaging UX
- **[03] Split favorites** - favorited *contacts* vs favorited *repeaters /
  room-servers*, ported from the old fork. `Sonnet`.
- **[06] CAD toggle for DMs** - listen-before-transmit (Channel Activity Detection)
  toggle surfaced in the DM header/composer; meshcomod firmware exposes CAD.
  `Sonnet`.
- **[07] Path-hash message filter** - show/hide 1-byte / 2-byte / 3-byte
  path-hash-mode messages in channel/message lists. `Sonnet`.

### C. External analyzer integration
- **[04] Analyzer lookup + add-contact** - user-defined analyzer sites; deep-link
  "Look up on analyzer" for node/packet/unknown-id, and "Add contact from
  analyzer". Reference sites: `mc-radar.woodwar.com/node/<64hex>`,
  `cornmeister.nl/#node?id=<64hex>`. `Sonnet`.
- **[16] Analyzer name resolution** - automatic/bulk resolution of node names from
  the analyzers to fill in names wherever only a short id (1b/2b/3b path-hash hop,
  or a bare pubkey prefix) is shown (visualizer and elsewhere). Reuses [04]'s
  analyzer config; server-side fetch + cache. Feasibility-gated on whether a short
  hop hash can be reversed to a node. `Sonnet`.

### D. Registry / list sync (extends the shipped Channel Registry sync pattern)
- **[05] Region-scope list sync** - grow the manual `known_regions` list into a
  synced local list from the DMC toolbox channel-browser, mirroring how the Channel
  Registry syncs. `Sonnet`.
- **[09] Channel-finder wordlist sync** - refresh the channel-finder / cracker
  wordlist from curated sources (the `mccl` repo). `Sonnet`.

### E. Radio provisioning
- **[08] Channel/contact preset upload before disconnect** - one-click push a saved
  set of channels/contacts to the radio before leaving RTFM's reach. `Sonnet`.
- **[15] Channel Registry to radio import** - wire the shipped Channel Registry into
  the existing channel import/export path so registry channels can be added into the
  app and onto the radio. Bridges categories D (registry) and E (provisioning).
  `Sonnet`.

### F. DMC firmware-aware node management (largest theme; three plans)
- **[10] Firmware-aware repeater/observer management** - detect reported firmware
  (DMC Repeater vs DMC-MQTT-Repeater vs stock), gate the management UI to only the
  options that firmware supports, allow manual device-type/fw override (replies can
  fail), and fold in **webconfig detection** (same-wifi) and **OTA check/update**
  (DutchMeshCore-OTA). `Opus`.
- **[11] DMC MQTT ingestion + "My Local Nodes / My Mesh NOC"** - INBOUND MQTT: ingest
  status/config/filter from DMC-wifi-fw nodes on the same network (or via
  tailscale), a dedicated local-nodes page, historical status/telemetry/filter
  panels, and optional remote management over MQTT. `Opus`.
- **[12] Wardrive / mobile-GPS fanout** - use a phone/meshcomod device's GPS to fan
  out wardrive MQTT info while that device is bridged into the RTFM instance;
  includes the device-identity/networking problem (home IP vs mobile). `Opus`,
  Speculative - feasibility assessment first.

### G. Map overhaul (import from EU-Meshcore-Analyzer)
- **[13] Map overhaul** - responsive mobile/tablet layout + map controls (node
  resizing, 2D/3D, buildings), additional layers/tools (live, links,
  triangulation), raster→vector (maplibre) evaluation, dark/light theme CSS
  alignment for on-map panels/modals, and a node-type legend. Phased:
  quick-wins (theme CSS + legend + responsive) before the engine migration.
  `Opus`.

### H. Persistence
- **[14] Historical device-info persistence** - use the DB to retain device
  identity/config/telemetry history over time, building on the shipped
  signal-storage foundation and telemetry history. `Sonnet`.
- **[18] Multi-radio identity and historical continuity**: persist a registry of
  feeding radios, scope self-stat series (battery/noise) per radio, prompt on a
  new/replacement radio at connect, and add a general transactional cross-key
  contact merge (identity continuity for both self and contacts). `Opus`.
- **[19] Analyzer-grade persistence and retention**: a configurable per-data-class
  retention policy in `app_settings` with an "analyzer mode" preset; drives and
  consumes [14]. `Sonnet`.

### I. Sidebar / layout
- **[17] Sidebar customisation**: port the old fork's five sidebar customisations
  (DnD section/tool reorder, gear settings panel + reset, rail collapse, two-level
  collapse + favourites-by-type, and the "Owned" grouping), respecting the current
  768px responsive model and enforced i18n. "Owned" is gated on a backend
  `owner_id` + sensor-type dependency. `Sonnet` (Phase 3 backend: `Opus`).

## Delivery status (reconciled 2026-09-11)

The `State` column below is the *planning* state at authoring time (greenfield /
partial / blocked / speculative). This section is the separate *delivery* status,
reconciled against `origin/main` on 2026-09-11 (migrations reached
`_075_create_link_signal.py`; evidence is in each plan's header and internal
"Implementation status" note).

| # | Plan | Delivery | Evidence / remaining gap |
|---|---|---|---|
| 03 | split-favorites | SHIPPED | PR #21; `CommandPalette.tsx:318`. |
| 04 | analyzer-lookup | SHIPPED (core) | PRs #23/#26/#27, migration `_072`. Step 4 → [16]; Step 5 affordance open. |
| 05 | region-scope-sync | SHIPPED | PRs #28/#45/#48, migration `_073`. |
| 06 | cad-dm-toggle | NOT STARTED | CAD infra global+shipped, but header still gated to `channel` (`ChatHeader.tsx:561`). Deliverable (DM/room-server surfacing) unbuilt. |
| 07 | path-hash-message-filter | PARTIAL | Raw-feed filter shipped (PR #22). Chat message-list toggle confirmed wanted (1b spam mitigation), not yet built. |
| 08 | channel-preset-upload | NOT STARTED | Greenfield. |
| 09 | channelfinder-wordlist-sync | SHIPPED | PR #30, migration `_074`. |
| 10 | dmc-firmware-aware-mgmt | NOT STARTED | Greenfield (Opus theme). |
| 11 | dmc-mqtt-ingest-noc | NOT STARTED | Only outbound fanout exists; no inbound/NOC. |
| 12 | wardrive-gps-fanout | NOT STARTED | Speculative; feasibility gate unresolved in code. |
| 13 | map-overhaul | PARTIAL | Phase-1 quick-wins shipped (PR #40). Engine migration + 3D/node-size + per-link tool unbuilt. |
| 14 | historical-device-info | NOT STARTED | No `contact_location_history` / `device_config_history` tables yet. |
| 15 | registry-to-radio-import | NOT STARTED | Greenfield. |
| 16 | analyzer-name-resolution | NOT STARTED | Greenfield (absorbs [04] Step 4). |
| 17 | sidebar-customisation | NOT STARTED | Planning (2026-09-11). Frontend port + gated backend "Owned". |
| 18 | multi-radio-identity-history | NOT STARTED | Planning (2026-09-11). Self registry + per-radio stats + cross-key merge. |
| 19 | analyzer-persistence-retention | NOT STARTED | Planning (2026-09-11). Retention policy; drives [14]. |

Parity items (from `docs/parity-audit.md`): **SHIPPED** N1, N2, X1, X2a, X2b;
**PARTIAL** L1 (pills+sync shipped; DMC config-topic scope tree unbuilt), L2
(noise-floor viewer shipped; rx-error / Direct-Flood graphs UNVERIFIED/absent),
L4 (channel mute shipped; inline contact-sharing #347 unbuilt); **NOT STARTED**
L3 (neighbors/config publish; now unblocked since X1+X2 done). Fork-port Phase 3
(My Node, Mesh Health, packet-feed history) all **SHIPPED**.

## Plan index (dispatch table)

| # | Plan file | Category | Model | State | Primary references |
|---|---|---|---|---|---|
| 03 | `03-split-favorites.md` | B | Sonnet | Partial | old fork `Remote-Terminal-for-MeshCore`; `_055`, `repository/contacts.py`, `settings.py` |
| 04 | `04-analyzer-lookup.md` | C | Sonnet | Absent | `cornmeister-mesh-analyzer`, `EU-Meshcore-Analyzer`; settings, ContactInfoPane, packet feed |
| 05 | `05-region-scope-sync.md` | D | Sonnet | Partial | `Dutch-Meshcore-Toolbox`; Channel Registry impl, `known_regions`, `/api/radio/discover-regions` |
| 06 | `06-cad-dm-toggle.md` | B | Sonnet | Absent | `Elektr0Vodka/meshcomod` fw; `/api/radio/config`, ChatHeader; `feat/cad-header-toggle` (empty) |
| 07 | `07-path-hash-message-filter.md` | B | Sonnet | Done | chat message-list hop-size + hide-unscoped filters (`feat/chat-hop-size-filter`); raw-feed filter shipped (PR #22) |
| 08 | `08-channel-preset-upload.md` | E | Sonnet | Absent | Channel Import/Export; `set_channel`, `/api/radio/disconnect`, presets |
| 09 | `09-channelfinder-wordlist-sync.md` | D | Sonnet | Partial | `mccl`, `EV_Channelfinder`, `MC-Channel-Finder`; CrackerPanel, registry sync pattern |
| 10 | `10-dmc-firmware-aware-mgmt.md` | F | Opus | Absent | DMC `MeshCore` (`dmc-dev`, `dmc-observer-dev-1171-regiongating`), `DutchMeshCore-OTA`, `flasher.dutchmeshcore.nl`; RepeaterDashboard, repeater CLI endpoints |
| 11 | `11-dmc-mqtt-ingest-noc.md` | F | Opus | Absent | DMC MQTT fw, `MeshCore-MQTT`, `DutchMeshCore.nl-MQTT`; fanout bus, new inbound path |
| 12 | `12-wardrive-gps-fanout.md` | F | Opus | Speculative | `collector-wardrive`, `meshcore_mqtt_triangulator`, `meshcomod` GPS; fanout MQTT |
| 13 | `13-map-overhaul.md` | G | Opus | Partial | `EU-Meshcore-Analyzer`, `DutchMeshCore-Observers`; MapView.tsx, maplibre (note: local `Meshcore-Analyzer` is an MQTT broker, not a map client) |
| 14 | `14-historical-device-info.md` | H | Sonnet | Partial | signal-storage foundation (shipped), telemetry history; `database.py`, contacts repo |
| 15 | `15-registry-to-radio-import.md` | D/E | Sonnet | Absent | Channel Registry (`ChannelRegistryView.tsx`, `channelManager.ts`, `/api/registry/sync`), Channel Import/Export (`ChannelImportExportModal.tsx`); `set_channel` |
| 16 | `16-analyzer-name-resolution.md` | C | Sonnet | Partial | analyzer resolution APIs (`cornmeister /api/nodes/{id}/detail`, EU `cmd/api-map` `/api/resolve-hops`); visualizer `packetNetworkGraph.ts`, `VisualizerTooltip.tsx`, `PathModal.tsx`; reuses [04] config |
| 17 | `17-sidebar-customisation.md` | I | Sonnet (Opus for backend) | Partial | old fork `Remote-Terminal-for-MeshCore` `Sidebar.tsx`; current `Sidebar.tsx`, `AppShell.tsx`, `conversationState.ts`; localStorage precedent `_051` |
| 18 | `18-multi-radio-identity-history.md` | H | Opus | Absent/Partial | `radio_lifecycle.py`, `keystore.py`, `radio_stats.py`; `contacts.py` upsert/promote, `contact_reconciliation.py`; `battery_history`/`noise_floor_samples` (`_069`/`_070`), `link_signal` (`_075`) |
| 19 | `19-analyzer-persistence-retention.md` | H | Sonnet | Partial | `app_settings` (`_009`), `settings.py`; telemetry/link/self-stat repos + retention constants; `POST /api/packets/maintenance`; drives [14] |

## Post-research findings (these changed the initial assumptions)

Each finding is cited in full in its plan file. Read these before scheduling work.

- **[06] CAD already exists.** CAD is implemented end-to-end as a global radio
  setting (backend `app/services/meshcomod.py`, `GET/PATCH /api/radio/meshcomod`,
  `useMeshcomodConfig.ts`, a ChatHeader toggle). The real gap is one condition: the
  header toggle is gated to `conversation.type === 'channel'`, so it never renders
  for DMs. Host control of CAD needs firmware from an unmerged meshcomod branch
  (`Feat/companion-cad-toggle`); stock firmware hardcodes CAD on and the runtime
  `cad_supported` probe hides the control. CAD is architecturally global, not
  per-message, so "toggle for DMs" means surfacing the existing global toggle in
  the DM header. Effort: Phase 1 is ~1 line.
- **[11] DMC-MQTT firmware is publish-only.** The MQTT bridge registers no
  subscribe/`MQTT_EVENT_DATA` handler and has no command topic. Remote management
  over MQTT is therefore impossible; management must use RTFM-EV's existing RF /
  serial CLI (`set mqttN.*`), which only works for nodes that are also RF contacts
  (gated on [10]). Ingestion and the NOC page are still fully viable.
- **[12] wardrive is FEASIBLE with one condition, and does not depend on [11].**
  The packet-observation half of a wardrive record already ships
  (`app/fanout/community_mqtt.py`). The only missing primitive is a
  browser-to-backend live-position channel; the operator's browser geolocation (the
  literal "phone GPS") is already used in the map/settings UI. The home-IP/device
  identity problem is NOT cleanly auto-solvable (single env-chosen radio, no
  client-IP tracking, VPN presents a stable LAN IP); resolve it with an explicit
  wardrive toggle + position provenance, not mobility inference.
- **[13] map: quick-wins ship on Leaflet; 2D/3D needs a rewrite.** Phase-1 theme
  CSS + node-type legend + responsive/node-size controls work on the current Leaflet
  stack with no new deps. 2D/3D tilt and 3D buildings are impossible on Leaflet and
  require a MapLibre-GL-native `MapView.tsx` rewrite (bundle-size and mobile-WebGL
  costs marked to-measure). There is no `/api/links` endpoint, so a per-link tool
  must derive edges from `packetNetworkGraph.ts` or `contact_advert_paths`.
- **[10] firmware detection is best-effort.** Classification reads the existing
  `ver` reply, but the DMC/observer branding tag is injected only by `build.sh` /
  CI builds; a plain `pio` dev build has no tag and misclassifies as stock. Hence
  the manual device-type override is load-bearing, not optional. `filter` verb =
  both DMC branches; `dc.gate*` + MQTT/wifi/webconfig/OTA verbs = observer-only.
  Webconfig is an unauthenticated `GET http://<ip>/api/status` on port 80 but is not
  always-on and has no mDNS. OTA is a pull model triggered by an admin-gated RF/CLI
  command; no manifest signing.
- **[05] the DMC toolbox has no flat region list.** Its channel-browser proxies a
  third-party feed (`meshcore-analyzer.eu`) whose records carry per-channel
  `scopes[]`; the sync endpoint must flatten/dedupe that. Which URL to sync from is
  a decision for the user, not an assumption.
- **[16] name resolution splits by identifier.** Resolving a node that RTFM-EV
  knows by full pubkey but has not named is feasible and low-risk (cornmeister
  `GET /api/nodes/{id}/detail`). Resolving a bare 1/2/3-byte hop is only a
  probabilistic, explicitly-ambiguous suggestion, never a confident name: hop ids
  are truncated pubkey bytes (`app/decoder.py:517`), so it is a prefix-collision
  problem (a 1-byte hop resolves uniquely ~0.01% of the time at scale, per the EU
  analyzer's own code). Both cornmeister and the EU analyzer's `cmd/api-map` already
  expose reverse hop-prefix lookup (batch `GET /api/resolve-hops`); mc-radar has no
  JSON API (deep-link only). Ship case (a) first; case (b) is a phase-2 product
  decision. RTFM-EV's current hop resolution is frontend-only and local-contacts
  only, so unresolved ids render as bare hex in the visualizer tooltip and PathModal.
- **[03] the old fork never split the favorite flag.** Its "separation" was purely a
  sidebar UI grouping (collapsible sub-headers). RTFM-EV already has partial parity;
  the concrete verified gap is that `CommandPalette.tsx` omits room-servers from its
  favorite grouping. No migration needed.
- **Migration numbering (moving target):** next free is **`_076`** as of
  2026-09-11 (origin/main reached `_075_create_link_signal.py`). The number kept
  drifting while these plans sat unbuilt: `_069` at authoring, `_072` by
  2026-09-10, `_075` by 2026-09-11 (via the analyzer-sites, region-sync-url,
  wordlist-sync-url, and link-signal merges - plans [04]/[05]/[09] and parity
  X2b). Any remaining unbuilt plan that cites `_069`/`_072` is stale. The number
  is not authoritative in any plan; parallel branches race for it, so re-verify
  `git ls-tree origin/main app/migrations` at build time (a prior collision is
  recorded in the fork-port plan). Plans [09] and [15] need no migration (reuse
  `app_settings` / existing storage).

## Resolved decisions (2026-09-10, user)

These answer the open questions the plans surfaced. Each plan file carries the same
decision inline.

- **[05]** Sync regions from the analyzer's dedicated regions endpoint (not by
  flattening channel `scopes[]`). Endpoint confirmed in plan 05.
- **[06]** Also expose the CAD toggle for room-server contacts, gated on the runtime
  `cad_supported` probe.
- **[07]** Build the path-hash filter on both surfaces (raw-packet feed and chat
  message list) as two independent toggles.
- **[08]** Applying a channel preset to the radio is additive (never clears slots).
- **[09]** Feed the `mccl` list as names only into the cracker wordlist; keys are
  auto-derived (`SHA256("#name")[:16]`), so it is not a second key source.

## Dependency graph (sequencing)

```
signal-storage foundation (SHIPPED PR#12)
        └── [14] historical-device-info ──┐
                                          ├── informs telemetry panels in [11] NOC
Channel Registry sync (SHIPPED PR#14)     │
        ├── [05] region-scope-sync        │  (shared sync pattern/template)
        └── [09] channelfinder-wordlist    │
DMC firmware detection [10] ──────────────┴── gates option visibility in [11] NOC
                          └── OTA + webconfig sub-phases
[11] DMC MQTT ingestion  ──── shares broker/config plumbing with parity X1 (MQTT export)
[12] wardrive-gps-fanout ──── does NOT depend on [11] (correction from research);
                              outbound MQTT plumbing already exists, only broker config is shared
[13] map-overhaul: quick-wins (theme CSS, legend, responsive) independent;
                   vector/3D engine migration is standalone and larger
[03][04][06][07][08] independent, parallelizable
[18] multi-radio-identity: new radio_identities registry; scopes self-stats per radio;
                           general cross-key merge must re-key [14] location history
[19] analyzer-persistence: retention policy over existing prune points; drives/consumes
                           [14] (its Phase 2 == [14] build); consumes [18] radio_identity id
[17] sidebar-customisation: frontend-only Phases 1-2; Phase 3 "Owned" gated on backend owner_id
```

Recommended local build order once plans are approved:
1. Independent UX wins: [03], [07], [06], [04] (low risk, high visible value).
2. Sync extensions: [05], [09] (reuse Channel Registry plumbing).
3. Persistence: [14] (unblocks richer panels).
4. Provisioning: [08].
5. Firmware theme: [10] → [11] → [12] (each gates the next).
6. Map: [13] quick-wins early (can slot in with the UX wins), engine migration last.

## Reconciliation with parity-audit and fork-port-plan

- [14] historical-device-info consumes N1 (shipped) and overlaps the fork-port
  "My Node / MeshHealth" Phase 3 items - the plan must explicitly de-conflict.
- [11] DMC MQTT ingestion is the **inbound** complement to parity **X1** (MQTT
  export, outbound). They share broker config; the plan must reuse `fanout_configs`
  plumbing rather than inventing a parallel config store.
- [05] region-scope-sync extends parity **L1** (region/scope surfacing) with a sync
  source, and reuses the shipped Channel Registry mechanism.
- [12] wardrive-gps reclassifies the parity "phone GPS sharing = N/A" entry (already
  partially reclassified by the shipped copy-location-to-chat feature).
- [10] firmware-aware management is new relative to both artifacts; it is the
  concrete form of the Dutch contributor's "adjust Repeater Manager options by
  reported firmware" and "My Mesh NOC" suggestions.

## Em-dash status (A0)

`git grep -I -c $'-'` and `$'-'` over tracked files on
`claude/meshtastic-planning-features-fe98f7`: **0 occurrences**. No sweep needed on
this branch. Follow-ups (not yet done): (1) verify unmerged feature branches,
(2) add a repo guard so em-dashes cannot be reintroduced. The repo already blocks
commit-attribution markers via a `PreToolUse` hook in `.claude/settings.json`; an
em-dash guard would follow the same pattern.
