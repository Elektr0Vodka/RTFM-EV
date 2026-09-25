# Sources of Truth

Date: 2026-09-10 (updated 2026-09-22: OpenHop, EU analyzer API endpoints)

Canonical upstreams for the firmware and tooling RTFM-EV interoperates with. When
a plan or feature depends on a wire format, CLI verb, MQTT payload shape, or URL
scheme, verify it against the repo listed here (code is truth), not against
secondhand summaries.

All GitHub URLs below were verified from the `origin`/`upstream` remotes of local
checkouts on 2026-09-10 (the OpenHop entries on 2026-09-22). Local paths are the
machine this was authored on and may differ elsewhere.

## Firmware

### Official MeshCore
- Repo: https://github.com/meshcore-dev/MeshCore
- Role: canonical firmware, protocol, and companion `CMD_*` API. Upstream of both
  DMC and meshcomod below.
- Local: `G:\Github\repositories\Meshcore` (no git remote configured locally).

### DMC-MeshCore (two flavours - this distinction matters for the Repeater Manager)
- Repo: https://github.com/Dutch-MeshCore/MeshCore (upstream: `meshcore-dev/MeshCore`).
- Local: `G:\Github\repositories\Dutch-MeshCore\MeshCore`.
- **DMC Repeater** - branch `dmc-dev`. Stock repeater firmware plus DMC
  configuration and packet-filter management exposed over **Serial / RF CLI**. No
  on-device MQTT. Target for remote repeater-management panel extensions.
- **DMC-MQTT-Repeater / Observer** - branch `dmc-observer-dev-1171-regiongating`
  (region-gating work; supersedes `dmc-observer-dev`, `dmc-observer-dev-1-17*`).
  Everything in DMC Repeater plus **on-device MQTT** (`WITH_MQTT_BRIDGE`), webconfig,
  and wifi. Six MQTT topic types: `status`(0) / `packets`(1) / `raw`(2) /
  `neighbors`(3) / `filter`(4) / `config`(5). Payload builders:
  `src/helpers/MQTTPayloadBuilder.cpp`, `src/helpers/MQTTMessageBuilder.cpp`.
  Topic layout `meshcore/{iata}/{device}/{type}`.
- Note: MQTT is **repeater/room-server only**; the companion firmware has no MQTT.
  RTFM-EV bridges companion data host-side (see `docs/parity-audit.md` §6).

### meshcomod (a.k.a. the "meshcomod-EV fork")
- Repo: https://github.com/Elektr0Vodka/meshcomod (upstream:
  https://github.com/ALLFATHER-BV/meshcomod).
- Local: `G:\Github\repositories\Elektr0Vodka\meshcomod`.
- Role: multi-transport **companion** firmware (USB + BLE + TCP simultaneously) for
  Heltec / Seeed. Source of CAD and phone-GPS support that RTFM-EV features build on.
- Related: standalone touch UI moved to https://github.com/ALLFATHER-BV/wadamesh.

### OpenHop
- Repos: https://github.com/openhop-dev/openhop_repeater (daemon) on
  https://github.com/openhop-dev/openhop_core.
- Local: `G:\Github\repositories\openhop-dev\openhop_repeater`,
  `G:\Github\repositories\openhop-dev\openhop_core`.
- Role: MeshCore-compatible repeater / room-server daemon (Python). Speaks the
  companion protocol over TCP, so RTFM-EV can use it as the radio; detected by
  device model prefix (`app/services/openhop.py`). Its REST API
  (`repeater/web/api_endpoints.py`) backs the OpenHop management panes
  (`app/services/openhop_api.py`) and the My Node TX/RX airtime chart via
  `/api/airtime_chart_data`, because OpenHop's companion stats frame reports RX
  airtime as 0.
- Host repeater (plan 29): `repeater/engine.py` (gate order, delay formula and 5 s cap,
  seen table), `repeater/airtime.py` (60 s duty-cycle window, `max_airtime_per_minute`
  3600 ms) and `repeater/policy_engine.py` (rule format and operators) are the model
  for `app/services/host_repeater_*.py`. Forwarding rules themselves come from
  MeshCore `src/Mesh.cpp`, repeater gates from `examples/simple_repeater/MyMesh.cpp`
  and `src/helpers/RoutingPolicy.h`, the packet filter from DMC `dmc-dev`
  `examples/simple_repeater/Filter.{h,cpp}` / `Limiter.h`, and the EU sub-band table
  from DMC `src/helpers/DutyCycleLimits.cpp`. The region map and duty-cycle region
  gating follow DMC `dmc-dev` `src/helpers/RegionMap.{h,cpp}` (`findMatch`,
  `depthOf`, `getMaxGateLevel`, `applyDutyGate`), `examples/simple_repeater/MyMesh.cpp`
  (`onRecvPacket`, the `dc.gate` loop) and `src/Dispatcher.cpp`
  `getTxDutyCyclePercent` (budget in use). `dmc-observer-dev` measures wall-clock TX
  duty instead (`TxDutyWindow.h`); the budget meaning was confirmed by the DMC
  developer and is the one used here.
