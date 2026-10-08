<!-- id: overview -->

## Overview

RTFM-EV is a web interface for MeshCore mesh radios. A small server connects to your companion radio (over Serial, TCP or BLE) and you use it from any browser on your network. It is a fork of RemoteTerm that keeps everything RemoteTerm does as a live terminal for a radio, and adds a longer memory: the server database is the system of record, so a radio that stays connected builds up a local history of the mesh that you can browse and analyze.

What you can do with it:

- Send and receive direct messages and channel messages, with reactions, replies, emoji and location sharing.
- Keep more contacts and channels than the radio can hold. Packets are decrypted on the server, so radio limits do not apply to what you can monitor.
- Manage repeaters and room servers from a dashboard.
- Explore the mesh with a map, a packet visualizer, health and trend views, and a searchable packet history.
- Forward data to MQTT, Home Assistant, webhooks and more.

Two things to know before you start:

- **The app manages your radio.** Once a radio is connected, its contacts and channels are imported into the app, and the app decides which contacts stay loaded on the radio. This makes it a poor fit if you swap radios in and out and want each radio to keep its own state. Only battery, noise floor and airtime history is kept per radio (see Swapping radios).
- **Use it on a trusted network only.** There are no user accounts. Anyone who can reach the page can use it. Optional HTTP Basic auth is only a coarse gate and must be paired with HTTPS.

<!-- id: getting-started -->

## Getting started

### Connecting your radio

The server connects to one radio over exactly one transport. You choose it with environment variables when you start the server:

- **Serial (USB):** `MESHCORE_SERIAL_PORT`. `MESHCORE_SERIAL_BAUDRATE` defaults to 115200.
- **TCP:** `MESHCORE_TCP_HOST` and `MESHCORE_TCP_PORT` (default 5000).
- **BLE:** `MESHCORE_BLE_ADDRESS` and `MESHCORE_BLE_PIN` (the PIN is required with BLE).

If you set none of these, the server looks for a radio on the serial ports by itself. If you set more than one transport, the server refuses to start.

Open the app at `http://localhost:8000` (or the host and port where the server runs). The top bar shows whether the radio is connected.

Notes:

- If you use any MQTT integration on Windows, start the server with `--loop none`, or MQTT connections will fail.
- Web Push and the Channel Finder need HTTPS when you are not on `localhost`.
- Docker is supported, but running natively is recommended because serial problems have been reported in containers.

### First run

On the first connection the app imports the radio's contacts and channels and starts storing every packet it hears. Messages arrive in real time. Contacts appear as their adverts are heard, so give it a few minutes on a busy mesh.

Good first steps:

1. Open **Settings > Radio** and check the name, radio parameters and location.
2. Add the channels you use (see Messaging).
3. Open **Node Map** and **Mesh Health** once some traffic has been heard.

### Swapping radios

The app remembers every radio that has connected to it. Battery, noise floor and airtime history is stored per radio, so two radios are never blended into one chart. Contacts, channels, packets and messages are shared by all radios.

When a radio connects that this install has not seen before, a prompt asks **A different radio is connected**. Choose **This is a new radio**, or **This replaces an earlier radio** and pick the old one under **Replaces**. A replacement can carry over the **Battery, noise floor and airtime history**, the **Owned nodes** and the **Note** of the earlier radio. Nothing is moved or deleted, and you can change or undo it later under Settings > Radio > Radios. **Decide later** hides the prompt for this browser session. The radio keeps working while you decide.

History recorded before radios were tracked is assigned to the connected radio automatically when the app can tell it is that radio's. Otherwise it asks once, **Whose history is this?**: **Yes, it belongs to this radio**, or **No, keep it separate**. Separate history stays available on My Node as **Before radio tracking**.

### Language and theme

The interface is available in English, Dutch and German. Switch language with the language menu in the top bar (flag and language code) or under **Settings > Local Configuration**. The choice is saved per browser. The sun or moon icon in the top bar opens the theme picker.

