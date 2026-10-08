# RTFM-EV

RTFM-EV is a web interface and FastAPI backend for [MeshCore](https://github.com/meshcore-dev/MeshCore) companion radios. A small server connects to one radio over Serial (USB), TCP or BLE, and you use it from any browser on your network: messaging, contact and repeater management, a live map, packet analysis and integrations such as MQTT and Home Assistant.

RTFM-EV is a fork of [RemoteTerm for MeshCore](https://github.com/jkingsman/Remote-Terminal-for-MeshCore) by Jack Kingsman. Upstream development is on hold; this fork ([Elektr0Vodka/RTFM-EV](https://github.com/Elektr0Vodka/RTFM-EV)) is the active repository. It keeps everything RemoteTerm does as a live terminal for a radio and treats the server database as the system of record, so a radio that stays connected builds a long-lived local history of the mesh that you can browse and analyze. On top of that the fork adds, among other things:

- support for the [meshcomod (DMC / DMC-EV)](https://github.com/Elektr0Vodka/meshcomod) companion firmware and management of [OpenHop](https://github.com/openhop-dev/openhop_repeater) nodes
- a MapLibre and deck.gl map with packet replay, link history and several overlays
- analysis views: My Node, Mesh Health, Mesh Trends, Packet History, Mesh Discovery, SNMP
- a host repeater that judges every received packet the way a repeater would (shadow mode, optional live forwarding)
- loadouts, a radio identity registry, database backup/restore and per-class data retention
- an interface in English, Dutch and German, extra themes and an in-app User Guide

See [CHANGELOG-DMC-EV.md](CHANGELOG-DMC-EV.md) for everything the fork has changed.

![Screenshot of the application's web interface](app_screenshot.png)

> [!WARNING]
> **Trusted networks only.** There are no user accounts: anyone who can reach the page can use the radio. Do not expose the app to an untrusted network or the public internet. See [Security](#security).

> [!NOTE]
> **The app manages your radio.** Once a radio is connected, its contacts and channels are imported into the app, and the app decides which contacts stay loaded on the radio. This makes it a poor fit if you swap radios in and out and want each radio to keep its own state. Only battery, noise floor and airtime history is kept per radio; contacts, channels, packets and messages are shared by every radio that feeds the install.

## Features

Per-screen detail is in the in-app **User Guide** (sidebar **Tools > User Guide**, or `#manual` in the app). Its English source is [frontend/src/content/manual/en.md](frontend/src/content/manual/en.md).

### Messaging

- Direct messages, private channels and hashtag channels, with reactions and replies in the plain-text format other MeshCore clients use.
- MeshCore TEAM and signalk-meshcore tracking messages (`#TEL:`, `#T:`, `#WAY:`, `#CAP:`) shown as cards with a map preview. TEAM waypoints can be shared from the location picker, a single `#TEL:` position beacon can be put in the composer from the Share location menu of a private channel (radio position, browser GPS or a point picked on the map), and an optional periodic `#TEL:` position beacon (off by default) can be switched on in Settings.
- Emoji picker with search, recent emoji, skin tones and per-emoji byte cost.
- Direct messages with no acknowledgement after all retries show **Failed**, with a **Retry** action.
- Mark a conversation unread from any message (stored server-side) and delete a message from your local history (nothing is sent over RF).
- SMAZ-compressed messages from other clients are shown decoded; meshcore-open image chunks show as an "Image (not supported)" placeholder.
- Share and import contacts as `meshcore://` links; inline `<pubkey:type:Name>` contact tags render as chips with **Add contact**.
- Join meshcore-open communities by code or QR code, and share them again as JSON or QR.
- Mention ticker, a mention and DM sound, browser and Web Push notifications, and optional notifications for newly heard nodes.
- Optional chat parsing: clickable links with previews, public key detection, and GPS or MGRS coordinates as map cards.
- Full-text message search with `user:` and `channel:` filters.

### Contacts and nodes

- Monitor more contacts and channels than the radio can hold: packets are stored and decrypted on the server, including older packets once you add a key.
- Per-contact radio residency (Auto, Pin, App only), notes, owner, manual location, battery chemistry and telemetry sharing permissions.
- Contact pages with position history, advert paths, previous names, nearest repeaters and scored message routes.
- Sidebar with favorites split by node type, your own contact groups, and an **Owned** section for nodes your radio owns.
- Repeater dashboard: login, status and settings panes, CLI console, telemetry history, config change history and a settings editor that confirms and reads back each change, including SNMP on/off on observer firmware.
- Room server dashboard with telemetry, ACL, sensor data, console and ACL change history.
- SNMP polling of observer firmware nodes over your LAN (repeaters and room servers): set an address per contact and read radio, MQTT, memory and WiFi values without using RF.
- Optional SNMP agent: let LibreNMS, Zabbix or another monitoring system poll this node with the same OIDs as the observer firmware (read-only, off by default).
- Scheduled telemetry tracking for repeaters and up to 8 other contacts.
- Routing override, Path Discovery and Direct Trace per contact.
- Suggested DM routes for companions, built from the paths they were heard on, with an optional analyzer check. Suggest only: you pick one to set it as the routing override.
- Name resolution for contacts known only by public key, from the synced analyzer map or opt-in analyzer lookups.
- Triangulate link-out to the DMC triangulator.

### Map

- MapLibre GL map with Nova dark, OpenFreeMap, OpenStreetMap, OpenTopoMap and Esri basemaps, 2D or 3D with buildings, labels and neon nodes.
- Filters by time range, node role, power source (contact override, else the power icon in the node name; DTIS nodes are solar + battery), heard-by-server and wrong-location nodes.
- Overlays: animated packets with replay and optional sound, links (liveness, advert paths or all traffic) with per-link traffic and signal history, telemetry, shared locations, MeshCore TEAM beacons (positions, trails, waypoints and routes), guessed locations and relay signal.
- GPX export of the nodes currently shown, a configurable start view, and a server-side tile cache for offline use (off by default).

### Tools and diagnostics

- **My Node:** radio charts including airtime utilization, receive errors, RSSI/SNR with noise floor and a directly heard radar.
- **Mesh Health:** advert counts and alerts, request traffic, public key prefix collisions, relay reception, and a power outage view (which nodes stay online, from each node's power source).
- **Mesh Trends:** stored network, message and packet breakdowns plus live session statistics.
- **Packet Feed** (live) and **Packet History** (everything stored, with search and CSV export).
- **Analyze Packet**, **Mesh Visualizer** (3D graph), **Trace** (with a hop map), **Mesh Discovery** (repeaters, sensors, regions, plus Direct (0 hop) and Flood advert buttons).
- **SNMP:** every node with SNMP set up in one sortable table, with failing polls marked, all 22 values and the history chart per node, and Poll now / Poll all now over your LAN (no RF).
- **Channel Registry** with remote sync (open a channel's entry in edit mode from its header or info panel), and **Channel Finder** (WebGPU channel name search).
- **Knowledge base**: your own handy links, picked from Settings > Handy Info > Links or added directly.
- One time-range selector across the analysis views; charts zoom and pan.

### Radio management

- Serial, TCP or BLE, with serial auto-detection when no transport is set.
- Radio parameters, path hash mode (1, 2 or 3 bytes per hop when the firmware supports it), location, adverts, default flood scope and known regions.
- GPS toggle on any radio that reports it, including stock companion firmware.
- [meshcomod (DMC-EV)](#meshcomod-dmc-ev-firmware) CAD and GPS controls, and [OpenHop](#openhop-nodes) management panes.
- Radio identity registry: history per radio, and a prompt when a different radio connects (new radio or replacement).
- Loadouts: named sets of channels and contacts to load onto the radio, for example before disconnecting it.
- [Host repeater](#host-repeater) in shadow mode, with optional live forwarding.

### Integrations and automation

- Private MQTT, community MQTT (observer feed, with regional presets such as LetsMesh, MeshRank and the DMC collectors) and Home Assistant MQTT discovery ([README_HA.md](README_HA.md)).
- Webhooks, Apprise, Amazon SQS and Map Upload to map.meshcore.io or a compatible endpoint.
- Every integration has its own message scope.
- REST API with interactive docs at `/docs`.

### Data and backup

- One SQLite database (`data/meshcore.db` by default) holds packets with signal metadata, messages and history.
- Backup to the browser or a server path, on demand or on a schedule with rotation; restore is staged and applied at the next restart.
- Per-class data retention with **Prune now** and a **Keep everything (analyzer)** preset.

### Interface

- Themes including DarkDutch and four CRT phosphor themes, with optional CRT screen effects.
- Desktop buddy (Clippy and 35 friends: the clippyjs agents plus 26 converted Microsoft Agent characters): on by default with the Windows 95 theme, optional on every other theme after that; announces new nodes, low batteries, DMs and mentions, radio disconnects and updates, and stays on screen while navigating.
- English, Dutch and German; date/time format, distance units and coordinate format (decimal, DMS or MGRS) are configurable.
- Installable as a PWA; app name and icon can be rebranded server-side.
- Command palette (Ctrl+K / Cmd+K) and bookmarkable views.
- Chat window: a separate, lighter window with only messaging, laid out like a classic IRC client (conversation list, chat, recent senders). Classic lines or the regular bubbles, a mIRC, dark mIRC or app-theme skin, and a detached window per conversation. It does not load the map or packet views and skips the raw packet stream.
- In-app update indicator that checks GitHub for a newer fork build (can be disabled).

## Requirements

- A MeshCore companion radio connected over USB serial, TCP or BLE.
- **Docker install:** Docker with Compose. For serial passthrough, use rootful Docker.
- **Source install:**
  - Python 3.11 or newer
  - [uv](https://astral.sh/uv): `curl -LsSf https://astral.sh/uv/install.sh | sh`
  - Node.js 20.19+ or 22.12+ with npm, to build the frontend (CI and the Docker image use Node 24)

<details>
<summary>Finding your serial port</summary>

```bash
#######
# Linux
#######
ls /dev/ttyUSB* /dev/ttyACM*

#######
# macOS
#######
ls /dev/cu.usbserial-* /dev/cu.usbmodem*

###########
# Windows
###########
# In PowerShell:
Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Caption

######
# WSL2
######
# Run this in an elevated PowerShell (not WSL) window
winget install usbipd
# restart console
# then find device ID
usbipd list
# make device shareable
usbipd bind --busid 3-8 # (or whatever the right ID is)
# attach device to WSL (run this each time you plug in the device)
usbipd attach --wsl --busid 3-8
# device will appear in WSL as /dev/ttyUSB0 or /dev/ttyACM0
```

</details>

## Quick start

Running from source is recommended over Docker: intermittent serial communication issues have been seen in containers on \*nix systems.

### From source

```bash
git clone https://github.com/Elektr0Vodka/RTFM-EV.git
cd RTFM-EV

uv sync
cd frontend && npm install && npm run build && cd ..

uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000. The API docs are at http://localhost:8000/docs.

Pick the radio with environment variables (only one transport at a time):

```bash
# Serial (explicit port; leave unset to auto-detect)
MESHCORE_SERIAL_PORT=/dev/ttyUSB0 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# TCP
MESHCORE_TCP_HOST=192.168.1.100 MESHCORE_TCP_PORT=5000 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# BLE
MESHCORE_BLE_ADDRESS=AA:BB:CC:DD:EE:FF MESHCORE_BLE_PIN=123456 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

On Windows (PowerShell), set environment variables as a separate statement:

```powershell
$env:MESHCORE_SERIAL_PORT="COM8" # or your COM port
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

> [!WARNING]
> **Windows + MQTT:** Python's default Windows event loop (ProactorEventLoop) does not work with the MQTT libraries. If you configure any MQTT integration, add `--loop none` to the uvicorn command:
>
> ```powershell
> uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --loop none
> ```
>
> Without it the app starts, but MQTT connections fail and the UI shows a toast with this guidance.

On Linux you can install the app as a `systemd` service (named `remoteterm`) that starts on boot and restarts on failure:

```bash
bash scripts/setup/install_service.sh
```

See [README_ADVANCED.md](README_ADVANCED.md#systemd-service) for details.

`scripts/setup/fetch_prebuilt_frontend.py` downloads a prebuilt frontend into `frontend/prebuilt` from the fork's latest GitHub release, so you can skip the Node build. It only works once the fork publishes a release that carries a prebuilt frontend; until then, build the frontend as shown above.

#### Upgrading a source checkout

```bash
# If you run it as a systemd service, stop it first:
sudo systemctl stop remoteterm

cd RTFM-EV
git pull
uv sync
cd frontend && npm install && npm run build && cd ..

# Restart the service (or re-run uvicorn manually):
sudo systemctl start remoteterm
```

> [!IMPORTANT]
> `git pull` alone is not enough. The browser loads the compiled frontend from `frontend/dist`, which is gitignored and only regenerated by `npm run build`, and `uv sync` picks up backend dependency changes.

### Docker

> [!WARNING]
> Docker has had intermittent issues with serial event subscriptions. The source install above is more reliable.

The published image `ghcr.io/elektr0vodka/rtfm-ev:latest` is rebuilt on every push to `main`. Create a local `docker-compose.yml` (gitignored, so pulls do not overwrite it) in one of two ways:

```bash
# Copy the example and edit the device mapping and environment by hand
cp docker-compose.example.yml docker-compose.yml

# Or generate one interactively
bash scripts/setup/install_docker.sh
```

The interactive generator enables a self-signed (snakeoil) TLS certificate by default, so the app is served over HTTPS; decline if you want plain HTTP or terminate TLS elsewhere. It can collect BLE settings, but BLE from Docker still needs manual compose changes (Bluetooth passthrough, possibly privileged mode or host networking). For BLE, the source install is simpler.

Then start it:

```bash
sudo docker compose up # add -d to run in the background once it works
```

The database lives in `./data/` (bind-mounted), the same place the source install uses.

```bash
# Update to the latest image
sudo docker compose pull
sudo docker compose up -d

# Stop
sudo docker compose down
```

Notes:

- To build from your checkout instead, replace `image: ghcr.io/elektr0vodka/rtfm-ev:latest` with `build: .` and run `sudo docker compose up -d --build` (`pull` only fetches remote images).
- Local builds are architecture-native: on Apple Silicon and ARM64 Linux (for example a Raspberry Pi) they produce an ARM64 image.
- Rootless Docker has been observed to fail on serial-device mappings even with a correct compose file.
- The container runs as root for serial compatibility. On Linux, switching between native and Docker runs can leave `./data` root-owned; the optional `user: "${UID:-1000}:${GID:-1000}"` line in the compose file keeps ownership aligned with your host user.

## Configuration

Settings are environment variables with the `MESHCORE_` prefix. Only one transport (serial, TCP or BLE) may be set; if more than one is set, the server refuses to start. With none set, the server auto-detects a serial radio.

| Variable                         | Default                         | Description                                                                                                                              |
| -------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `MESHCORE_SERIAL_PORT`           | (auto-detect)                   | Serial port path                                                                                                                         |
| `MESHCORE_SERIAL_BAUDRATE`       | `115200`                        | Serial baud rate                                                                                                                         |
| `MESHCORE_TCP_HOST`              |                                 | TCP host                                                                                                                                 |
| `MESHCORE_TCP_PORT`              | `5000`                          | TCP port                                                                                                                                 |
| `MESHCORE_BLE_ADDRESS`           |                                 | BLE device address                                                                                                                       |
| `MESHCORE_BLE_PIN`               |                                 | BLE PIN (required when `MESHCORE_BLE_ADDRESS` is set)                                                                                    |
| `MESHCORE_LOG_LEVEL`             | `INFO`                          | `DEBUG`, `INFO`, `WARNING` or `ERROR`                                                                                                    |
| `MESHCORE_DATABASE_PATH`         | `data/meshcore.db`              | SQLite database path                                                                                                                     |
| `MESHCORE_BASIC_AUTH_USERNAME`   |                                 | Optional app-wide HTTP Basic auth username; set together with the password                                                               |
| `MESHCORE_BASIC_AUTH_PASSWORD`   |                                 | Optional app-wide HTTP Basic auth password; set together with the username                                                               |
| `MESHCORE_VAPID_SUBJECT`         | `mailto:noreply@meshcore.local` | Web Push VAPID `sub` claim (`mailto:` or `https:`). Apple rejects the default `.local` domain, so set a real address for iOS/Safari push |
| `MESHCORE_HOST_REPEATER_ENABLED` | `false`                         | Server switch needed to arm the [host repeater](#host-repeater) for live forwarding. Shadow mode does not need it                        |
| `MESHCORE_UPDATE_CHECK_ENABLED`  | `true`                          | Check GitHub for a newer fork build and show an in-app indicator; set `false` to disable the outbound request                            |

Remediation and advanced variables (`MESHCORE_ENABLE_MESSAGE_POLL_FALLBACK`, `MESHCORE_FORCE_CHANNEL_SLOT_RECONFIGURE`, `MESHCORE_LOAD_WITH_AUTOEVICT`, `MESHCORE_ENABLE_LOCAL_PRIVATE_KEY_EXPORT` and others) are described in [README_ADVANCED.md](README_ADVANCED.md#remediation--advanced-environment-variables). Most other settings live in the app under **Settings**.

## Security

- **Trusted networks only.** The app has no user accounts, sessions or per-feature permissions. Do not put it on an untrusted network or open it to the public.
- **Basic auth is a coarse gate.** `MESHCORE_BASIC_AUTH_USERNAME` and `MESHCORE_BASIC_AUTH_PASSWORD` enable app-wide HTTP Basic auth. Pair it with HTTPS, since Basic credentials are not safe over plain HTTP ([HTTPS setup](README_ADVANCED.md#https)).
- **Permissive CORS by design.** The backend allows all origins so any device on your network can reach it. Cross-origin browser JavaScript is therefore not a reliable way to use the Basic auth gate.
- **No Python bots.** This fork removed the upstream bot system, so the app has no feature that runs user-supplied code on the server.
- For stronger access control, put the app behind a reverse proxy such as Nginx. Full access control and user management are outside the scope of this app.

## Firmware and node support

### meshcomod (DMC-EV) firmware

[meshcomod](https://github.com/Elektr0Vodka/meshcomod) (DMC / DMC-EV) is a multi-transport companion firmware for Heltec and Seeed LoRa devices. When the connected radio runs meshcomod, a **Meshcomod (DMC-EV)** panel appears under **Settings > Radio**:

- **CAD (Channel Activity Detection):** check for channel activity before each transmit and defer while the channel is busy (needs CAD-capable meshcomod firmware).
- **GPS:** enable the on-board GPS receiver and set its reporting interval (0 to 86400 seconds).

Detection is automatic from the radio's device info; each control disables itself when the firmware build does not report support, and the panel is hidden on other firmware. Stock companion firmware that reports the `gps` custom var gets a standalone GPS toggle instead.

### OpenHop nodes

[OpenHop](https://github.com/openhop-dev/openhop_repeater) repeaters and room servers (a Python MeshCore daemon) work in two ways:

- **As the radio:** OpenHop speaks the companion protocol over TCP (default port 5000), so point the app at its host and port like any TCP radio.
- **As a managed node:** when the connected node is detected as OpenHop, an **OpenHop** section appears with Node panes (Config, System, Update, CAD) and Mesh panes (Policy, Plugins, Transport keys, MQTT). They use OpenHop's REST API; set the API URL and token (write-only) under **Settings > Radio** first. Actions with real-world effect ask for confirmation. With the API configured, the My Node airtime and receive-error charts read from the OpenHop API.

### Host repeater

RTFM-EV can judge every packet its radio receives the way a repeater would: MeshCore forwarding rules, `flood.max`, region and loop settings, the DMC packet filter, DMC duty-cycle region gating, OpenHop-style policy rules (modelled on the [jhuebert/MeshCore](https://github.com/jhuebert/MeshCore) repeater filter) and an advert limiter. Configure it under **Settings > Host repeater**.

- **Shadow mode** shows what would be forwarded or dropped, host latency and the airtime forwards would use. It never forwards; only the opt-in neighbour poll (below) transmits.
- **Armed mode** forwards for real. It needs all of: `MESHCORE_HOST_REPEATER_ENABLED=true`, the admin switch in Settings, a non-OpenHop radio with firmware raw send (companion v1.16+), firmware client repeat off, an EU sub-band whose duty-cycle limit meets the configured minimum, and a confirmation in the browser.
- It disarms itself when the radio disconnects (opt-in re-arm on reconnect), when firmware client repeat is found on, when the radio's frequency, modulation or identity changes, when raw sends keep failing, when measured TX airtime over the last hour exceeds the sub-band limit, or when the forward queue is stuck. **Disarm** in Settings and `POST /api/radio/host-repeater/disarm` are the kill switch; it always starts disarmed after a restart, and a **Repeating** badge shows in the top bar while armed.
- It forwards on the main mesh frequency, like an OpenHop repeater. Make sure you are allowed to operate a repeater where you are.
- The DMC packet filter follows the `dmc-observer-dev` firmware: hop and rate limits (with soft cutoff), minimum path hash size, blocked channels, the malformed scan, a per-node advert window, blocked path prefixes, sender and text rules (block, throttle or a share of matches) on Public and watched `#` channels, a message age limit, and a dry-run mode that counts drops without dropping.
- **Neighbour poll** (opt-in, transmits): every 12-336 hours it sends one zero-hop repeater discover and asks each neighbour for its flood regions, like a DMC observer repeater. The neighbours table also fills from zero-hop repeater adverts.
- With the community MQTT integration, the host repeater can publish the DMC observer `filter` topic (filter counters and region gate state) and this node's own `neighbors` topic. Both are opt-in per integration and only publish while the host repeater is in shadow or armed mode; shadow counters are marked `dryrun`.

## Documentation

- **Documentation site:** [elektr0vodka.github.io/RTFM-EV](https://elektr0vodka.github.io/RTFM-EV/): this README, advanced setup, Home Assistant and the User Guide in English, Dutch and German.
- **User Guide:** in the app under **Tools > User Guide** (`#manual`), in English, Dutch and German. Sources: [frontend/src/content/manual/](frontend/src/content/manual/).
- [README_ADVANCED.md](README_ADVANCED.md): remediation variables, backup and restore, data retention, contact loading issues, reverse proxy, HTTPS, systemd, debug logging, branding.
- [README_HA.md](README_HA.md): Home Assistant integration, entities and example automations.
- [CHANGELOG-DMC-EV.md](CHANGELOG-DMC-EV.md): changes made in this fork.
- [docs/](docs/): the [parity audit](docs/parity-audit.md) against the official app and DMC firmware, and [sources of truth](docs/sources-of-truth.md).
- Live API docs at http://localhost:8000/docs once the backend runs.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for local development, tests, linting and E2E notes. If you extend the app with an LLM, have it read the three `AGENTS.md` files: [AGENTS.md](AGENTS.md), [app/AGENTS.md](app/AGENTS.md) and [frontend/AGENTS.md](frontend/AGENTS.md).

This project is developed with heavy agentic assistance, guided by an engineer who cares about clean code and good tests. There is no warranty of fitness for any purpose, and you may find bugs.

## License and credits

- MIT licensed; see [LICENSE.md](LICENSE.md). Copyright 2026 Jack Kingsman, author of the upstream [RemoteTerm for MeshCore](https://github.com/jkingsman/Remote-Terminal-for-MeshCore).
- Third-party licenses: [LICENSES.md](LICENSES.md).
- The internationalization approach and portions of the Dutch and German translation strings are adapted from [kiekr-i18n](https://github.com/marcelverdult/kiekr-i18n) by Marcel Verdult ([@marcelverdult](https://github.com/marcelverdult)), licensed under CC-BY 4.0.