- Host repeater rule extensions (regex `matches`, per-rule `prob` / `throttle`,
  channel-name / region / path-position fields, per-rule hits and saved airtime)
  follow the jhuebert/MeshCore repeater packet filter: https://github.com/jhuebert/MeshCore
  branch `repeater-filter`, `FILTER.md` (user guide, read 2026-09-25) and
  `examples/simple_repeater/PacketFilter.{h,cpp}`, `RateLimiter.h`, `TinyRegex.{h,cpp}`.
  Semantics kept: first match wins, a rule that steps aside (failed roll, within
  budget) lets later rules decide, `prob` is deterministic per packet, throttle
  state is RAM-only, `hits` counts decisions and `pass` the within-budget slips,
  saved airtime is billed for rule and rate-limiter drops only. Deliberate
  differences: Python `re` instead of TinyRegex, a keyed throttle budget
  (per sender / channel / first hop) the firmware does not have, 100 rules.

### DMC OTA
- Repo: https://github.com/Dutch-MeshCore/DutchMeshCore-OTA
- Local: `G:\Github\repositories\Dutch-MeshCore\DutchMeshCore-OTA`.
- Role: over-the-air update service/manifests for DMC firmware; reference for the
  OTA check/update sub-phase of firmware-aware management.
- Flasher web tool: https://flasher.dutchmeshcore.nl
  (local: `G:\Github\repositories\Elektr0Vodka\flasher.dutchmeshcore.nl`).

## Application / this project
- RTFM-EV: https://github.com/Elektr0Vodka/RTFM-EV (this repo; push to the fork
  `origin`, never upstream).
- Old fork being ported from: https://github.com/Elektr0Vodka/Remote-Terminal-for-MeshCore-EV
  (3.14.0+EV; local `G:\Github\repositories\Elektr0Vodka\Remote-Terminal-for-MeshCore`).

## Tooling & data sources
- DMC Toolbox (channel browser, region/scope data): https://toolbox.dutchmeshcore.nl
  (repo https://github.com/Dutch-MeshCore/Dutch-Meshcore-Toolbox;
  local `G:\Github\repositories\Dutch-MeshCore\Dutch-Meshcore-Toolbox`).
- MCCL (MeshCore channel lists / wordlist source): https://github.com/Elektr0Vodka/MCCL
  (local `G:\Github\repositories\Elektr0Vodka\mccl`).
- EU MeshCore Analyzer (map / mobile layout reference): https://github.com/EU-Meshcore-Analyzer/EU-Meshcore-Analyzer
  (local `G:\Github\repositories\Elektr0Vodka\EU-Meshcore-Analyzer`).
  Its public API is also a runtime data source: `https://meshcore-analyzer.eu/api/nodes`
  is the default `external_map_sync_url` (external node overlay on the map, and the
  candidate source for partial-node resolution; `app/services/external_map.py`), and
  `https://meshcore-analyzer.eu/api/regions/scopes` is the example
  `region_sync_url` (default empty; `app/routers/regions.py`).
- Cornmeister / Argus analyzer (node/packet lookup reference; Go): https://github.com/Elektr0Vodka/Argus-mesh-analyzer
  (local `G:\Github\repositories\Elektr0Vodka\cornmeister-mesh-analyzer`).
  Public site: https://cornmeister.nl (node URL scheme `#node?id=<64-hex>`).
- mc-radar analyzer: https://mc-radar.woodwar.com (node URL scheme `/node/<64-hex>`).
- collector-wardrive (wardrive ingest reference): local
  `G:\Github\repositories\Dutch-MeshCore\collector-wardrive`.
- MGRS conversion: the `mgrs` npm package (proj4js, MIT),
  https://github.com/proj4js/mgrs, v2.2.0. The frontend uses it directly;
  `app/mgrs.py` ports its inverse (`decode` + `UTMtoLL` + `toPoint`), and
  `tests/test_mgrs.py` holds vectors generated with that package. Keep both
  sides on the same version.
- Location-share wire format: meshcore-open `m:<lat>,<lon>|<label>|<flags>`
  (`lib/screens/map_screen.dart` `_formatMarkerMessage` / `parseMarkerText`,
  https://github.com/zjs81/meshcore-open).
- Community key derivation and QR JSON: meshcore-open `lib/models/community.dart`
  (channel names in `lib/screens/channels_screen.dart` and
  `community_qr_scanner_screen.dart`), ported in `app/communities.py`. meshcore-open
  ships no community test vectors; `tests/test_communities.py` computes them
  independently.

## Maintenance
Keep this file current when a firmware branch is renamed or a tooling repo moves.
It is linked from `AGENTS.md`. If a URL here cannot be confirmed, mark it
`[unverified]` rather than deleting it.
