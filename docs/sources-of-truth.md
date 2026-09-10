# Sources of Truth

Date: 2026-09-10

Canonical upstreams for the firmware and tooling RTFM-EV interoperates with. When
a plan or feature depends on a wire format, CLI verb, MQTT payload shape, or URL
scheme, verify it against the repo listed here (code is truth), not against
secondhand summaries.

All GitHub URLs below were verified from the `origin`/`upstream` remotes of local
checkouts on 2026-09-10. Local paths are the machine this was authored on and may
differ elsewhere.

## Firmware

### Official MeshCore
- Repo: https://github.com/meshcore-dev/MeshCore
- Role: canonical firmware, protocol, and companion `CMD_*` API. Upstream of both
  DMC and meshcomod below.
- Local: `G:\Github\repositories\Meshcore` (no git remote configured locally).

### DMC-MeshCore (two flavours — this distinction matters for the Repeater Manager)
- Repo: https://github.com/Dutch-MeshCore/MeshCore (upstream: `meshcore-dev/MeshCore`).
- Local: `G:\Github\repositories\Dutch-MeshCore\MeshCore`.
- **DMC Repeater** — branch `dmc-dev`. Stock repeater firmware plus DMC
  configuration and packet-filter management exposed over **Serial / RF CLI**. No
  on-device MQTT. Target for remote repeater-management panel extensions.
- **DMC-MQTT-Repeater / Observer** — branch `dmc-observer-dev-1171-regiongating`
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
- Cornmeister / Argus analyzer (node/packet lookup reference; Go): https://github.com/Elektr0Vodka/Argus-mesh-analyzer
  (local `G:\Github\repositories\Elektr0Vodka\cornmeister-mesh-analyzer`).
  Public site: https://cornmeister.nl (node URL scheme `#node?id=<64-hex>`).
- mc-radar analyzer: https://mc-radar.woodwar.com (node URL scheme `/node/<64-hex>`).
- collector-wardrive (wardrive ingest reference): local
  `G:\Github\repositories\Dutch-MeshCore\collector-wardrive`.

## Maintenance
Keep this file current when a firmware branch is renamed or a tooling repo moves.
It is linked from `AGENTS.md`. If a URL here cannot be confirmed, mark it
`[unverified]` rather than deleting it.
