# RTFM-EV

RTFM-EV is a web interface and FastAPI backend for [MeshCore](https://github.com/meshcore-dev/MeshCore) companion radios. A small server connects to one radio over Serial (USB), TCP or BLE, and you use it from any browser on your network: messaging, contact and repeater management, a live map, packet analysis and integrations such as MQTT and Home Assistant.

RTFM-EV is a fork of [RemoteTerm for MeshCore](https://github.com/jkingsman/Remote-Terminal-for-MeshCore) by Jack Kingsman. Upstream development is on hold; this fork ([Elektr0Vodka/RTFM-EV](https://github.com/Elektr0Vodka/RTFM-EV)) is the active repository. It keeps everything RemoteTerm does as a live terminal for a radio and treats the server database as the system of record, so a radio that stays connected builds a long-lived local history of the mesh that you can browse and analyze. On top of that the fork adds, among other things:

- support for the [meshcomod (DMC / DMC-EV)](https://github.com/Elektr0Vodka/meshcomod) companion firmware and management of [OpenHop](https://github.com/openhop-dev/openhop_repeater) nodes
- a MapLibre and deck.gl map with packet replay, link history and several overlays
- analysis views: My Node, Mesh Health, Mesh Trends, Packet History, Mesh Discovery, SNMP
- a fleet asset register for the devices you look after
- a host repeater that judges every received packet the way a repeater would (shadow mode, optional live forwarding)
- Spam Guard: channel spam detection that flags spam in chat and keeps the host repeater from forwarding it
- Bot lists: keep and share lists of known bots, mark them in chat, hide them and stop relaying them
- Spam Guard profiles: save the detection settings and mode under a name, switch by hand when the situation changes, share them as files
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
- Full-text message search with `user:`, `channel:` and `region:` filters.

### Contacts and nodes

- Monitor more contacts and channels than the radio can hold: packets are stored and decrypted on the server, including older packets once you add a key.
- Per-contact radio residency (Auto, Pin, App only), notes, owner, manual location, battery chemistry and telemetry sharing permissions.
- [Companion command line](#meshcore-118-companion-command-line) (firmware 1.18+): commands for another companion from its contact info or the DM header, and a per-contact Remote CLI permission that lets a contact run commands on your radio. Commands other companions send to your radio show in the DM as a marked line, never as chat.
- Contact pages with position history, advert paths, previous names, nearest repeaters and scored message routes.
- Sidebar with favorites split by node type, your own contact groups, and an **Owned** section for nodes your radio owns.
- Repeater dashboard: login, status and settings panes, CLI console with command suggestions, telemetry history, config change history and a settings editor that confirms and reads back each change, including SNMP on/off on observer firmware.
- Sensor dashboard above the sensor's chat (alerts stay readable): login, LPP telemetry, min/max/average, access list, console and live telemetry push (firmware 1.18+: the sensor sends new readings by itself when a watched value changes).
- Room server dashboard with telemetry, ACL, sensor data, console and ACL change history, plus a Sync Now button that asks the room server for recent messages again, and Resync history to fetch every post the room still holds when some are missing.
- Per-contact region for direct messages: scope flood-routed DMs to a region, force them unscoped, or follow the global setting.
- Optional unread channel summaries written by a model on your own Ollama server. Off by default; when on, the unread text of the channel you open is sent to that server.
- SNMP polling of observer firmware nodes over your LAN (repeaters and room servers): set an address per contact and read radio, MQTT, memory and WiFi values without using RF.
- Optional SNMP agent: let LibreNMS, Zabbix or another monitoring system poll this node with the same OIDs as the observer firmware (read-only, off by default).
- Scheduled telemetry tracking for repeaters and up to 8 other contacts.
- Node clocks: each contact shows how far its clock is off, read from the time in its adverts (nothing is sent). A tracked repeater can have its clock set automatically when it runs behind (opt-in, checked against the rest of the mesh first).
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
- **Mesh Health:** advert counts and alerts, request traffic, public key prefix collisions, relay reception, a power outage view (which nodes stay online, from each node's power source), and spam and bot statistics (spam, malformed and duplicate channel messages, listed bots, how Spam Guard handled them, with CSV, JSON and text export).
- **Mesh Trends:** stored network, message and packet breakdowns plus live session statistics.
- **Packet Feed** (live) and **Packet History** (everything stored, with search and CSV export).
- **Who heard this** in every packet breakdown: the packet hash, links to its page on your analyzer sites, and on request the analyzer's observers that received the same packet, with region, time, RSSI and SNR.
- **Analyze Packet**, **Mesh Visualizer** (3D graph), **Trace** (with a hop map), **Mesh Discovery** (repeaters, sensors, regions, plus Direct (0 hop) and Flood advert buttons).
- **SNMP:** every node with SNMP set up in one sortable table, with failing polls marked and Poll now / Poll all now over your LAN (no RF). Each node has its own page with all 22 values and graphs over a time range you choose (counters as rates or totals, reboots counted).
- **Fleet:** an asset register with one row per device you keep track of: your own label, organisation and hardware serial, model, role, Wi-Fi and Bluetooth MAC, who has it, the site, a status (in stock, deployed, maintenance, lost, stolen, retired) and notes. An asset can carry a node's public key and then shows that node's name, type, last seen time and position from the contact. Add nodes from their contact page or all nodes you own in one go, search, filter, sort, and export as CSV or JSON. Each asset has a log (maintenance, failures, placement, notes; status and holder changes are logged for you) and shows what the node last reported: battery, temperature and firmware. A "needs attention" filter marks lost and stolen devices and deployed nodes that went silent, run low on battery or report a firmware other than their target. All of that comes from data already stored: the page never asks a node anything and never uses the radio. An optional **key vault** (off by default, see [README_ADVANCED.md](README_ADVANCED.md#fleet-key-vault)) stores private keys and passwords encrypted, with an audit log, an encrypted export and key generation that avoids the prefixes of nodes you know. Each asset also keeps its **config files**: the file the Dutch MeshCore toolbox saves for a repeater or room server, or the Settings > Radio file of a companion. You can view one by section, compare two, export it again as a file the toolbox reads, and make **templates** with variables to create a config for another asset from. The secrets in a file go to the key vault, or are left out when the vault is off or locked; a stored config never holds one. A config can also be held against what its node last reported (the repeater panes you opened for it and its SNMP polls, as stored), which shows where the two differ. A repeater or room server on a **USB cable** at the PC you use can be read into that library, and a stored config applied to it, from the browser (Chrome or Edge, on `localhost` or HTTPS): every difference and every command is shown first and needs a confirm, commands go one at a time and are read back, the private key and the radio settings each need their own tick, and nothing goes over the radio (see [README_ADVANCED.md](README_ADVANCED.md#fleet-configs-over-a-usb-cable)). **Onboard a device** walks a new repeater or room server through that in one flow: find or create its asset (keeping its key or with a new key from the vault), keep its settings from before, apply a template, compare, and mark it deployed.
- **Channel Registry** with remote sync (open a channel's entry in edit mode from its header or info panel), and **Channel Finder** (WebGPU channel name search).
- **Knowledge base**: your own handy links, picked from Settings > Handy Info > Links or added directly.
- One time-range selector across the analysis views; charts zoom and pan.

### Radio management

- Serial, TCP or BLE, with serial auto-detection when no transport is set.
- Radio parameters, path hash mode (1, 2 or 3 bytes per hop when the firmware supports it), location, adverts, default flood scope and known regions.
- GPS toggle on any radio that reports it, including stock companion firmware.
- [Command line for your own radio](#meshcore-118-companion-command-line) in Settings > Radio and on My Node (companion firmware 1.18+): CAD, interference threshold, TX delays, time zone offset, WiFi and more.
- [meshcomod (DMC-EV)](#meshcomod-dmc-ev-firmware) CAD and GPS controls, and [OpenHop](#openhop-nodes) management panes.
- Radio identity registry: history per radio, and a prompt when a different radio connects (new radio or replacement).
- [Several radios at once](README_ADVANCED.md#multiple-radios-experimental) (experimental, opt-in): one workspace per radio, for example 433 and 868 MHz side by side, with a shared channel list, a radio switcher and unread badges across radios.
- Loadouts: named sets of channels and contacts to load onto the radio, for example before disconnecting it.
- [Host repeater](#host-repeater) in shadow mode, with optional live forwarding.
- [Spam Guard](#spam-guard): channel spam detection with a Monitor and a Protect mode, off by default.
- [Bot lists](#bot-lists): lists of known bots that mark and hide their messages and can keep this repeater from relaying them, off until you enable one.
- [Spam Guard profiles](#spam-guard-profiles): saved sets of Spam Guard settings that you apply by hand and can share as files.

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

- Themes including DarkDutch, MCEU Light and Dark (the look of the EU MeshCore Analyzer) and four CRT phosphor themes, with optional CRT screen effects.
- Desktop buddy (Clippy and 35 friends: the clippyjs agents plus 26 converted Microsoft Agent characters): on by default with the Windows 95 theme, optional on every other theme after that; announces new nodes, low batteries, DMs and mentions, radio disconnects, updates, unacknowledged DMs, integrations that stay disconnected and SNMP nodes that stop answering, and stays on screen while navigating. It plays a fitting animation before each line and gestures toward what it talks about; per-topic switches, a mute and daily quiet hours decide when it speaks. Click it for a menu with a recap of what it said, help for the page on screen, mute and hide.
- Guided walkthrough: a buddy shows a new user around in 12 steps, moving next to each part and pointing at it without blocking the page. Start it from the User Guide, the buddy menu, or the one-time offer on a fresh install; pause, resume or end it at any time. Works on every theme and layout, also without a buddy switched on.
- English, Dutch and German; date/time format, distance units and coordinate format (decimal, DMS or MGRS) are configurable.
- Installable as a PWA; app name and icon can be rebranded server-side. The installed app shows the unread count on its icon (Windows, macOS, iOS), has a Reload app button under Settings > About, and offers a reload when the server was updated while it stayed open.
- Command palette (Ctrl+K / Cmd+K) and bookmarkable views.
- Touch screens: tap a badge, icon or shortened value to read the explanation a mouse gets on hover.
- Chat window: a separate, lighter window with only messaging, laid out like a classic IRC client (conversation list, chat, recent senders). Classic lines or the regular bubbles, a mIRC, dark mIRC or app-theme skin, and a detached window per conversation. Each list section can be sorted (newest, oldest, A-Z, Z-A, most unread, distance) and folded, with favorites-only, unread-only and hide-muted toggles. It does not load the map or packet views and skips the raw packet stream.
- In-app update indicator that checks GitHub for a newer fork build (can be disabled).

## Requirements

- A MeshCore companion radio connected over USB serial, TCP or BLE.
- **Docker install:** Docker with Compose. For serial passthrough, use rootful Docker.
- **Source install:**
  - Python 3.11 or newer
  - [uv](https://astral.sh/uv): `curl -LsSf https://astral.sh/uv/install.sh | sh`
  - Node.js 20.19+ or 22.12+ with npm, to build the frontend (CI and the Docker image use Node 24). Running the frontend tests needs Node 22.22.2+, 24.15+ or 26+

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
| `MESHCORE_MULTI_RADIO`           | `false`                         | Run several radios at once, one workspace per radio (experimental). See [Multiple Radios](README_ADVANCED.md#multiple-radios-experimental) |

Remediation and advanced variables (`MESHCORE_ENABLE_MESSAGE_POLL_FALLBACK`, `MESHCORE_FORCE_CHANNEL_SLOT_RECONFIGURE`, `MESHCORE_LOAD_WITH_AUTOEVICT`, `MESHCORE_ENABLE_LOCAL_PRIVATE_KEY_EXPORT`, `MESHCORE_FLEET_VAULT_ENABLED` and others) are described in [README_ADVANCED.md](README_ADVANCED.md#remediation--advanced-environment-variables). Most other settings live in the app under **Settings**.

## Security

- **Trusted networks only.** The app has no user accounts, sessions or per-feature permissions. Do not put it on an untrusted network or open it to the public.
- **Basic auth is a coarse gate.** `MESHCORE_BASIC_AUTH_USERNAME` and `MESHCORE_BASIC_AUTH_PASSWORD` enable app-wide HTTP Basic auth. Pair it with HTTPS, since Basic credentials are not safe over plain HTTP ([HTTPS setup](README_ADVANCED.md#https)).
- **Permissive CORS by design.** The backend allows all origins so any device on your network can reach it. Cross-origin browser JavaScript is therefore not a reliable way to use the Basic auth gate.
- **The fleet key vault is off by default.** With `MESHCORE_FLEET_VAULT_ENABLED=true` the app stores private keys and passwords encrypted under a passphrase. It has no user accounts behind it, a forgotten passphrase cannot be recovered, and it needs HTTPS. Read [the notes](README_ADVANCED.md#fleet-key-vault) first.
- **No Python bots.** This fork removed the upstream bot system, so the app has no feature that runs user-supplied code on the server.
- For stronger access control, put the app behind a reverse proxy such as Nginx. Full access control and user management are outside the scope of this app.

## Firmware and node support

### meshcomod (DMC-EV) firmware

[meshcomod](https://github.com/Elektr0Vodka/meshcomod) (DMC / DMC-EV) is a multi-transport companion firmware for Heltec and Seeed LoRa devices. When the connected radio runs meshcomod, a **Meshcomod (DMC-EV)** panel appears under **Settings > Radio**:

- **CAD (Channel Activity Detection):** check for channel activity before each transmit and defer while the channel is busy (needs CAD-capable meshcomod firmware).
- **GPS:** enable the on-board GPS receiver and set its reporting interval (0 to 86400 seconds).

Detection is automatic from the radio's device info; each control disables itself when the firmware build does not report support, and the panel is hidden on other firmware. Stock companion firmware that reports the `gps` custom var gets a standalone GPS toggle instead.

meshcomod v1.18.0.1 and later also have the [MeshCore 1.18 companion command line](#meshcore-118-companion-command-line). When the build includes the meshcomod **companion receive filter** (the `filter` command, see meshcomod's `docs/companion_receive_filter.md`), a **Companion receive filter** card appears under **Settings > Radio**:

- **Settings:** filter on/off, the malformed group text scan, the maximum message age, blocked path prefixes, and sender and text rules (block, or throttle with `secs` and `prob`).
- **Counters:** messages hidden since the radio started, per reason, per prefix and per rule. RTFM-EV samples the totals every minute and shows them over time (stored like airtime history and kept for the same retention period).
- **Backup:** the settings are kept per radio. The first read and every change made in RTFM-EV update the backup; a plain read never overwrites it, so after a flash or `filter reset` **Restore backup to radio** writes the old settings back.

Everything goes through the radio's own command line and never transmits. The radio's replies are capped at 158 bytes, so a long rule list can come back cut off; the card says so when that happens. The radio's raw RX log is not filtered, so messages the radio hides can still appear in RTFM-EV, which decodes that log itself.

### MeshCore 1.18 companion command line

MeshCore companion firmware 1.18 added a command line to the companion radio itself. With a 1.18 or newer radio connected:

- **Your radio:** a **Command line** card in **Settings > Radio** and on **My Node** runs commands on the connected radio (for example `get radio`, `set cad on`, `set tz.offset 2`, `set wifi.ssid`). It runs on the radio and never transmits.
- **Another companion:** the same console in a chat contact's info, or the command line toggle in the DM header, sends the command over the mesh. That companion only answers when it has given you **Remote CLI** permission.
- **Remote CLI permission:** the **Remote CLI** switch in a chat contact's info lets that contact run commands on your radio. Only turn it on for contacts you trust: they can reboot the radio, change its radio settings and read its WiFi password.
- `reboot`, `poweroff`, `shutdown`, `set radio`, `set pin` and `set wifi.*` ask for confirmation first.

Older companion firmware, meshcomod before v1.18.0.1 and OpenHop do not have this command line; the cards say so.

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

### Spam Guard

Spam Guard detects channel spam behaviour and, in Protect mode, keeps the host repeater or a connected OpenHop node from forwarding it. It is modelled on [openhop-spamguard](https://github.com/flackrat/openhop-spamguard) and written from scratch for RTFM-EV. Switch it on in Settings > Local Configuration > Spam protection; a **Spam Guard** page then appears in the sidebar.

- **It judges behaviour, never people or opinions:** the same text under several made-up or brand-new names, floods of copies, repeaters that spam enters the mesh through, and a repeater that keeps changing its identity. There is no "block this sender" button, and every automatic block expires.
- **Monitor** (the starting mode) detects and shows spam without blocking anything. **Protect** makes the host repeater drop what a block catches. That only has an effect on air while the [host repeater](#host-repeater) is armed; in shadow mode you see what would have been dropped.
- **Known people** (names seen sending genuine messages) pass the blocks that hold people. **Lockdown** lets only known names through for a while during a heavy attack. Messages from normal-looking names that were held are listed with a **Let through** button.
- **Duplicate suppression** lets the first copy of a longer message through and holds back its repeats for a while. **Block repeats from** sets whose: other names (the default), the same name only, or everyone. A caught repeat carries a Duplicate marker in chat; it is not a spam flag. How long a message must be before it counts is a setting (30 characters by default, 5 at the least). Removing a duplicate block by hand forgives the copies seen so far: the next message with that text counts as a first copy again.
- **In chat**, flagged messages carry a Spam marker and each channel message has **This is spam** / **Not spam**. **Hide spam** hides flagged messages and keeps them out of unread counts, mentions, push notifications and the Ollama unread summary.
- **Evidence log and replay** (off by default): keeps every analysed message and your This is spam / Not spam answers for 1 to 30 days. Download it as JSON Lines, optionally scrambled (sender names and @mentions replaced by codes, channel names left out), or replay it against other settings to see what they would have caught, missed or wrongly held. A replay changes nothing. The log never holds a channel key.
- **Keeping it tidy:** a repeater block you add yourself can be limited to one protected channel, which makes fewer rules. The held list, the recent messages list and single spam sources can be cleared. Settings has two separate resets: one forgets everything that was learnt (blocks included), the other puts the settings back to those of a fresh install.
- **In the packet feed** (OpenHop radio) each packet shows the policy rule that decides it, for example `Drop rule rtfm-spam:text:7440749b06 (yours)` or one of your own rules, in red for a drop. RTFM-EV works it out from a copy of the node's policy: an indication, the node itself decides. The rule is stored with the packet, so Packet History shows it too, finds a packet by its rule name, can list only the packets a rule decided, and exports it to CSV. The feed's Filters also have **Hide malformed**.
- **A repeater is shared.** What your repeater does not forward disappears for everyone downstream, and they cannot see why. Run Monitor for a day before switching to Protect.
- **On an OpenHop radio** the node forwards on its own, so Protect writes the blocks into the node's policy through its API, as rules named `rtfm-spam:...` placed before and after your own rules. The end of a rule name says where its block came from: `(yours)` for one you made or kept, `(duplicate)` for routine duplicate suppression, `(auto)` for the rest. Your own rules, objects and groups are passed through untouched. It needs the API URL and token under OpenHop management, switches the node's policy engine on, checks the node every minute and puts its rules back if they were changed there. The rules are removed when you switch to Monitor, pause, switch Spam Guard off, connect another radio or shut RTFM-EV down: an OpenHop rule does not expire by itself. A private channel is only enforced on the node after you agree, per channel, to its key being copied into the node's policy file. Nothing is written to a node that already has `spamguard:` rules. With an OpenHop radio the Spam Guard page also holds the node's policy editor (the **Policy** tab); Settings > OpenHop shows it only while Spam Guard is off. Not tested against a real OpenHop node yet.

### Bot lists

A bot list names known bots: an exact sender name, with an optional public key and note. Lists live under Settings > Local Configuration > Bot lists.

- **Enable a list** and its senders get a Bot marker in chat. Names are matched exactly and case-sensitively, so a person who uses the same name is marked too. "Never a bot" excepts a name on every list.
- **Hide bots** (chat filter menu or Settings) hides listed senders in chat and keeps them out of unread counts, mentions and notifications. Search still shows them.
- **Block forwards** (per list, off by default) stops this repeater relaying channel messages from the list's names. It works through Spam Guard in Protect mode, on its protected channels; the line under the switch says whether it is active or what it is waiting for. Names a subscription's refresh adds are held for your review first. Other repeaters still relay those messages, and they still arrive here.
- **Share a list** with Export, which writes a JSON file. Import file stores such a file as a new list of your own, switched off, so you can read it before you enable it.
- **Subscribe to a list** by its https address. RTFM-EV shows the list before storing it, keeps it read-only and switched off until you enable it, and refreshes it once a day. The host of the list sees your internet address on each refresh.
- **One list ships with RTFM-EV.** It is read-only and off until you enable it.
- **From chat**, a message's actions offer "Add to bot list" and, for a listed name, "Not a bot".

A bot list does not change what this repeater forwards unless its Block forwards switch is on. That part is tested against the host repeater's engine and a stand-in for the OpenHop policy API, not on air.

### Spam Guard profiles

A profile is a saved set of Spam Guard detection settings plus the mode (Monitor or Protect). Profiles live on the Spam Guard page, Settings tab.

- **Save current as profile** stores what is in force now under a name.
- **Apply** shows every value that will change, old and new, and then puts the profile's values in place. A profile that switches to Protect asks for a confirmation, because Protect makes this repeater stop forwarding what Spam Guard blocks.
- The card shows the profile **in use**. When the settings have been changed since, it says "modified" and offers **Save to profile** and **Revert**.
- **Export** downloads a profile as a JSON file; **Import file** stores one from a file. An imported profile is never applied by importing it.

A profile never holds the protected channels, channel keys, the exception lists, the pause or the evidence log settings, and applying one leaves those as they are. Nothing switches on its own.

What a profile that switches to Protect does on air was not tested on a real repeater.

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
