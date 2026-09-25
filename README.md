# RemoteTerm for MeshCore (RTFM-EV Fork)

Backend server + browser interface for MeshCore mesh radio networks, providing a rich, web-based power-user management and messaging system through a companion radio.

Connect your radio over Serial, TCP, or BLE, and then you can:

* Send and receive DMs and channel messages (SMAZ-compressed `s:` messages from other MeshCore clients are shown decoded)
* Channel image chunks sent by meshcore-open (`GRP_DATA` packets) are decrypted with the channel key and shown as an "Image (not supported)" placeholder in the channel, one per image. Images are not decoded (that needs meshcore-open's neural codec) and the image bytes are not stored, only the chunk metadata
* Share and import contacts as `meshcore://` links (the format other MeshCore clients use): Settings > Radio and contact info show your node's or a contact's link, and the new-conversation dialog imports a pasted link
* Join meshcore-open communities: paste the community code or scan its QR code (camera or image upload) in Channels > Import / Export > Communities. The community's Public channel and any community hashtag channels you add use keys derived from the shared community secret, so they interoperate with meshcore-open. You can share a joined community again as JSON or a QR code
* React to and reply to messages from the chat (hover a message). Reactions and replies use the plaintext format other MeshCore clients understand. A received reaction shows which message it is for and jumps to it. If that message never reached your radio, it links to the channel on your first configured analyzer that has a channel link. Received reactions show as reactions when Settings > Local Configuration > "Render MeshCore Open GIFs & Reactions" is on
* Delete a message from your own local history (hover a message, confirm). This is local only -- nothing is sent over RF, and other clients still have their copy. Deleting also removes its raw packet and any reaction pointing at it, and stops a background DM retry that is still in flight
* Mark a conversation unread from any received message (hover a message, envelope icon). The mark is server-side, so every browser sees the same unread state
* Cache all received packets, decrypting as you gain keys
* Group contacts and channels into your own named sidebar sections (Customize panel), edited from the contact or channel info pane; an item can sit in several groups and groups reorder/hide like the built-in sections
* Run multiple Python bots that can analyze messages and respond to DMs and channels
* Monitor unlimited contacts and channels (radio limits don't apply -- packets are decrypted server-side)
* Access your radio remotely over your network or VPN
* Search for hashtag channel names for channels you don't have keys for yet
* Parse entities in chat messages (optional, off by default): resolve public keys to a contact or external analyzer, turn GPS coordinates into a map card, and show clickable links with optional messenger-style previews (Settings > Local Configuration > "Chat parsing")
* Play an optional notification sound on new @mentions and DMs, with a choice of bundled presets or your own uploaded sound, a volume control, and per-conversation muting (Settings > Local Configuration > "Mention & DM sound")
* Get a browser notification the first time the app hears a node it has never seen before, filterable by node type (client, repeater, room, sensor) and batched into a summary on a busy mesh (Settings > Local Configuration > "New node notifications", off by default)
* Choose how dates and times are shown: follow the UI language, or force 12-hour mm/dd/yyyy or 24-hour dd/mm/yyyy (Settings > Local Configuration > "Date & Time Format")
* Set a battery chemistry (LiPo, LiFePO4, LiPo HV, or NMC) for accurate battery percentages: a global default (Settings > Local Configuration > "Battery Chemistry") with a per-node override in that node's contact info
* Contact info lists the routes your direct messages to a contact were sent on (learned direct path or flood), scored the way meshcore-open ranks its path history from delivery rate, trip time, freshness and route weight. Display only: routing is unchanged
* Forward packets, messages, and automatic repeater telemetry to MQTT, Home Assistant, LetsMesh, MeshRank, SQS, Apprise, etc.
* Use the more recent 1.14+ firmwares which support multibyte pathing
* Auto-detect [meshcomod (DMC-EV)](https://github.com/Elektr0Vodka/meshcomod) firmware and expose its extra device settings (CAD, GPS)
* Toggle the on-board GPS receiver on any radio that reports it, including stock MeshCore companion firmware (Settings > Radio)
* Edit a remote repeater's settings (name, location, radio, TX power, routing and advert options) from its dashboard: each change is confirmed on its own, sent as one CLI command over RF and read back. Radio frequency/bandwidth/SF/CR needs you to type the repeater name first, since a wrong value can strand it off-air
* Run a trace from the Trace page and see the hops drawn on a small map above the hop list (hops with no known location are skipped and bridged with a dashed segment)
* Visualize the mesh as a map or node set, view repeater stats, and more!

For advanced setup and troubleshooting see [README_ADVANCED.md](README_ADVANCED.md). If you plan to contribute, read [CONTRIBUTING.md](CONTRIBUTING.md).

**Warning:** This app is for trusted environments only. _Do not put this on an untrusted network, or open it to the public._ You can optionally set `MESHCORE_BASIC_AUTH_USERNAME` and `MESHCORE_BASIC_AUTH_PASSWORD` for app-wide HTTP Basic auth, but that is only a coarse gate and must be paired with HTTPS. The bots can execute arbitrary Python code which means anyone who gets access to the app can, too. To completely disable the bot system, start the server with `MESHCORE_DISABLE_BOTS=true` - this prevents all bot execution and blocks bot configuration changes via the API. If you need stronger access control, consider using a reverse proxy like Nginx, or extending FastAPI; full access control and user management are outside the scope of this app.

![Screenshot of the application's web interface](app_screenshot.png)

> [!WARNING]
> RemoteTerm does *full* management of the radio, meaning that once a radio is connected to RemoteTerm, all contacts/channels will be imported and offloaded to RemoteTerm and the contacts actually synced to the device will be governed by RemoteTerm. This means that RemoteTerm can be a poor fit for users who are looking to swap radios in and out, maintaining radio state (favorites, channels, etc.) irrespective of app usage.

## Project direction: from live terminal to local analyzer

RTFM-EV is a fork of RemoteTerm. It keeps everything RemoteTerm does as a live
browser terminal for a companion radio, and adds a deliberate change of emphasis.

RemoteTerm is built around the live view. A lot of its interface state is kept in
the browser, and its analytical surfaces (the raw packet feed and the mesh
visualizer) render only what has arrived in the current browser session's
in-memory buffer. Packets are written to the server database, but the interface is
oriented toward "what is happening now", and history retention is aggressive and
inconsistent (some data is pruned on hard-coded caps, some is manual-only, and some
grows unbounded).

RTFM-EV treats the server-side database as the system of record. The intent is that
a single always-on radio feeding the app builds a long-lived local record of the
mesh, so the app can act as a full local analyzer and not only a live terminal.

Shipped toward this so far:

- Per-packet signal metadata (RSSI, SNR, payload type) persisted with every stored
  packet (migration `_065`), plus advert-path signal (`_066`) and per-link signal
  history (`_075`).
- Standalone history stores for noise floor (`_069`), battery (`_070`), and local
  radio TX/RX airtime (`_088`).
- Repeater and per-contact telemetry history (`_050`, `_062`) and contact name
  history (`_024`).
- "My Node" and mesh-health views that read from this persisted history, including
  a TX/RX airtime utilization (%) chart on My Node and a "Directly heard radar"
  card that plots 0-hop nodes by bearing and distance, coloured by best SNR.
- A "Mesh Health" view with an Adverts panel (per-contact direct/flood advert
  counts, a searchable and pageable contacts table, and HIGH/MEDIUM alerts that
  count flood adverts only), a Requests panel (REQUEST/RESPONSE traffic heard by
  this node), and a Prefix Collisions tab (contacts sharing a 1/2/3-byte key
  prefix, a first-byte usage matrix, and a local/regional distance badge).
- A "Mesh Trends" view that consolidates the analytical stats into two tabs: a
  Historical tab (server-backed network/message/packet/MQTT/region-scope/noise-floor
  breakdowns) and a Live tab (the session packet-stat breakdowns that used to live
  in the raw packet feed).
- A "Packet History" view (Tools group) that browses the full persisted
  `raw_packets` history in the style of the live feed, with preset windows
  (1/3/6/12/24h) and an explicit date-to-date range, cursor "Load older" paging,
  server-side payload-type/hop-width/hex filters, and a Refresh button that
  re-anchors preset windows to "now" and re-queries (`GET /packets/history`). A message search box matches decrypted
  message text/sender/channel across the whole range (pick the "All time" range
  to search the entire database), floating scroll-to-top / scroll-to-bottom
  buttons appear when the list overflows, each row shows its date and time, and
  rows can be selected (with select/deselect-all) and exported to CSV. The live
  Raw Packet Feed can be paused (the view freezes while new packets keep
  buffering behind a "N new" badge). Both packet tabs can fold repeats of the
  same packet heard across different paths into one row badged with the copy
  count, and with autoscroll off they hold your scroll position instead of
  jumping to the newest packet.
  Path-hex hops
  resolve to known contact names in the feed, history, and packet detail. How
  far back it reaches is bounded by the raw-packet retention setting (Settings >
  Database > Data retention, `0` = keep forever).
- One unified time-range selector across the My Node, mesh-health, map, and Mesh
  Trends (Live tab) views (`20m`-`30d` + custom, plus per-page extras), with the
  choice remembered per page.
- Configurable map start view (Settings > Map): open the map automatically
  (geolocate then fit all nodes), at a fixed home location + zoom you pick on a
  small in-settings map, or at your last position and zoom. The mode and home
  coordinate are stored server-side (migration `_104`); the last position is
  remembered per browser.
- Map links are drawn only through nodes this server has heard over RF (never-heard
  contacts and analyzer-only nodes are skipped), with an optional max link
  distance in km (map Overlays > Links, per browser; usually the RF range of your
  frequency and preset). A fullscreen button on the map toggles browser
  fullscreen where the browser supports it.
- Map link history: an "All traffic" link mode built from every flood packet the
  node hears (not only adverts), a link-age window that follows the map's time
  filter or its own range, and clickable links. A link's popup leads to a page
  with its traffic trend, signal trend (links to your own node) and recent
  packets. History is kept 365 days by default (`link_edge_retention_days`,
  migration `_107`).
- Shared-locations map layer (map Overlays > Shared locations, off by default,
  per browser): pins for location shares sent in channels and DMs within the
  map's time window (meshcore-open `m:` markers, `lat, lon` pairs with 4+
  decimals, and MGRS references), newest per sender or every share. Clicking a
  pin shows who shared it, where and when, with "Open in chat". Local view only;
  never forwarded.
- GPX export from the map (Export FAB, download icon): exports the nodes
  currently shown under the map's active filters as GPX 1.1 waypoints
  (`rtfm-ev-nodes-<date>.gpx`), including nodes placed only by a manual
  location override (noted in the waypoint description). Each waypoint
  includes a `meshcore://` contact link when a raw advert for that node is
  still in the retained packet history; the link is left out otherwise.
- Guessed-locations map layer (map Overlays > Guessed locations, off by
  default, per browser, zoom 12+): an estimated position for a node with no
  advertised or manual location, heard in the last 24h, based on the located
  repeater(s) nearest it in its own known advert paths. Drawn as a hollow "~"
  marker, distinct from real (filled) node markers; clicking it explains it is
  a guess and names the anchor repeater(s). Never saved, exported or sent
  anywhere.
- MGRS support: upper-case MGRS references in chat (for example
  `31U FT 45332 73249`) become location cards when coordinate parsing is on, and
  Settings > Local > Coordinate format shows positions as decimal degrees
  (default), degrees/minutes/seconds, or MGRS.
- Backend map tile cache (Settings > Map > Map tile cache, off by default): the
  server caches the map tiles that were viewed (OpenFreeMap, OpenStreetMap,
  OpenTopoMap) on disk under `data/tile_cache/`, shared by every browser, so
  already-viewed areas keep working without internet. Size cap (default 1 GB)
  and max age (default 365 days) are configurable. Esri layers are never cached
  (their terms forbid it), and no source allows area pre-download.
- Mesh Trends Live-tab stat breakdowns can be computed from the database over the
  selected range, backed by decoded packet fields persisted at ingest (`_089`),
  not only the in-memory session buffer.
- In-app database backup and restore: download a consistent SQLite snapshot, or
  write one to a configured server-side path, on demand or on a schedule with
  keep-N rotation (migrations `_084`, `_113`). Restore from an uploaded file or a
  server-side backup; it is applied at the next server restart, after the current
  database is saved. See `README_ADVANCED.md`.
- Configurable, per-data-class retention (Settings > Database > Data retention,
  migration `_105`). Raw packets, messages, advert events, repeater/contact
  telemetry (days plus a rows-per-node cap), link signal, map link traffic
  history, noise floor, battery, airtime, and advert paths per contact each have
  their own setting, with `0` =
  keep forever. One prune service runs on a configurable interval (default every
  24 h) and there is a "Prune now" button, plus per-class row counts and oldest
  entry. A "Keep everything (analyzer)" button turns every limit off; "Restore
  defaults" puts back the previous caps. Defaults match the old behaviour, so an
  upgrade deletes nothing new. Pruning a message also deletes its raw packet.
  See `README_ADVANCED.md`.
- Failed DMs are marked: when every retry of an outgoing DM runs out without an
  ACK it shows "Failed" instead of `?` (stored, migration `_109`; an ACK within
  30 s still flips it to delivered). A Retry row action sends a new copy that
  replaces the failed bubble (`POST /api/messages/direct/{id}/resend`).

Direction still on the roadmap (planned, not yet built):

- Historical device-info persistence: location and device-config history over time.
- Multi-radio identity continuity, so a swapped or replaced feeding radio stays
  coherent in the long-lived record.

This is a direction, not a finished feature set: the items above are planned,
not yet implemented.

## Requirements

- Python 3.11+
- Node.js LTS or current (20, 22, 24, 25) if you're not using a prebuilt release
- [UV](https://astral.sh/uv) package manager: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- MeshCore radio connected via USB serial, TCP, or BLE

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

## Install Path 1: Clone And Build

**This approach is recommended over Docker due to intermittent serial communications issues I've seen on \*nix systems.**

```bash
git clone https://github.com/Elektr0Vodka/RTFM-EV.git
cd RTFM-EV

uv sync
cd frontend && npm install && npm run build && cd ..

uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Access the app at http://localhost:8000. Once the backend is running, the interactive API docs are available at http://localhost:8000/docs.

Source checkouts expect a normal frontend build in `frontend/dist`.

> [!TIP]
> Running on lightweight hardware, or just don't want to build the frontend locally? From a cloned checkout, run `python3 scripts/setup/fetch_prebuilt_frontend.py` to fetch and unpack a prebuilt frontend into `frontend/prebuilt`, then start the app normally with `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000`.

> [!NOTE]
> On Linux, you can also install RemoteTerm as a persistent `systemd` service that starts on boot and restarts automatically on failure:
>
> ```bash
> bash scripts/setup/install_service.sh
> ```
>
> For the full service workflow and post-install operations, see [README_ADVANCED.md](README_ADVANCED.md).

### Upgrading a source checkout

To upgrade an existing clone, stop the app, pull, refresh dependencies, and rebuild the frontend:

```bash
# If you run it as a systemd service (see above), stop it first:
sudo systemctl stop remoteterm

cd RTFM-EV
git pull
uv sync
cd frontend && npm install && npm run build && cd ..

# Restart the service (or re-run uvicorn manually if you don't use systemd):
sudo systemctl start remoteterm
```

> [!IMPORTANT]
> `git pull` alone is not enough. The browser loads the compiled frontend from `frontend/dist`, which is gitignored and only regenerated by `npm run build`, and `uv sync` picks up backend dependency changes. Skipping the rebuild leaves you on the old UI even though the source is up to date.

## Install Path 2: Docker

> **Warning:** Docker has had reports intermittent issues with serial event subscriptions. The native method above is more reliable.

Local Docker builds are architecture-native by default. On Apple Silicon Macs and ARM64 Linux hosts such as Raspberry Pi, `docker compose build` / `docker compose up --build` will produce an ARM64 image unless you override the platform.

For serial-device passthrough, use rootful Docker. In practice that usually means starting the stack with `sudo docker compose ...` unless your Docker daemon is already configured for rootful access via your user/group. Rootless Docker has been observed to fail on serial-device mappings even when the compose file itself is correct.

Create a local `docker-compose.yml` in one of two ways:

1. Copy the example file and edit it by hand:

```bash
cp docker-compose.example.yml docker-compose.yml
```

2. Or generate one interactively:

```bash
bash scripts/setup/install_docker.sh
```

> The interactive generator enables a self-signed (snakeoil) TLS certificate by default. If you accept the default, the app will be served over HTTPS and the generated compose file will include certificate mounts and an SSL command override. Decline if you prefer plain HTTP or plan to terminate TLS externally.

Your local `docker-compose.yml` is gitignored so future pulls don't overwrite your Docker settings.

The guided Docker flow can collect BLE settings, but BLE access from Docker still needs manual compose customization such as Bluetooth passthrough and possibly privileged mode or host networking. If you want the simpler path for BLE, use the regular Python launch flow instead.

Then customize the local compose file for your transport and launch:

```bash
sudo docker compose up # add -d for background once you validate it's working
```

The database is stored in `./data/` (bind-mounted), so the container shares the same database as the native app.

To rebuild after pulling updates:

```bash
sudo docker compose pull
sudo docker compose up -d
```

> If you switched to a local build (`build: .` instead of `image:`), use `sudo docker compose up -d --build` instead - `pull` only fetches remote images.

The example file and setup script default to the published GHCR image (`ghcr.io/elektr0vodka/rtfm-ev:latest`), rebuilt automatically on every push to `main`. To build locally from your checkout instead, replace:

```yaml
image: ghcr.io/elektr0vodka/rtfm-ev:latest
```

with:

```yaml
build: .
```

Then run:

```bash
sudo docker compose up -d --build
```

The container runs as root by default for maximum serial passthrough compatibility across host setups. On Linux, if you switch between native and Docker runs, `./data` can end up root-owned. If you do not need that serial compatibility behavior, you can enable the optional `user: "${UID:-1000}:${GID:-1000}"` line in `docker-compose.yml` to keep ownership aligned with your host user.

To stop:

```bash
sudo docker compose down
```

## Install Path 3: Arch Linux (AUR)

A [`rtfm-ev`](https://aur.archlinux.org/packages/rtfm-ev) package is available in the AUR. Install it with an AUR helper or build it manually:

```bash
# with an AUR helper
yay -S rtfm-ev

# or manually
git clone https://aur.archlinux.org/rtfm-ev.git
cd rtfm-ev
makepkg -si
```

Configure your radio connection, then start the service:

```bash
sudo vi /etc/rtfm-ev/remoteterm.env
sudo systemctl enable --now rtfm-ev
```

Access the app at http://localhost:8000.

## Standard Environment Variables

Only one transport may be active at a time. If multiple are set, the server will refuse to start.

| Variable | Default | Description |
|----------|---------|-------------|
| `MESHCORE_SERIAL_PORT` | (auto-detect) | Serial port path |
| `MESHCORE_SERIAL_BAUDRATE` | 115200 | Serial baud rate |
| `MESHCORE_TCP_HOST` | | TCP host (mutually exclusive with serial/BLE) |
| `MESHCORE_TCP_PORT` | 5000 | TCP port |
| `MESHCORE_BLE_ADDRESS` | | BLE device address (mutually exclusive with serial/TCP) |
| `MESHCORE_BLE_PIN` | | BLE PIN (required when BLE address is set) |
| `MESHCORE_LOG_LEVEL` | INFO | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `MESHCORE_DATABASE_PATH` | `data/meshcore.db` | SQLite database path |
| `MESHCORE_DISABLE_BOTS` | false | Disable bot system entirely (blocks execution and config; an intermediate security precaution, but not as good as basic auth) |
| `MESHCORE_BASIC_AUTH_USERNAME` | | Optional app-wide HTTP Basic auth username; must be set together with `MESHCORE_BASIC_AUTH_PASSWORD` |
| `MESHCORE_BASIC_AUTH_PASSWORD` | | Optional app-wide HTTP Basic auth password; must be set together with `MESHCORE_BASIC_AUTH_USERNAME` |
| `MESHCORE_VAPID_SUBJECT` | `mailto:noreply@meshcore.local` | Subject (`sub`) claim for Web Push VAPID tokens; must be a `mailto:` or `https:` contact. Apple's push service rejects the default `.local` domain, so iOS/Safari users must set this to a real address (e.g. `mailto:you@example.com`). |
| `MESHCORE_HOST_REPEATER_ENABLED` | false | Server switch (env half) for the host repeater's armed mode (live forwarding). Arming also needs the admin switch in Settings > Host repeater and a confirmation; shadow mode never transmits and does not need this ([docs](#host-repeater-shadow-and-armed-mode)). |
| `MESHCORE_UPDATE_CHECK_ENABLED` | true | Check GitHub for a newer fork build and show an in-app update indicator. Set `false` to disable the outbound request (air-gapped / privacy-conscious setups). |

Common launch patterns:

```bash
# Serial (explicit port)
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
> **Windows + MQTT fanout:** Python's default Windows event loop (ProactorEventLoop) is not compatible with the MQTT libraries used by RemoteTerm. If you configure any MQTT integration, add `--loop none` to your uvicorn command:
>
> ```powershell
> uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --loop none
> ```
>
> If you forget, the app will start normally but MQTT connections will fail and you'll see a toast in the UI with this same guidance.

If you enable Basic Auth, protect the app with HTTPS. HTTP Basic credentials are not safe on plain HTTP. Also note that the app's permissive CORS policy is a deliberate trusted-network tradeoff, so cross-origin browser JavaScript is not a reliable way to use that Basic Auth gate.

## Meshcomod (DMC-EV) firmware

RemoteTerm supports the [meshcomod](https://github.com/Elektr0Vodka/meshcomod) fork (DMC / DMC-EV), a multi-transport companion firmware for Heltec and Seeed LoRa devices. When a connected radio is detected as running meshcomod, an extra **Meshcomod (DMC-EV)** panel appears under **Settings -> Radio** with controls the stock firmware does not expose:

- **CAD (Channel Activity Detection):** scan for channel activity before each transmit and defer if the channel is busy. Requires CAD-capable meshcomod firmware.
- **GPS:** enable the on-board GPS receiver and set its reporting interval (0 to 86400 seconds).

The panel is hidden entirely on non-meshcomod devices, and each control disables itself if the specific firmware build does not advertise support. No configuration is needed: detection is automatic from the radio's device info.

GPS is also available on **stock** MeshCore companion firmware builds: the `gps` custom var is part of the base companion protocol (gated by the firmware's own GPS build flag and physical GPS detection), not a meshcomod-only extra. Any connected radio that reports the var shows a standalone GPS section under **Settings -> Radio** (hidden on meshcomod radios, which keep the combined control above instead of showing GPS twice).

## OpenHop node management

RTFM-EV works with [OpenHop](https://github.com/openhop-dev/openhop_repeater) repeaters and room-servers (a Python MeshCore daemon) in two ways:

- **As a radio.** OpenHop speaks the MeshCore companion protocol over TCP (default port 5000), so it can drive RTFM-EV as the connected radio with no OpenHop-specific setup: point the app at its host and port like any other TCP radio.
- **As a managed node.** When a connected node is detected as OpenHop, an extra **OpenHop** section appears with management panes that the companion link and RF do not expose, organised in a two-row sub-nav: a **Node** row (Config, System, Update, CAD) and a **Mesh** row (Policy, Plugins, Transport keys, MQTT). These talk to OpenHop's REST API, so set the API URL and token in the OpenHop block under **Settings -> Radio** first (the token is write-only). Actions with real-world effect (firmware install, CAD threshold save, transport-key delete, MQTT config writes, "publish neighbours now") are confirmation-gated. With the API configured, the My Node airtime chart also reads TX/RX airtime from OpenHop's REST API, because OpenHop's companion stats frame always reports RX airtime as 0.

As with the Meshcomod panel, everything is hidden on non-OpenHop devices and detection is automatic from the radio's device info.

## Host repeater (shadow and armed mode)

RTFM-EV can judge every packet its radio receives the way a repeater would, like OpenHop does for its own radio: MeshCore forwarding rules, the repeater's `flood.max` / region / loop settings, the DMC packet filter, DMC duty-cycle region gating and OpenHop-style policy rules. Enable **Shadow mode** under **Settings -> Host repeater** to see what it would forward or drop, how long the host took, and how much airtime the forwards would use.

Like the repeater firmware, only region-scoped floods for a region in the host repeater's region list are forwarded. An empty list is pre-filled with the radio's flood scopes; you can also import a repeater's region tree (this sends a request over RF, after a confirmation). Region gating (off by default) closes regions from the outside in when too much of the airtime budget is in use, keeping the deepest layer and the home region open. Shadow mode never transmits; live repeating is not available yet. Firmware client repeat must stay off. On OpenHop radios the option is disabled because OpenHop repeats packets itself.

**Armed mode (live forwarding).** Once shadow data looks right, RTFM-EV can forward for real. Arming needs all of: the server switch `MESHCORE_HOST_REPEATER_ENABLED=true` (env), the admin switch in Settings > Host repeater, a connected radio with firmware raw send (companion v1.16+ / ver code 13), firmware client repeat off, a non-OpenHop radio, an EU sub-band whose duty-cycle limit is at least the configured minimum (1 % by default), and an explicit confirmation in the browser. Forwards are held on the host until their random retransmit delay has passed, sent with the raw-packet command at MeshCore priorities, and never block your own sends (they take the radio lock non-blocking and give up at their latency deadline). The repeater disarms itself when the radio disconnects (opt-in re-arm on reconnect), when firmware client repeat is found on, when the radio's frequency, modulation or identity changes, when raw sends keep failing, when the radio's measured TX airtime over the last hour exceeds the sub-band limit, or when the forward queue is stuck; **Disarm** in Settings and `POST /api/radio/host-repeater/disarm` are the kill switch. It always comes up disarmed after a server restart, and a **Repeating** badge shows in the top bar of every browser while it is armed. Stock companion firmware only allows client repeat on off-grid frequencies; this forwards on the main mesh frequency instead, like an OpenHop repeater, so make sure you are allowed to operate a repeater where you are.

**Tuning.** Under Timing, **Score-based receive delay** is the repeater's `rxdelay` (off by default): a weakly received flood is held `(base ^ (0.85 - score) - 1) x airtime` before it is judged, so a copy relayed by a neighbour with better reception is judged first and the held copy is dropped as a duplicate, the way the firmware's delayed inbound queue works (the score is the firmware's SNR and length based reception score; the stock repeater uses base 10 when it is on). **Shorter retransmit delay for strong receptions** is OpenHop's `use_score_for_tx`. **Advert limiter (per node)** is an OpenHop-style token bucket per advertising node with a minimum interval between two adverts of the same node, checked after every other rule. The statistics pane also keeps **Lifetime totals** that survive server restarts (saved about once a minute and at shutdown, with their own reset); the session counters above them still reset on restart.

## Languages

The interface is available in English (default), Dutch, and German. Pick a
language under **Settings -> Local**; the choice is saved per browser. Untranslated
strings fall back to English, so partial translations never break the UI.

The internationalization approach and portions of the Dutch and German
translation strings are adapted from
[kiekr-i18n](https://github.com/marcelverdult/kiekr-i18n) by Marcel Verdult
([@marcelverdult](https://github.com/marcelverdult)), licensed under CC-BY 4.0.

## Where To Go Next

- Advanced setup, troubleshooting, HTTPS, systemd, remediation variables, and debug logging: [README_ADVANCED.md](README_ADVANCED.md)
- Home Assistant-specific guidance and entity/sensor naming schemes: [README_HA.md](README_HA.md)
- Contributing, tests, linting, E2E notes, and important AGENTS files: [CONTRIBUTING.md](CONTRIBUTING.md)
- Live API docs after the backend is running: http://localhost:8000/docs

## Disclaimer

This is developed with very heavy agentic assistance -- there is no warranty of fitness for any purpose. It's been lovingly guided by an engineer with a passion for clean code and good tests, but it's still mostly LLM output, so you may find some bugs.

If extending, have your LLM read the three `AGENTS.md` files: `./AGENTS.md`, `./frontend/AGENTS.md`, and `./app/AGENTS.md`.