The **Windows 95** theme comes with a **Desktop buddy**: Clippy shows up when you pick that theme, until you choose another buddy (Merlin, Bonzi, F1, Genie, Genius, Links, Peedy, Rocky, Rover or one of 26 more, such as Mother Nature, Courtney, Earl or Santa) or **Off** under **Settings > Local Configuration** (below the theme picker) or in the theme dialog from the sun or moon icon. Once you have used Windows 95, the same setting is offered on every theme; other themes start with **Off**, and a buddy you pick there shows on all themes. The buddy stays on screen while you navigate and tells you about new nodes, low batteries (your radio and nodes with telemetry from the last 24 hours, below the threshold you set; nodes set to mains power are skipped), direct messages and @mentions, radio disconnects and available updates. It also gives a short tip the first time you open a page. Click the speech balloon to open what it is talking about. Drag the buddy to move it (the spot is remembered per browser), double-click it for a trick, and right-click it to send it away until you reload the page. With a CRT theme the buddy takes on the phosphor colour and follows the CRT screen effects (scanlines, glow, curvature and flicker). Each buddy's images are only downloaded when you pick it, and it plays no sounds.

<!-- id: layout -->

## The layout

### Top bar

From left to right the top bar shows the app name, the connection status dot, a **Repeating** badge while the host repeater is armed, and the radio battery when you enable it in **Settings > Local Configuration**. On wide screens it also shows a live packet rate graph, the connection status text, and the radio name with its short public key (click the key to copy the full key). When the radio is disconnected or paused, a **Reconnect** or **Connect** button appears. Then come the **Chat window** button (opens the chat-only window, see below), the **Settings** button (a dot on it means a newer build is available), the language menu and the theme button.

On narrow screens a menu button at the far left opens the sidebar.

### Sidebar

The sidebar is the main navigation. Its sections, in default order:

- **Tools:** the analysis and utility views (see Tools).
- **Favorites:** favorite channels and contacts, split into Favorite Channels, Favorite Companions, Favorite Repeaters, Favorite Room Servers and Favorite Sensors.
- **Owned:** contacts whose owner is your own radio, or a radio it replaced when that link carries **Owned nodes**. Only shown when there is at least one.
- **Channels:** your channels. An icon next to the heading opens channel import and export.
- **Contacts:** all contacts, with filter pills for All, Companions, Sensors, Repeaters and Room Servers.
- Any **Contact Groups** you create.

Each section collapses and expands. Sort buttons on the headers switch between recent activity and alphabetical order. Unread counts and mention markers show on rows, and **Mark all as read** clears them all. The search box filters channels and contacts by name. The sidebar can collapse to a narrow icon rail.

**Add Channel/Contact** at the top opens the New Conversation dialog.

### Customize the sidebar

The **Customize sidebar** button (next to Add Channel/Contact) lets you:

- Reorder sections, tools and favorite groups (Section Order, Tool Order, Favorites Order).
- Hide a section or tool (**Hide from sidebar** / **Show in sidebar**).
- Create **Contact Groups**. A group becomes its own sidebar section. You add items to groups from the contact or channel info pane, and an item can be in several groups. Deleting a group keeps its contacts and channels.
- **Reset to defaults**.

### Command palette

Press Ctrl+K (Cmd+K on macOS) to open the command palette and jump to conversations, settings and tools by typing.

### Conversation pane

The large area on the right shows what you selected: a chat, a contact page, a repeater dashboard or a tool. The browser address follows the view (for example `#map` or `#settings/radio`), so you can bookmark views. With **Reopen Last Conversation** on (Settings > Local Configuration), loading the bare address reopens your last chat.

### Chat window

The **Chat window** button in the top bar opens a separate, lighter window that only does messaging, laid out like a classic IRC client: conversations on the left, the chat in the middle and the recent senders of that chat on the right. It runs on its own, so you can close the main tab and keep only this window. It does not load the map, the packet feed or the other tools, and it asks the server to leave out the raw packet stream.

Everything in a chat works as in the main app: the chat header buttons, message actions, the composer, room login, contact and channel info, **New** (start a conversation or add a channel) and **Search**. Anything that is not a chat (the map, the Channel Registry, a repeater dashboard, Settings) opens in the main app instead.

The toolbar has these extras:

- **Lines / Bubbles:** classic lines (`[time] <Name> text`) or the regular message bubbles. In lines, click a name to mention that sender and the small dot in front of it to open their contact info.
- **Skin:** **mIRC**, **mIRC dark**, or **App theme** to follow the theme chosen in the main app.
- **Detach:** opens the current chat in a small window of its own.
- **Main app:** opens the full app on the same conversation.

