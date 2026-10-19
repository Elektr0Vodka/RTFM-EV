# Sources of Truth

Date: 2026-09-10 (updated 2026-09-22: OpenHop, EU analyzer API endpoints; 2026-09-25: analyzer name resolution, channel naming; 2026-10-15: MeshCore 1.18)

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
- 1.18 (2026-10-15, release notes https://blog.meshcore.io/2026/10/15/release-1-18-0):
  companion `FIRMWARE_VER_CODE` 14; `CMD_RUN_CLI_COMMAND` 66 answered by
  `RESP_CODE_CLI_REPLY` 29 (`examples/companion_radio/MyMesh.cpp` `handleCommand`,
  `src/helpers/CommonRadioPrefs.cpp`); `TXT_TYPE_CLI_COMMAND` 3 for commands to another
  companion, run only for a contact with flags bit 0x10 (`ContactInfo::isRemoteCLIAllowed`);
  sensor `REQ_TYPE_SUBSCRIBE` 0x08 / `REQ_TYPE_UNSUBSCRIBE` 0x09 with pushes as
  `PUSH_CODE_BINARY_RESPONSE` (`examples/simple_sensor/SensorMesh.cpp`; thresholds use
  `LPPData::getDataSize`/`getMultiplier` in `src/helpers/sensors/LPPDataHelpers.h`);
  transport code 0 is the wildcard region (`RegionMap::findMatch`). meshcore_py 2.3.16 has
  `run_cli_command` but its `BinaryReqType` stops at 0x06.

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
- Version: reports `FIRMWARE_VER_CODE` 27 on every release, so the version string
  decides features; `v1.18.0.1` (MeshCore 1.18 merge) has the companion command line.
- Companion receive filter (`filter` CLI): `examples/companion_radio/CompanionFilter.{h,cpp}`
  and `filter/FilterStats.h` are the reply formats `app/services/companion_filter.py`
  parses; `docs/companion_receive_filter.md` is the user documentation.
- Meshcomod command contact: `examples/companion_radio/MyMesh.cpp`
  (`MESHCOMOD_PUB_KEY_PREFIX` "MESHCM", `getMeshcomodContact`, the
  `CMD_SEND_TXT_MSG` local branch with its immediate `PUSH_CODE_SEND_CONFIRMED`,
  `pushMeshcomodReply`, `handleMeshcomodCommand` and `kMeshcomodHelpMsg`) is what
  `app/meshcomod_contact.py` and `frontend/src/utils/meshcomodContact.ts` follow.
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
  and `src/helpers/RoutingPolicy.h`, the packet filter from DMC `dmc-observer-dev`
  (`923fc428`, 2026-09-30) `examples/simple_repeater/Filter.{h,cpp}`, `Limiter.h`,
  `AdvertLimiter.h`, `PathBlock.h`, `SenderRules.h`, `MessageAge.h` and
  `docs/packet_filter_reference.md`; the MQTT `filter` topic from
  `src/helpers/MQTTFilterStatsJson.h`, the `config` extras from
  `src/helpers/MQTTMessageBuilder.cpp` `buildConfigMessage`, and the neighbours table,
  poll and `neighbors` topic from `examples/simple_repeater/MyMesh.cpp`
  (`putNeighbour`, `onAdvertRecv`, `sendNodeDiscoverReq`, `startNeighborDiscover`,
  `sendAnonRegionsReq`, `finishNeighborDiscover`) and `src/helpers/MQTTPayloadBuilder.cpp`
  `buildNeighborsMessage`. The EU sub-band table
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
  Its USB config page is also the source of truth for the **device config file
  format** that the fleet config library stores and exports
  (`src/hooks/useSerialDevice.ts` `exportConfig` / `importFromJson`, section
  shapes in `src/lib/config/*.ts`; read at commit `b36c356`). The repo has no
  licence file: match the file format, take no code from it. When the toolbox
  adds a key that holds a secret, add it to `_SECRET_PATHS` in
  `app/services/fleet_config.py`.
  Reading a device over a USB cable (plan 32 Phase 3,
  `app/services/fleet_device_cli.py`) writes that same file, so the toolbox's
  list of variables (`DeviceVars`, `VAR_MIN_VERSION` in `src/types.ts`) and
  section shapes are the source for `VAR_KEYS` and the section readers there.
  The **commands and reply formats** of the text command line are taken from
  the firmware source, not from the toolbox: stock
  `src/helpers/CommonCLI.cpp` and `examples/simple_repeater/main.cpp`
  (meshcore-dev), DMC `examples/simple_repeater/Filter.cpp` and
  `src/helpers/CommonCLI_Observer.cpp` (branch `dmc-observer-dev`, read at
  `923fc428`). When the firmware changes a reply, the parser or a read-back
  check there changes with it.
- MCCL (MeshCore channel lists / wordlist source): https://github.com/Elektr0Vodka/MCCL
  (local `G:\Github\repositories\Elektr0Vodka\mccl`). The channel finder's bundled
  "Known channels (MCCL)" list, `frontend/public/wordlists/known-channels.txt`, is
  a snapshot of `list_nl/channel-rainbow.json`. Rebuild it with
  `python scripts/build_mccl_wordlist.py <channel-rainbow.json> frontend/public/wordlists/known-channels.txt`.
- EU MeshCore Analyzer (map / mobile layout reference): https://github.com/EU-Meshcore-Analyzer/EU-Meshcore-Analyzer
  (local `G:\Github\repositories\Elektr0Vodka\EU-Meshcore-Analyzer`).
  Its public API is also a runtime data source: `https://meshcore-analyzer.eu/api/nodes`
  is the default `external_map_sync_url` (external node overlay on the map when
  `external_map_source` is `analyzer`, and the candidate source for partial-node
  resolution; `app/services/external_map.py`), and
  `https://meshcore-analyzer.eu/api/regions/scopes` is the example
  `region_sync_url` (default empty; `app/routers/regions.py`).
  On request only (contact pane, "Check with analyzer"), `GET /api/nodes/{pubkey}/reach`
  and `POST /api/paths/inspect` on the host of `external_map_sync_url` validate
  suggested DM routes (`app/services/analyzer_path_check.py`).
- MeshCore map: https://map.meshcore.io. Runtime data source for the external node
  overlay ("Analyzer nodes") when `external_map_source` is `meshcore_map`, the default
  since migration `_155`: `GET https://map.meshcore.io/api/v1/nodes`, a bare JSON array
  of every node uploaded to the map (`public_key`, `type`, `adv_name`, `adv_lat`,
  `adv_lon`, `updated_date` = last seen, ...; ~67k nodes / ~50 MB uncompressed, ~17 MB gzip on
  2026-10-19). Fetched server-side by `app/services/external_map.py`.
- Dutch Antenneregister (Antennebureau, part of the RDI): https://antenneregister.nl.
  Runtime data source for the map's antenna layer: the public WFS
  `https://antenneregister.nl/mapserver/wfs/` (feature types `Antennes` and
  `Antennes_Groepen`, EPSG:28992 only; capabilities state `Fees: none`,
  `AccessConstraints: none`). Fetched only on a manual sync
  (`app/services/antenna_register.py`). Its viewer's own JS shows the field
  meanings (power is labelled "Vermogen (dBW)"). RD New to WGS84 is
  `app/rd_new.py`, checked against PDOK locatieserver `centroide_rd` /
  `centroide_ll` pairs.
- Cornmeister / Argus analyzer (node/packet lookup reference; Go): https://github.com/Elektr0Vodka/Argus-mesh-analyzer
  (local `G:\Github\repositories\Elektr0Vodka\cornmeister-mesh-analyzer`).
  Public site: https://cornmeister.nl (node URL scheme `#node?id=<64-hex>`).
  Runtime use: `https://cornmeister.nl/api/nodes/{pubkey}/detail` is the preset
  `node_api_url_template` for opt-in name resolution of unnamed full-key contacts
  (`app/services/analyzer_resolution.py`, plan [16] case (a), PR #226). The
  meshcore-analyzer.eu software behind cornmeister.nl, meshcore-analyzer.eu,
  analyzer.meshcorenetz.de and analyzer.meshdresden.eu names the default Public
  channel `public` in `/api/channels`; channel links use that (PR #231), while
  on8ar's CoreScope keeps `Public`.
- mc-radar analyzer: https://mc-radar.woodwar.com (node URL scheme `/node/<64-hex>`;
  packet URL scheme `/packet/<16-hex>`, where the 16 hex are the firmware packet
  hash in lower case, the same value `POST /api/packets/who-heard` returns as
  `packet_hash`).
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
- MeshCore TEAM wire formats (`#TEL:`, `#T:`, `#WAY:`, `#WRC:`, `#CAP:`):
  https://github.com/tmacinc/MeshCore-TEAM (`dev` branch), `lib/models/`
  `telemetry_message.dart`, `topology_message.dart`,
  `waypoint_mesh_message.dart`, `route_payload.dart`, `capability_message.dart`,
  `network_topology.dart` (bitmap bit order) and `waypoint.dart` (waypoint
  types). signalk-meshcore's independent `#TEL:` codec: `index.js`
  `decodeTEL` / `encodeTEL` in https://github.com/Banzarykey/signalk-meshcore.
  Ported in `app/team_payloads.py` and `frontend/src/utils/teamPayloads.ts`.
  RTFM-EV sends only `#TEL:` (`encode_telemetry` for the periodic beacon and
  its frontend mirror `buildTeamTelemetryPayload` for the manual one, TEAM's
  form) and single `#WAY:` waypoints (`buildTeamWaypointPayload`); the vessel types are
  RTFM-EV's own list, not part of either format. No real traffic sample was available
  when this was written; the fixtures are built from those encoders.
- Community key derivation and QR JSON: meshcore-open `lib/models/community.dart`
  (channel names in `lib/screens/channels_screen.dart` and
  `community_qr_scanner_screen.dart`), ported in `app/communities.py`. meshcore-open
  ships no community test vectors; `tests/test_communities.py` computes them
  independently.

## Maintenance
Keep this file current when a firmware branch is renamed or a tooling repo moves.
It is linked from `AGENTS.md`. If a URL here cannot be confirmed, mark it
`[unverified]` rather than deleting it.