Skin and layout are saved per browser. While a main tab is open, the chat window leaves the mention sound and browser notifications to that tab, so nothing sounds twice. The right-hand list shows who has spoken in the loaded messages; MeshCore channels have no member list.

<!-- id: messaging -->

## Messaging

### Starting conversations

Click **Add Channel/Contact**. The dialog has these tabs:

- **Contact:** enter a name, the 64-character hex public key, and a type.
- **Contact link:** paste a `meshcore://` link from another MeshCore client. The advert signature is checked before the contact is imported. Nothing is transmitted.
- **Private Channel:** enter a name and a 32-character hex key, or generate a random key.
- **Hashtag Channel:** join a public hashtag channel. Its key is derived from the channel name, so everyone who types the same name gets the same channel.
- **Bulk Add Channel:** paste several hashtag channel names (one per line, or separated by spaces or commas). This tab only appears when you hold Alt (Option on macOS) while clicking Add Channel/Contact.

Channel names are limited to 32 bytes including the `#`. By default names are normalized to lowercase letters, numbers and dashes. Turn on **Permit capitals, whitespace, and extended characters** to hash the name exactly as typed, which matches other MeshCore clients. When stored packets could not be decrypted yet, the dialog offers to try the new key on them.

### Communities and import/export

The icon next to the Channels heading opens **Channel Import / Export**. Export saves your channels as a text file, one per line, and Import reads such a file. The **Communities** tab lets you join a meshcore-open community by pasting its code or scanning its QR code (camera or image). Community channels use keys derived from the shared secret, so they work with meshcore-open. Camera scanning needs HTTPS or `localhost`.

### Reading and sending

- Type in the message box and send. For 30 seconds after sending a channel message you can resend it. Direct messages that get no acknowledgement after all retries show **Failed**.
- The **Emoji picker** has search, recent emoji and skin tones. It shows each emoji's byte cost, since messages are size limited.
- Messages the radio would likely truncate, or that may not survive several repeaters, are flagged under the input.
- Messages show their hop count, and with **Show Path Hop Width** on, the width of each hop identifier. Click a message's path to see its route and any echoes that were heard.
- SMAZ-compressed messages from other clients are shown decoded. Images sent by meshcore-open appear as an "Image (not supported)" placeholder.
- Scope badges show whether a channel message was heard Direct (0 hops), Unscoped (plain flood) or region scoped.

### Message actions

Hover a message for **React**, **Reply**, **Mark unread from here** (stored on the server, so every browser sees it), **Delete**, and **Retry** for failed direct messages.

- Reactions and replies use the plain text format other MeshCore clients understand. A received reaction shows which message it belongs to.
- **Delete** removes the message from your local history only. Nothing is sent, and other clients keep their copy.

### Mentions

When someone mentions your name in a channel you are not viewing, it appears in the mention ticker (turn it on with **Show Mention Ticker** in Settings > Radio). Click an entry to jump to the message. Hashtag channels named in messages can be added to the Channel Registry automatically with **Auto-add mentioned channels to registry**.

### Sharing location and contacts

- The location button (pin icon) in the chat header inserts your radio location, the location of this node, or a spot you pick on a map.
- A contact tag in a message shows as a chip with **Add contact**. **Copy share tag** in a contact's info copies a tag you can paste.
- Under **Chat parsing** in Settings > Local Configuration you can turn on clickable links, link previews (the server fetches the linked page), public key detection and coordinate detection.

### Per-conversation options

The bell in the chat header opens notification settings: alerts while the tab is open, Web Push alerts when the browser is closed (needs HTTPS), muting the mention sound, and **Mute channel**. **Filter messages** hides messages by hop size. Other header controls include the favorite toggle, a region override, Path Discovery and Direct Trace.

<!-- id: contacts-nodes -->

## Contacts and nodes

### Contact info

Click an avatar or name to open a contact's info. On desktop it is a full page in three columns (Identity & actions, Your data & telemetry, Network & activity). On a phone it opens as a side sheet. It shows, among other things:

- Type, public key, last heard, distance, hops and route.
- **Message routes (scored):** the routes your direct messages used, ranked by delivery and speed. Display only.
- **Positions** over time, **Recent Advert Paths**, and the nearest repeaters by hops and by distance.
- **Also Known As** when a contact has used several names.
- Notes, owner info, a manual fallback location, a battery chemistry override and a power source override (Auto detects it from the name), all saved on the server.
- **Radio residency:** Auto, Pin (always keep on the radio) or App only (never put on the radio).
- **Telemetry sharing:** what your radio shares when this contact asks for telemetry.
- **Contact link:** show or copy a `meshcore://` link.
- **Resolve name from analyzer** for contacts known only by public key. Only that key is sent to the site.
- Look-up links for configured analyzers, **Triangulate**, and blocking the key or name.

Favorite contacts stay loaded on the radio so it can acknowledge their direct messages.

### Routing override

Click the route label next to a contact's name (for example the hop count or "flood") to open **Routing Override**. You can force flood, force direct, or enter an explicit path of comma-separated 1, 2 or 3 byte hop IDs. Clear the override to go back to the learned route. The last retry of an unacknowledged direct message is always sent as flood.

### Repeaters

Opening a repeater shows a login form: log in with the password or as a guest. The dashboard then has panes for Node Info, Telemetry, Radio Settings (with advert intervals), LPP Sensors, Neighbors, ACL, Regions and Owner Info, plus Actions (Zero Hop Advert, Flood Advert, Sync Clock, Reboot), a Console with CLI access, telemetry history and a History pane that shows what changed between stored snapshots. **Load All** fetches every pane one after another.

The Settings Editor changes one repeater setting at a time: you edit, confirm the exact CLI command, it is sent over RF, and the value is read back to check it. Changing frequency, bandwidth, spreading factor or coding rate requires typing the repeater name first, because a wrong value can take it off the air. The Observer firmware group (SNMP agent on/off) only works on DMC observer and agessaman observer firmware: use its own Read button first, and reboot the repeater after a change.

Repeaters and room servers on observer firmware can also be read over your network. On the contact page, the **SNMP (LAN)** card takes the node's IP address, port and community; **Poll now** then shows radio, MQTT, memory and WiFi values without using RF. SNMP must be on on the node (Observer firmware group in the Settings Editor, then reboot) and the server must be able to reach it over UDP. Turn on **Poll on a schedule** to have the server poll the node every few minutes and keep the results; the card then shows a history chart for the value and range you pick. If the Home Assistant integration tracks the repeater, the values also appear there as SNMP sensors. **Ask node for its address** sends one command over RF to look up the IP and needs an admin login. The **SNMP** page under Tools shows all nodes with SNMP set up side by side.

### Room servers

Room servers also have a password or guest login, with telemetry, ACL, sensor data, a CLI console and a history of ACL changes.

### Telemetry

- On a non-repeater contact, **Request** fetches its sensor readings on demand, with history charts.
- **Settings > Radio-App Management** lets you track repeaters and up to 8 other contacts for scheduled collection. To limit mesh traffic, all tracking shares a cap of 24 checks per day, so more tracked nodes means a longer interval.

### Paths

- **Path Discovery** (chat header) sends a routed probe and shows the forward and return paths, and stores the learned route.
- **Direct Trace** sends a trace to a contact and shows the SNR out and back.
- Both transmit over RF and need the contact's full key.

<!-- id: map -->

## Map

Open **Node Map** from Tools. It shows nodes with an advertised or manual location. Opening the map from a contact, the Mesh Health map button or a `#map/focus/...` link centers on that node.

### Controls

The map controls are grouped under **Display**, **Size & colors**, **Filters** and **Overlays**.

- **Display:** basemap (Nova dark, OpenFreeMap, OpenStreetMap, OpenTopoMap and Esri layers), 2D or 3D with tilt and 3D buildings, labels (off, name or ID tag) and a legend. Fullscreen and **Export GPX** (the nodes currently shown, as waypoints) are also here.
- **Size & colors:** node size, equal node sizes, neon nodes and a color per node role.
- **Filters:** **Since** (a preset or custom time range), **Heard by server** (all, hide never-heard, or only never-heard), **Node roles**, **Power source** (the override set on the contact, else the power icon in the node name: ⚡/🔌 mains, 🔋 battery, ☀️/🌞/🔆 or the word "solar" for solar, both for solar + battery, no icon is Unknown; nodes named "DTIS | ..." are solar + battery), **Analyzer nodes** and **Hide nodes reporting wrong location** (at 0,0 or more than 300 km from the nearest node that heard them).

**Overlays** are off until you turn them on, and are remembered per browser:

- **Visualize packets** (see below).
- **Links** between nodes, from liveness, advert paths or all traffic, with a confidence level, a maximum distance and an age window. Click a link and then **Details** for its traffic and signal history.
- **Telemetry (battery/temp)**.
- **Shared locations:** pins for locations sent in chat. Click one for who shared it and **Open in chat**.
- **Beacons:** positions, waypoints and routes sent by MeshCore TEAM and signalk-meshcore in channels you follow. Each sender's newest position is a pin with an icon for the kind of sender (boat, autonomous radio or person), and waypoints carry their TEAM type icon; switch on **Trails** to draw its track over the time window. Click a pin for batteries, status and **Open in chat**. A contact that sent such beacons also gets a **Beacon history** section in its contact info.
- **Sending in TEAM format:** in a private channel, **Share location > Pick on map** can insert a MeshCore TEAM waypoint instead of a location marker. **Settings > Radio-App Management > MeshCore TEAM beacon** can send this radio's position as a TEAM beacon on one private channel at a set interval. It is off by default and transmits on the radio each time. To give a boat its own map icon, set **Vessel type** in its contact info.
- **Guessed locations:** estimated positions for nodes without a location, shown as hollow markers at every zoom, labelled per the map's Labels setting. Never saved or sent.
- **Relay signal:** rings around relays that passed flooded packets to your radio, colored by average SNR.

**Analyzer nodes** shows nodes from an external analyzer directory. The directory is only filled when **External analyzer node overlay** is turned on and synced in Settings > Radio.

### Visualize packets

Turn on **Visualize packets** to watch packets travel across the map as animated arcs and pulses. A playback bar lets you play, pause, change speed, seek and return to live. You can tune pulses, glow, arc width and trail fade, and turn on the **Geiger sound**. The same panel has **Discover nodes**, a passive filter that shows only nodes heard in live packets since you turned it on. It transmits nothing.

### Start view and popups

**Settings > Map** sets where the map opens: fit all nodes, a fixed home location and zoom, or your last position. Click a node for details, telemetry, a link to open the conversation, **Message owner**, **Triangulate** and **Details**.

<!-- id: tools -->

## Tools

The Tools section of the sidebar holds these views. You can reorder or hide them with Customize sidebar.

### My Node

Statistics about your own radio: radio details (frequency, bandwidth, model, firmware) and charts over a time range you choose, from 20 minutes to a year or a custom range. Charts include packets and bytes, RSSI and SNR with the noise floor, **Airtime utilization**, **Receive errors**, nodes heard, neighbors, path hash width, busiest channels, and the **Directly heard radar**, which plots nodes heard at 0 hops by bearing and distance. Charts zoom with the scroll wheel, pan by dragging and reset on double-click.

The battery, noise floor and airtime charts show the current radio plus the history it inherited from a radio it replaced. When there is more than one radio, or history from before radio tracking, a **Radio** picker appears next to the time range: **Current radio**, one specific radio (with what that radio inherited), or **Before radio tracking**.

### Mesh Health

- **Adverts:** direct and flood advert counts per contact, a searchable contacts table, hop and hash mode charts, an activity heatmap, and alerts for nodes that advertise too often (flood adverts only).
- **Requests:** request and response traffic this node has heard.
- **Prefix Collisions:** contacts that share a 1, 2 or 3 byte public key prefix. Shared prefixes make hops ambiguous.
- **Relay reception:** for flooded packets heard more than once, which relay delivered each copy and with what signal. The totals and the per-relay table cover the whole window, with no row limit. The per-relay table also shows how often a relay's copy arrived first and how many packets you heard only through it. Expand a relay (the arrow before its name) for its activity and signal over time, packet types, hop counts and recent copies. The per-packet table pages through stored copies; pick the rows per page below it. Stored copies are kept 2 days by default; before that they are folded into an hourly per-relay history (kept 365 days by default, **Relay history, hourly** under Data retention), so windows longer than the stored copies still show per-relay totals and charts.
- **Power Outage:** which nodes would stay online when the grid goes down, based on each node's power source (the contact override, else the power icon in the name; DTIS nodes are solar + battery). Battery and solar nodes stay online; mains and unknown nodes go dark (unknown counts as mains). Shows the share that survives, the power source mix, and the islands the surviving nodes form over heard advert-path links (only between nodes with a location), so you can see where the mesh would split. Choose repeaters + rooms or all nodes, and how recently they were heard. Click a column header to sort the node table; the table is paged by the same **Show max rows** setting as the Adverts table, and a go-to-top button appears once you scroll down.

### Mesh Trends

**Historical** shows stored breakdowns: Network, Messages, Activity, busiest channels, packets per hour, path hash width, region scope, noise floor and MQTT broker stats. **Live · this session** shows packet statistics. Its short windows (1, 5 and 10 minutes, and this session) come from your browser; longer windows are computed from the database.

### Mesh Discovery

**Discover Repeaters**, **Discover Sensors** or **Discover Both** sends a short discovery request over RF and lists the nodes that answer. **Discover Regions** asks nearby repeaters which regions they flood, so you can add them to your known regions.

### SNMP

Every node that has SNMP set up on its contact page, in one table. Each row shows the status, name, address, schedule, last good poll and last error, with the main values side by side: firmware version, uptime, free heap, largest free block, connected MQTT slots, packet queue depth, WiFi RSSI, noise floor, receive errors, last RSSI and last SNR. A node whose last poll failed is marked **Failing** in red and listed first; its values are then those of the last good poll. Click a column header to sort.

Click the arrow in front of a row for all 22 values of that node, grouped, and its history chart. **Poll now** reads one node and **Poll all now** reads them one after the other. Polling goes over your network (UDP) and never uses RF. **Auto refresh** only re-reads what the server has stored, every 10, 30 or 60 seconds, or not at all. How often a node is polled is set with **Poll on a schedule** on its contact page. Click a node's name to open that page.

### Packet Feed

A live list of every packet the radio hears. It has **Filters** (packet type and path width), pause and resume, autoscroll, oldest or newest first, **Group repeats by content**, a hex filter, **Show Stats**, and an optional sound per packet (Geiger, Sonar or Water drip). Click a packet for its byte-by-byte breakdown.

### Packet History

The same kind of list over everything stored in the database. Pick 1, 3, 6, 12 or 24 hours or a date range, then **Load older** to page back. Filter by payload type, hop width or hex, and search message text, sender or channel. Select rows and **Export CSV**. How far back it reaches depends on your data retention settings.

### Analyze Packet

Paste a raw packet as hex to see it decoded byte by byte.

### Mesh Visualizer

A 3D graph of the mesh built from live packets. Nodes are spheres and packets are animated arcs. Controls tune which nodes are shown and how the graph moves, and **Clear & Reset** starts over.

### Trace

Build a loop of repeaters and trace it back to your radio. Search repeaters by name or key and add them in the order to traverse, or add a custom hop as a 1, 2 or 4 byte prefix. Then **Send trace**. Results show the SNR per hop and a small map. This transmits over RF.

### Message Search

Full-text search across direct and channel messages. Use `user:` or `channel:` to narrow results (put names with spaces in quotes). Click a result to jump to that message.

### Channel Registry

A local catalog of known channels. It is a reference list, not the channels the app monitors. You can add, edit, filter, import and export entries, sync from a remote list, and use **Add to Channels** to start monitoring one. Private entries are never exported. In a channel, the registry icon in the header (or **Edit in Channel Registry** in the channel info panel) opens that channel's entry straight in edit mode, adding it first if it is missing.

### Channel Finder

**Show Channel Finder** opens a panel that tries to find the names of channels you have no key for, using wordlists and brute force on your GPU. It needs a browser with WebGPU (for example Chrome or Edge 113 or newer) and HTTPS when you are not on `localhost`. Found channels can decrypt stored packets.

### Knowledge base

Your own list of handy links, grouped by category. **Add link** creates a new one; the X removes a link from the Knowledge base but keeps it in Settings > Handy Info > Links. There, the book icon on any link (built-in or your own) adds it to or removes it from the Knowledge base.

### User Guide

This page. Open it from Tools or with the `#manual` address. It follows the interface language. Click a heading in the contents list to jump to that section.

<!-- id: settings -->

## Settings

Open Settings with the button in the top bar. On a phone each section expands in place.

### Radio

- **Connection:** Reconnect, and **Disconnect**, which pauses automatic reconnects so another device can use the radio. If you have loadouts, Disconnect offers to load one first.
- **Identity:** radio name, private key (write only) and your `meshcore://` contact link.
- **Radios:** every radio that has fed this install, with first and last connect times, also when no radio is connected. The most recently connected one is marked **Current**. A radio marked **Needs an answer** can be answered here (see Swapping radios). For a replaced radio you can change what the newer radio inherits or **Remove replacement link**. Each radio has its own note (**Save note**). Every radio except the current one can be removed with **Remove radio**. You are asked to confirm, and you can tick a box to also delete that radio's battery, noise floor and airtime history. Left unticked, the history is kept without a radio and shows as "Before radio tracking" on My Node. Contacts, messages and packets are not affected.
- **Radio Parameters:** preset, frequency, bandwidth, spreading factor, coding rate, TX power and path hash mode (1, 2 or 3 bytes per hop, when the firmware supports it).
- **Location**, telemetry sharing, and **Advertising & Discovery** (advert interval and buttons to send an advert).
- **Messaging:** extra ACKs, **Auto-Resend Unheard Channel Messages** and the default flood scope.
- Known regions for decoding region-scoped packets, including **Load Dutch scopes**.
- **Max Contacts on Radio**, **Export Config** and **Import & Reboot**.
- **Show Mention Ticker**, **Auto-add mentioned channels to registry** and the **External analyzer node overlay**.
- On meshcomod (DMC-EV) firmware, a **Meshcomod (DMC-EV)** panel with CAD and GPS controls.

### Host repeater

RTFM-EV can judge every received packet the way a repeater would. **Shadow mode** counts what would be forwarded or dropped, and never forwards anything. Region gating, an airtime budget, timing and policy rules are configurable, with live statistics. Live repeating (armed mode) needs the server setting `MESHCORE_HOST_REPEATER_ENABLED=true`, supported firmware, a permitted frequency band and an explicit confirmation. **Disarm (kill switch)** stops it, and it always starts disarmed after a restart. Make sure you are allowed to run a repeater where you are. The **DMC packet filter** matches the DMC observer firmware: hop and rate limits, blocked channels and path prefixes, sender and text rules, a per-node advert window, a message age limit and a **Dry-run** switch that only counts. The optional **Neighbour poll** transmits: every 12-336 hours it sends one zero-hop discover and asks each neighbouring repeater for its regions.

### Local Configuration

Settings for this browser or device: language, color theme (including four CRT phosphor themes) and CRT screen effects, the **Desktop buddy** (after you have used the Windows 95 theme), branding (app name and icon, shared by all devices), a local label banner, **Distance Units**, **Coordinate format**, **Date & Time Format**, relative font size, UI tweaks (such as reopen last conversation, battery display and **Replace as you Type**), the mention and DM sound, new node notifications, **Chat parsing** and **Web Push Notifications**.

### MQTT & Automation

Integrations (see Integrations).

### OpenHop

Only shown when the connected node is an OpenHop node. Set the OpenHop API address and token, then manage its configuration, system, updates, policy and plugins. Actions with real effect ask for confirmation.

### Radio-App Management

**Tracked Repeater Telemetry** and **Tracked Contact Telemetry**, name resolution for unnamed contacts, **Contact Management** (block new node types, blocked keys and names, bulk delete), **Loadouts**, and **Partial node sync**, which matches nodes you only know by prefix against the analyzer directory. You review each match before it is saved as a reversible soft link.

**SNMP agent** (off by default) lets a monitoring system such as LibreNMS or Zabbix poll this node over SNMP, with the same values as the observer firmware. Set the UDP port and your own community; in Docker, publish the port as well. It is read-only and never uses the radio.

### Map

The map start view and the **Map tile cache** (see Backup, restore and data retention).

### Database

Database overview, storage cleanup, **Data retention**, backup and restore, and sync addresses for the channel registry, the Channel Finder wordlist and external analyzers.

### Handy Info

**Configure** lists external node analyzers and sync sources. Name resolution for an analyzer only sends one public key per lookup, and only when you press a button. **Links** holds useful reference sites; the book icon on a link shows it in Tools > Knowledge base.

### About

Version, links to the changelog and bug reports, an update check, and **Open debug support snapshot**.

<!-- id: integrations -->

## Integrations

Open **Settings > MQTT & Automation** and choose **Add Integration**. Types:

- **Private MQTT:** forward messages to your own broker, raw and/or decrypted. Decrypted messages are sent in plain text, so use a broker you trust.
- **Community MQTT/meshcoretomqtt:** a raw packet feed for community aggregators, so your radio can act as an observer. Regional presets are built in.
- **Home Assistant MQTT Discovery:** devices and entities appear in Home Assistant automatically: a local radio device, a message event, telemetry sensors for tracked repeaters, and GPS trackers for selected contacts. Repeaters must be tracked for telemetry before they show up in the picker.
- **Webhook:** decrypted messages to a URL, optionally signed.
- **Apprise:** forwards messages to Discord, Telegram, email and many other services.
- **Amazon SQS:** raw or decrypted packets to a queue.
- **Map Upload:** uploads heard repeaters and room servers to map.meshcore.io or a compatible endpoint, with a dry run mode and an optional geofence.

Every integration has a **Message Scope**: all messages, none, only listed channels and contacts, or all except listed ones.

<!-- id: backup-retention -->

## Backup, restore and data retention

All data lives in one SQLite database (`data/meshcore.db` by default). Manage it under **Settings > Database**.

### Backup

- **Download backup** saves a consistent snapshot to your browser, even while the app is running.
- **Also save backups to a server path** writes the same snapshot to a folder on the server. **Back up to server now** runs it immediately.
- **Back up automatically to the server path** writes a backup every N hours and keeps the newest N files. Only automatic backups are rotated.

### Restore

Choose a file, or press **Restore** next to a file under **Backups on the server**. The file is checked and staged, and nothing changes until you restart the server. Until then **Cancel restore** discards it. At the next start the current database is saved as a pre-restore file, and the backup is swapped in. To undo, restore the pre-restore file the same way. A restore replaces everything recorded after the backup was made.

### Data retention

**Data retention** sets how many days each kind of history is kept; `0` keeps it forever. It covers raw packets, messages, adverts, telemetry, link and relay data, device history, noise floor, battery, airtime and advert paths.

- Pruning runs about a minute after start and then on a schedule. **Prune now** runs it immediately.
- Lowering a value deletes older data on the next run. Raising it does not bring deleted data back.
- Pruning a message also deletes its raw packet.
- **Keep everything (analyzer)** sets every limit to 0. **Restore defaults** puts the default limits back.

### Map tile cache and loadouts

- **Map tile cache** (Settings > Map, off by default) lets the server cache map tiles you have viewed, so those areas work offline. Esri tiles are never cached.
- **Loadouts** (Radio-App Management) are named groups of channels and contacts. **Load onto radio** only adds, never removes, and reports the result per item. Nothing is transmitted. The app reorganizes the radio again at the next reconnect or full sync, so load a loadout right before you disconnect.

<!-- id: troubleshooting -->

## Troubleshooting

**The page is blank or old after an upgrade.** The server serves the built frontend. After updating, rebuild the frontend and refresh the page.

**Messages stay on the radio and never appear.** Start the server with `MESHCORE_ENABLE_MESSAGE_POLL_FALLBACK=true`, which polls the radio every 10 seconds.

**Warning that automatic DM acknowledgement may not work for all contacts.** The radio contact table is full or could not be read. Sending and receiving still work. Lower **Max Contacts on Radio**, or clear the radio's contact table with another MeshCore client and restart.

**MQTT does not connect on Windows.** Start the server with `--loop none`.

**Channel Finder says WebGPU is not available.** Use Chrome or Edge 113 or newer, over HTTPS unless you are on `localhost`.

**Web Push does not work.** Push needs HTTPS. For iOS and Safari, set `MESHCORE_VAPID_SUBJECT` to a real `mailto:` address.

**A message shows Failed.** No acknowledgement arrived after all retries. Use **Retry** to send a new copy.

**Reporting a bug.** Start the server with `MESHCORE_LOG_LEVEL=DEBUG` and use **Open debug support snapshot** under Settings > About. Logs can contain channel names or keys (never your private key), so check what you share.
