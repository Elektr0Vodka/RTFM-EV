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

### Several radios at once

When the server runs in multi-radio mode, every radio has its own workspace with its own contacts, messages, packets and settings. The channel list is shared: a channel you add or remove in one workspace is added or removed in all of them. The radio name in the top bar opens a list of the other radios; pick one to switch. **Manage radios** opens the radios page, where you add, edit, start, stop and remove radios and read their log. A radio gets its workspace after it has connected once. A number next to the radio name shows how many unread messages wait on the other radios; it is highlighted when a direct message or a mention is among them. The mention and DM sound also plays for another radio if the sound is switched on in that radio's settings. Theme, language and map look are shared by all radios. This mode is off unless the server operator turns it on.

### Language and theme

The interface is available in English, Dutch and German. Switch language with the language menu in the top bar (flag and language code) or under **Settings > Local Configuration**. The choice is saved per browser. The sun or moon icon in the top bar opens the theme picker.

The **Windows 95** theme comes with a **Desktop buddy**: Clippy shows up when you pick that theme, until you choose another buddy (Merlin, Bonzi, F1, Genie, Genius, Links, Peedy, Rocky, Rover or one of 26 more, such as Mother Nature, Courtney, Earl or Santa) or **Off** under **Settings > Local Configuration** (below the theme picker) or in the theme dialog from the sun or moon icon. Once you have used Windows 95, the same setting is offered on every theme; other themes start with **Off**, and a buddy you pick there shows on all themes. The buddy stays on screen while you navigate and tells you about new nodes, low batteries (your radio and nodes with telemetry from the last 24 hours, below the threshold you set; nodes set to mains power are skipped), direct messages and @mentions, radio disconnects and available updates. It also tells you when a direct message of yours got no acknowledgement (only when that chat is not on screen), when an integration under **MQTT & Automation** has been disconnected for a minute, and when a node you poll over SNMP stops answering. It also gives a short tip the first time you open a page. Before it speaks it plays a fitting animation (an alert for a lost radio, a cheer for a new node), and when the thing it talks about is on screen (the sender's row in the sidebar, the radio status, the battery indicator or the Settings button) it gestures toward it while it talks. Characters differ in the animations they have; one without a fitting animation just speaks. Click the speech balloon to open what it is talking about. Drag the buddy to move it (the spot is remembered per browser), double-click it for a trick, and right-click it to send it away until you reload the page. A single click on the buddy opens a small menu: **What did I miss?** lists the last 20 lines it said or kept back while it was quiet (click a line to open what it was about), **Help for this page** opens this guide at the section for the page on screen, and the rest mutes it, opens its settings to choose another buddy, or hides it until you reload. The summary line after a quiet period opens the same list when you click it. Escape or a click elsewhere closes the menu. Under **Settings > Local Configuration** you can also switch off kinds of lines under **Tell me about** (direct messages and mentions, new nodes, radio connection, low batteries, integrations and SNMP, updates, page tips), **Mute** the buddy for 15 minutes, 1 hour or until you reload, and set daily **Quiet hours**. While it is quiet nothing gets through; afterwards it tells you in one line what it kept back (page tips are not kept, they come back on a later visit). A low battery warning is not repeated after a reload. With a CRT theme the buddy takes on the phosphor colour and follows the CRT screen effects (scanlines, glow, curvature and flicker). Each buddy's images are only downloaded when you pick it, and it plays no sounds.

### Guided walkthrough

New to the app? Open the **User Guide** and press **Start guided walkthrough**. A buddy then shows you the main parts in 12 steps: it moves next to the part it is talking about and points at it, a frame marks that part, and a small panel beside the buddy has the text with **Back** and **Next**. Each step opens the page it is about. The walkthrough only navigates: it never types or sends anything.

- **Pause** stops the walkthrough and remembers the step. **Resume walkthrough** in the User Guide, or in the menu that opens when you click your buddy, carries on from there. **End** stops it; you can start it again at any time.
- Nothing is blocked. You can keep using the app while the walkthrough is on, and you can drag the buddy out of the way.
- If you have no buddy switched on, Clippy comes along for the walkthrough only and leaves when it pauses or ends. Your buddy setting does not change. With a buddy of your own, what it would have said during the walkthrough is kept back and summed up afterwards.
- In a browser that has not used the app before, a card offers the walkthrough once: **Start walkthrough**, **Not now** (it asks again on the next visit) or **Don't ask again**.
- As long as you have no channel, the two chat steps are left out.

Two shorter tours show what your radio's firmware adds. Their buttons appear in the User Guide and in the buddy menu once a radio with that firmware has been connected:

- **MeshCore 1.18 tour** (companion firmware 1.18 or newer): the command line in **Settings > Radio** and on **My Node**, the command line of another companion in a chat and in its contact info, the **Remote CLI** permission, and the sensor dashboard. A stop for a contact or a sensor is left out when you have none; the tour opens the companion you heard from most recently, never the Meshcomod contact.
- **meshcomod tour** (meshcomod firmware): the **Meshcomod (DMC-EV)** panel, the CAD button in a chat header, the built-in **Meshcomod** contact (what you send it runs on the radio and never goes out over LoRa), the command line, and the **Companion receive filter** with its counters and backup. Stops for features your build does not have are left out.
- The first time a browser sees such a radio, a card offers that tour once, also when you have used the app before. One card shows at a time, and after **Not now** or **Don't ask again** no other card follows until the next visit.

<!-- id: layout -->

## The layout

### Top bar

From left to right the top bar shows the app name, the connection status dot, a **Repeating** badge while the host repeater is armed, and the radio battery when you enable it in **Settings > Local Configuration**. On wide screens it also shows a live packet rate graph, the connection status text, and the radio name with its short public key (click the key to copy the full key). When the radio is disconnected or paused, a **Reconnect** or **Connect** button appears. Then come the **Chat window** button (opens the chat-only window, see below), the **Settings** button (a dot on it means a newer build is available), the language menu and the theme button. The theme button opens a dialog with collapsible sections for the color theme, CRT screen effects, **Accessibility** (colourblind mode and reading font) and the desktop buddy; the sections you open stay open the next time.

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

### Explanations on touch screens

Many badges, icons and shortened values carry an explanation that a mouse shows on hover. On a touch screen, tap such an item to show the explanation in a small bubble. Tap it again, tap anywhere else or scroll to close it. Buttons and links are not affected: tapping them does what they are for.

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
- **Share how this message travelled** (on messages with a path, and as **Share** in the path view) makes an image of the routes the message took to your radio: a map with the sender, the hops and your radio, the message text and up to four figures (routes, hops, straight-line distance, best SNR at your radio). An animation (GIF) that draws the routes hop by hop follows. **Share** opens your device's share sheet, **Copy image** copies the picture; both need HTTPS or localhost. **Download image** and **Download animation** always work. **Hide my position** draws the routes as a diagram instead of on a map, without node names or real directions, and is remembered in this browser; the title, text and figures (including the straight-line distance) stay on the card. Nothing is sent over the radio.
- The same kind of image is behind **Share** on a trace result (each hop with the SNR heard there, the route out and back), on the **Directly heard radar** in My Node (the nodes your radio hears directly), in the Mesh Health header on tabs with a time window (the nodes heard and the packets per hour), in the filter sections of an SNMP node page, in the companion receive filter history, as **Share as image** on the Spam & bots tab (with **Show top sources**, off by default) and next to the host repeater lifetime totals (an image only). **Hide my position** is offered on the message, trace and radar images.

### Mentions

When someone mentions your name in a channel you are not viewing, it appears in the mention ticker (turn it on with **Show Mention Ticker** in Settings > Radio). Click an entry to jump to the message. Hashtag channels named in messages can be added to the Channel Registry automatically with **Auto-add mentioned channels to registry**.

### Sharing location and contacts

- The location button (pin icon) in the chat header inserts your radio location, the location of this node, or a spot you pick on a map.
- A contact tag in a message shows as a chip with **Add contact**. **Copy share tag** in a contact's info copies a tag you can paste.
- Under **Chat parsing** in Settings > Local Configuration you can turn on clickable links, link previews (the server fetches the linked page), public key detection and coordinate detection.

### Per-conversation options

The bell in the chat header opens notification settings: alerts while the tab is open, Web Push alerts when the browser is closed (needs HTTPS), muting the mention sound, and **Mute channel**. **Filter messages** hides messages by hop size. Other header controls include the favorite toggle, a region override, Path Discovery and Direct Trace.

At the bottom of a channel's info panel, **Send channel data (developers)** floods a binary datagram to the channel: a data type in hex (0001-FFFF; FF00-FFFF are free for testing) and up to 165 bytes of hex payload. It goes on air at once and is not stored.

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
- Look-up links for configured analyzers, **Triangulate**, and blocking the key or name. The chat header of a contact has the same look-up as an icon, and the packet detail view has **Look up sender on** a site when the packet resolved to a full sender key.

Favorite contacts stay loaded on the radio so it can acknowledge their direct messages.

### Routing override

Click the route label next to a contact's name (for example the hop count or "flood") to open **Routing Override**. You can force flood, force direct, or enter an explicit path of comma-separated 1, 2 or 3 byte hop IDs. Clear the override to go back to the learned route. The last retry of an unacknowledged direct message is always sent as flood.

### Repeaters

Opening a repeater shows a login form: log in with the password or as a guest. The dashboard then has panes for Node Info, Telemetry, Radio Settings (with advert intervals), LPP Sensors, Neighbors, ACL, Regions and Owner Info, plus Actions (Zero Hop Advert, Flood Advert, Sync Clock, Reboot), a Console with CLI access, telemetry history and a History pane that shows what changed between stored snapshots. While you type in the Console, matching stock MeshCore commands are listed with their parameters and a one-line description (in English): Tab completes the first one, the arrow keys and Enter pick another, Escape hides the list. A suggestion only fills the input; nothing is sent until you press Send. Commands marked "serial only" do not work over the radio. The Console sends a line exactly as typed, leading spaces and an empty line included, which the firmware's `region load` needs; a line that starts with a space gets no suggestions. **Load All** fetches every pane one after another.

The Settings Editor changes one repeater setting at a time: you edit, confirm the exact CLI command, it is sent over RF, and the value is read back to check it. Changing frequency, bandwidth, spreading factor or coding rate requires typing the repeater name first, because a wrong value can take it off the air. The Observer firmware group (SNMP agent on/off) only works on DMC observer and agessaman observer firmware: use its own Read button first, and reboot the repeater after a change.

Repeaters and room servers on observer firmware can also be read over your network. On the contact page, the **SNMP (LAN)** card takes the node's IP address, port and community; **Poll now** then shows radio, MQTT, memory and WiFi values without using RF. SNMP must be on on the node (Observer firmware group in the Settings Editor, then reboot) and the server must be able to reach it over UDP. Turn on **Poll on a schedule** to have the server poll the node every few minutes and keep the results; the card then shows a history chart for the value and range you pick. If the Home Assistant integration tracks the repeater, the values also appear there as SNMP sensors. **Ask node for its address** sends one command over RF to look up the IP and needs an admin login. The **SNMP** page under Tools shows all nodes with SNMP set up side by side.

Companions on meshcomod firmware have the same card. Turn the agent on with `set snmp on` in the companion's command line, look up its address with `get wifi.ip`, and type that IP address or hostname into the card: a companion cannot be asked for it over RF. Its page also shows the connected clients, contacts and channels and what its receive filter kept from you. Your own connected radio is a companion contact too, so it can be added the same way.

### Room servers

Room servers also have a password or guest login, with telemetry, ACL, sensor data, a CLI console and a history of ACL changes.

A room server sends you the posts that are newer than what your radio already received. **Sync Now** logs in again to ask for those. If posts are still missing (for example after the radio restarted, or after many messages arrived at once), open **Show Tools** and use **Resync history**. It makes the room server send every post it still holds again, up to 32. Posts you already have are not duplicated, and your own posts are not sent back. It takes a second click to confirm, because it uses the airtime of all those posts; the posts arrive over the next minutes.

### Telemetry

- On a non-repeater contact, **Request** fetches its sensor readings on demand, with history charts.
- **Settings > Radio-App Management** lets you track repeaters and up to 8 other contacts for scheduled collection. To limit mesh traffic, all tracking shares a cap of 24 checks per day, so more tracked nodes means a longer interval.

### Node clocks

Every advert carries the time of the node that sent it. The contact info shows it as **Clock**: **In sync** (within 2 minutes of this server), or how far the node runs ahead or behind. A node that never had its clock set reads years behind. Nothing is sent to measure this; the value is as old as the last advert heard, and only adverts heard since this version was installed count.

For a tracked repeater, the telemetry history pane has **Set this repeater's clock when it runs behind**. With it on, each telemetry collection that reaches the repeater checks its newest advert, and sends one time command over the radio when the clock is more than 2 minutes behind. Two safeguards apply. The command is sent at most once per new advert, and only when most nodes heard in the last day (at least 5) agree with this server's clock, so a wrong server clock is not pushed into repeaters. The repeater firmware never sets a clock back: a repeater that runs ahead is left alone and only noted in the server log. Your radio needs admin permission on the repeater (log in once with the admin password).

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
- **Filters:** **Since** (a preset or custom time range), **Heard by server** (all, hide never-heard, or only never-heard), **Node roles**, **Power source** (the override set on the contact, else the power icon in the node name: ⚡/🔌 mains, 🔋 battery, ☀️/🌞/🔆 or the word "solar" for solar, both for solar + battery, no icon is Unknown; nodes named "DTIS | ..." are solar + battery), **Hops** (only nodes whose latest heard advert came within a maximum number of hops, Direct = heard by your radio itself; nodes without a heard advert are hidden while a limit is set, and guessed locations follow it too), **Analyzer nodes** and **Hide nodes reporting wrong location** (at 0,0 or more than 300 km from the nearest node that heard them).

**Overlays** are off until you turn them on, and are remembered per browser:

- **Visualize packets** (see below).
- **Links** between nodes, from liveness, advert paths or all traffic, with a confidence level, a maximum distance and an age window. Click a link and then **Details** for its traffic and signal history.
- **Telemetry (battery/temp)**.
- **Shared locations:** pins for locations sent in chat. Click one for who shared it and **Open in chat**.
- **Beacons:** positions, waypoints and routes sent by MeshCore TEAM and signalk-meshcore in channels you follow. Each sender's newest position is a pin with an icon for the kind of sender (boat, autonomous radio or person), and waypoints carry their TEAM type icon; switch on **Trails** to draw its track over the time window. Click a pin for batteries, status and **Open in chat**. A contact that sent such beacons also gets a **Beacon history** section in its contact info.
- **Sending in TEAM format:** in a private channel, **Share location > Pick on map** can insert a MeshCore TEAM waypoint instead of a location marker. **Settings > Radio-App Management > MeshCore TEAM beacon** can send this radio's position as a TEAM beacon on one private channel at a set interval. It is off by default and transmits on the radio each time. To give a boat its own map icon, set **Vessel type** in its contact info.
- **Trackers:** ATAK users who use the ATAK plugin for MeshCore (TAK-MESHCORE) and MeshCore SAR fast-GPS beacons. ATAK users show in their team colour; switch on **Trails** for their tracks, and map objects they share appear as purple dots. For ATAK, add the channel `ATAK_DATA` with key `A3741E6A529CCF31D04B89FE1763B82D` first; if the ATAK users set an encryption passphrase in the plugin, their traffic cannot be read, and the Trackers section says how many there were. Their GeoChat lines appear in that channel. MeshCore SAR `S:` markers show as location cards in chat and on **Shared locations**. A contact that sent SAR beacons gets a **MeshCore SAR positions** section in its contact info.
- **Companion bridge:** the MeshCore app can connect to RTFM-EV over TCP as if it were your radio: it sees your contacts, channels and new messages and sends through RTFM-EV. Radio settings, keys and CLI stay out of reach. It is switched on by the server's administrator (an environment variable, see README_ADVANCED); **Settings > Radio-App Management > Companion bridge** shows whether it runs and which apps are connected.
- **TAK Stream:** the server can also feed ATAK / WinTAK with your nodes and trackers. It is switched on by the server's administrator (an environment variable, see README_ADVANCED); **Settings > Radio-App Management > TAK Stream** shows whether it runs.
- **Guessed locations:** estimated positions for nodes without a location, placed near the located repeater(s) in their advert paths or, when heard direct, near your own radio; shown as hollow markers at every zoom, labelled per the map's Labels setting. Never saved or sent.
- **Relay signal:** rings around relays that passed flooded packets to your radio, colored by average SNR.

**Analyzer nodes** shows nodes from an external node directory. The directory is only filled when **External analyzer node overlay** is turned on and synced in Settings > Radio. **Node source** picks where it comes from: **map.meshcore.io** (the default, nodes worldwide, about 50 MB per sync) or **Analyzer**, which syncs from the Analyzer URL.

### Visualize packets

Turn on **Visualize packets** to watch packets travel across the map as animated arcs and pulses. A playback bar lets you play, pause, change speed, seek and return to live. You can tune pulses, glow, arc width and trail fade, and turn on the **Geiger sound**. The same panel has **Discover nodes**, a passive filter that shows only nodes heard in live packets since you turned it on. It transmits nothing.

### Start view and popups

**Settings > Map** sets where the map opens: fit all nodes, a fixed home location and zoom, or your last position. Click a node for details, telemetry, a link to open the conversation, **Message owner**, **Triangulate** and **Details**.

<!-- id: tools -->

## Tools

The Tools section of the sidebar holds these views. You can reorder or hide them with Customize sidebar.

### My Node

Statistics about your own radio: radio details (frequency, bandwidth, model, firmware) and charts over a time range you choose, from 20 minutes to a year or a custom range. Charts include packets and bytes, RSSI and SNR with the noise floor, **Airtime utilization**, **Receive errors**, nodes heard, neighbors, path hash width, busiest channels, and the **Directly heard radar**, which plots nodes heard at 0 hops by bearing and distance. Charts zoom with the scroll wheel, pan by dragging and reset on double-click. The **Live signal** card plots the RSSI of every packet heard in the last 2, 5 or 15 minutes, coloured by packet type, against the noise floor (dashed line). Its meters show the last packet (with its SNR), the noise floor, the strongest packet in that window and the **Margin**: how far the last packet was above the noise floor. LoRa can still decode packets below the noise floor, so a negative margin does not mean a packet was lost.

The battery, noise floor and airtime charts show the current radio plus the history it inherited from a radio it replaced. When there is more than one radio, or history from before radio tracking, a **Radio** picker appears next to the time range: **Current radio**, one specific radio (with what that radio inherited), or **Before radio tracking**.

### Mesh Health

- **Adverts:** direct and flood advert counts per contact, a searchable contacts table, hop and hash mode charts, an activity heatmap, and alerts for nodes that advertise too often (flood adverts only).
- **Requests:** request and response traffic this node has heard.
- **Prefix Collisions:** contacts that share a 1, 2 or 3 byte public key prefix. Shared prefixes make hops ambiguous.
- **Relay reception:** for flooded packets heard more than once, which relay delivered each copy and with what signal. The totals and the per-relay table cover the whole window, with no row limit. The per-relay table also shows how often a relay's copy arrived first and how many packets you heard only through it. Expand a relay (the arrow before its name) for its activity and signal over time, packet types, hop counts and recent copies. The per-packet table pages through stored copies; pick the rows per page below it. Stored copies are kept 2 days by default; before that they are folded into an hourly per-relay history (kept 365 days by default, **Relay history, hourly** under Data retention), so windows longer than the stored copies still show per-relay totals and charts.
- **Power Outage:** which nodes would stay online when the grid goes down, based on each node's power source (the contact override, else the power icon in the name; DTIS nodes are solar + battery). Battery and solar nodes stay online; mains and unknown nodes go dark (unknown counts as mains). Shows the share that survives, the power source mix, and the islands the surviving nodes form over heard advert-path links (only between nodes with a location), so you can see where the mesh would split. Choose repeaters + rooms or all nodes, and how recently they were heard. Click a column header to sort the node table; the table is paged by the same **Show max rows** setting as the Adverts table, and a go-to-top button appears once you scroll down.
- **Spam & bots:** statistics about channel messages flagged as spam, malformed or duplicate, and messages from senders on a bot list, for the chosen time range and optionally one channel. Tiles show each count and its share of channel traffic. **Bots** counts messages from senders that are on an enabled bot list today; the number flagged on arrival next to it does not change when the lists change. The chart shows the trend as counts or as a share. **Offenders** has three tables (senders, channels, source repeaters) that sort on a click on a column header and download as CSV; **Show max rows** sets how many rows a page shows (10, 25, 50, 100 or All), the same setting as on Adverts and Power Outage. **Filters** shows what Spam Guard did with the messages it analysed (stopped, would have stopped while nothing was being withheld, as in Monitor mode, let through, held, clean), which kind of block caught them, your own This is spam and Not spam answers, the cause of malformed messages, and packets per OpenHop rule. Outcomes are recorded from the version that added this tab; older messages count as having no recorded outcome. **Copy summary** puts a short text report on the clipboard and **JSON** downloads the whole report. **Scramble names** replaces sender names, private channel names and OpenHop rule names you wrote with codes, on the page and in every export, so the numbers can be shared. Nothing on this tab is sent over the radio.

### Mesh Trends

**Historical** shows stored breakdowns: Network, Messages, Activity, busiest channels, packets per hour, path hash width, region scope, noise floor and MQTT broker stats. **Live · this session** shows packet statistics. Its short windows (1, 5 and 10 minutes, and this session) come from your browser; longer windows are computed from the database.

### Mesh Discovery

**Discover Repeaters**, **Discover Sensors** or **Discover Both** sends a short discovery request over RF and lists the nodes that answer. **Discover Regions** asks nearby repeaters which regions they flood, so you can add them to your known regions.

### Performance

What RTFM-EV itself is doing. **Overview** shows the overall state (with the reason when something is off), uptime, the process and the host, tiles for CPU, memory, event-loop lag, asyncio tasks, packets per minute, database and radio timing and overdue background tasks, then charts and the cards below. The other tabs show one card in full:

- **Event loop:** the lag (how long a ready task waits to run) and every stall of 100 ms or more. For a longer stall the page shows what the process was running at that moment, as a short stack.
- **Background tasks:** every long-running loop with its state (healthy, running, overdue, idle, failed), interval, last run, duration and a 24-hour strip, plus all asyncio tasks right now.
- **Packet pipeline:** packets per minute and the time each step takes (parse, store, process, broadcast), with duplicates, decrypted and undecryptable packets.
- **Database:** file and WAL size, readers busy, lock waits and the slowest database calls of the last hour.
- **Radio link:** what holds the radio right now and what waits for it (with how long), how long radio operations hold the radio, errors, reconnects and the slowest operations.
- **Outputs:** MQTT and the other fanout modules, WebSocket clients, TAK Stream and web push.
- **Requests:** the busiest API routes with their timings and server errors.
- **Logs:** the latest warnings and errors from the backend log.

The page refreshes every 5 seconds. Live, 15m and 1h come from memory at 10-second detail; one row per minute is stored for 30 days for the longer ranges. CPU is the share of one core. Memory, threads, open files and the container limit are read from Linux and show "–" on other systems. Measuring costs very little and nothing is sent over the radio.

### Spam Guard

Spam Guard stops channel spam at your repeater. It looks at behaviour, never at people or opinions: the same text sent under several made-up names, floods of copies, and repeaters that spam enters the mesh through. Switch it on in **Settings > Local Configuration > Spam protection**; the page then appears under Tools.

It starts in **Monitor**: spam is detected and shown, but nothing is blocked. Leave it there for a day and check what it would stop. **Protect** makes your host repeater stop forwarding what a block catches. That only changes anything on air while the host repeater is armed.

An **OpenHop** radio forwards on its own, so there Protect writes the blocks into the node's policy, as rules whose names start with `rtfm-spam:`, placed around your own rules. Your own rules are left as they are. The end of each rule name says where the block came from: `(yours)` for one you made or kept, `(duplicate)` for routine duplicate suppression, `(auto)` for the rest. Messages the node's own companions send, yours included, are never dropped by these rules. This needs the API URL and token under **OpenHop management** in Settings, and it switches the node's policy engine on. The rules are taken off the node again when you go back to Monitor, pause, switch Spam Guard off or shut RTFM-EV down. A private channel is only enforced on the node after you tick **Also enforce on the OpenHop node** for it under Settings on the Spam Guard page, because that copies the channel key to the node. Nothing is written to a node that already runs SpamGuard.

- **Overview** shows the mode, whether everything is working, and how much spam was stopped or let through. With more than one protected channel, **Show the graphs for** shows the graphs of one channel (the numbers above them stay for all channels). If you turned on **Switch to Protect by itself after watching** (Settings, Timing and limits; off by default), the Overview says when that will happen or what it is waiting for, with **Stay in Monitor** and **Watch again**.
- **Protection** lists the active blocks, each with the reason and when it ends. Every automatic block ends by itself. **Lockdown** is for a heavy attack: for a while only names it already knows get through. Under **Possibly genuine, held** you find messages from normal-looking names that were held; **Let through** trusts that name. **Clear list** empties that list. With **Block something yourself** you add a block for a text or for a repeater; a repeater block can be limited to one channel, which makes fewer rules. **Clear automatic blocks** removes them and holds them off for up to 24 hours, like a block you remove yourself. A text you block yourself needs at least 12 characters and only stops names Spam Guard does not know: it never blocks what people it knows say. Text blocks, and repeater blocks that also stop known people, last at most a week. During a big flood (many made-up names through many repeaters at once) Spam Guard starts a 15 minute lockdown by itself. **Known people** at the bottom lists who Spam Guard knows or is still learning: search for a name, **Trust** keeps it for good, **Forget** makes someone count as new again.
- **Messages** shows what it read and why it did or did not act. Use **This is spam** and **Not spam** to correct it. The same two buttons are on every channel message in chat. A caught message says by which block and in which channel. **Clear list** only empties the list on screen: Spam Guard keeps using those messages as evidence.
- **Spam sources** shows which repeaters spam arrives through. **Remove** takes a repeater off the list until new spam arrives through it.
- **Settings** has the channels it reads (search for a channel to add it), every setting with a note on its side effects, and the exceptions (trusted names, repeaters never to block, allowed texts). With **Keep an evidence log** on, it keeps what it read and your This is spam / Not spam answers for the number of days you set. You can download that log, also scrambled (names replaced by codes, for sharing), and **replay** it with the settings in the form to see what they would have stopped. A replay changes nothing. At the bottom, **Start again** has two separate resets: **Forget what was learnt** removes every block (also your own), the known names and routes, the spam sources, the lists and the numbers; **Settings back to defaults** puts the settings and exceptions back to those of a fresh install.
- Two settings worth knowing. **Block repeats from** sets whose repeats duplicate suppression holds back: other names sending the same text (the first sender may send it again), the same name only, or everyone. **Treat malformed messages as spam** flags messages of random characters, or from a sender whose clock was never set, and counts them as a made-up name.
- The **repeat guard** (under Duplicate suppression) holds back one name sending the same message over and over: after 3 copies in 10 minutes, further copies from that name wait an hour. Their first copies and anything else they say still go out. **Treat unreadable random text as spam** counts short meaningless text from a name Spam Guard does not know as a made-up name. A first name with a random tag stuck on (like `Marco-7fq2k`) counts as made-up too, a call sign after a name does not.
- A name counts as **known** after three genuine messages. A fresh Spam Guard learns its first known people from the chat stored in the last day. Regulars caught by a block while heard from their usual repeater keep counting towards known, and regulars saying the same greeting are never a spam campaign.
- **Policy** is only there with an OpenHop radio. It is the node's own policy editor: the engine switch, the groups and the rules. The node does the filtering. While Spam Guard is switched on the editor is here and not under Settings > OpenHop; with Spam Guard off it is back there.

A repeater is shared. What yours does not forward disappears for everyone behind it, and they cannot see why. There is on purpose no button to block a person by name. A bot list with **Block forwards** on is the one exception: it stops the names you put on it, see **Bot lists** under Settings.

In chat, **Hide spam** in the filter menu hides flagged messages and keeps them out of unread counts and notifications. A message that duplicate suppression caught as a repeat carries a **Duplicate** marker. That is not a spam flag, so it is not hidden.

**Profiles.** On the **Settings** tab, **Profiles** keeps sets of detection settings under a name, together with the mode. Use them when the situation changes: one for a spam wave, one for an event, one for normal days.

- **Save current as profile** stores the settings that are in force now.
- **Apply** first shows every setting that will change, with the old and the new value. A profile that switches to **Protect** says so and asks for your confirmation, because from then on your repeater does not forward what Spam Guard blocks.
- **In use** names the profile you applied last. If you change a setting afterwards it says **modified**, and you can **Save to profile** or **Revert**.
- **Export** downloads a profile as a file you can give to someone else. **Import file** adds a profile from such a file. Importing never applies it: look at what it changes first.

A profile never contains your protected channels, channel keys, exceptions, the pause or the evidence log settings, and applying one does not touch them. Nothing switches on its own. While the form below has unsaved changes, save or discard them first.

### SNMP

Every node that has SNMP set up on its contact page, in one table. Each row shows the status, name, address, schedule, last good poll and last error, with the main values side by side: firmware version, uptime, free heap, largest free block, connected MQTT slots, packet queue depth, WiFi RSSI, noise floor, receive errors, last RSSI and last SNR. A node whose last poll failed is marked **Failing** in red and listed first; its values are then those of the last good poll. Click a column header to sort.

Click a row, or the arrow in front of it, to open that node's own page (see below). **Poll now** reads one node and **Poll all now** reads them one after the other. Polling goes over your network (UDP) and never uses RF. **Auto refresh** only re-reads what the server has stored, every 10, 30 or 60 seconds, or not at all. How often a node is polled is set with **Poll on a schedule** on its contact page. Click a node's name to open that page.

The node page shows one node in full. At the top are its status, address, last good poll and schedule, with **Poll now** and **Open contact page**. Pick a time range, from 20 minutes to 30 days, or **Custom** with a start and an end. Tiles show the newest values and how often the node rebooted in that period. Below them are graphs of the stored polls: uptime, packets, receive errors, air time, noise floor, RSSI and SNR, MQTT slots and queue depth, memory and WiFi RSSI. They zoom with the scroll wheel, pan by dragging and show values on hover. All values of the newest poll are listed at the bottom. Newer DMC observer firmware also reports battery, MCU temperature, reset reason, duplicates, duty cycle, error flags, the duty gate, packet filter drops and neighbours; a value the node does not report is left out, and a battery or temperature the board cannot measure shows **n/a**. Each reboot in the range is listed with the reason the node gave for it.

Packets, errors, air time and skipped publishes are counters that only go up since the node started. With **Counters** set to **Rates** the graphs show the increase between two polls, per minute, and air time as a percentage of the time; a reboot is left out instead of drawn as a drop. **Totals** shows the counters themselves. The graphs need at least two stored polls in the range, so turn on **Poll on a schedule** for a node you want to follow.

### Network scan

Looks for MeshCore devices on your local network (WiFi or wired), checked by the server, never over the radio. Enter one or more addresses or networks, such as `192.168.1.0/24`; networks the app already knows (the address of your radio and of nodes with SNMP set up) are offered under the field. Only local network addresses can be scanned, at most 1024 per scan.

**Ask for SNMP** (on by default) asks every address for the MeshCore SNMP values. Observer repeaters and room servers and meshcomod companions with SNMP on answer with their name and firmware. A device with another community does not answer at all, so enter the community you use. Reading over SNMP changes nothing on a device.

**Ask the app port** (off by default) connects to the companion protocol port (TCP 5000) and asks each device what it is: companion, repeater, room server or sensor, with its name, model and firmware. Any MeshCore device with WiFi app access answers, whatever firmware it runs. A stock MeshCore WiFi companion serves one app at a time, so this check disconnects the phone app or other program that is using it. The radio this RTFM-EV uses is always left out.

**Ask the web config page** (off by default) asks every address for the status page of a DMC observer repeater or room server (HTTP port 80). It only answers while the web config page is running on the node (started with `start webconfig`), also when SNMP is off. The status page needs no login and nothing is changed; other web servers on your network are not listed. A node found this way is matched to its contact on the start of its public key, and **Open web config** opens its page in a new tab.

Each device found is listed with its address, what it answered on and its firmware. A device that matches one of your contacts (on its public key, or on a name only one contact has) links to that contact, and **Set up SNMP** stores the address found on the contact, with polling off; the community you entered goes with it. Other SNMP devices, such as printers or routers, are hidden until you tick **Show other devices**. The last results stay until the next scan or a server restart.

### Fleet

The asset register: one row per device you keep track of, with what only you know about it. That is your own label, the organisation serial, the hardware serial, model, role, Wi-Fi and Bluetooth MAC address, who it is assigned to, the site, a status and notes. The status is one of **In stock**, **Deployed**, **Maintenance**, **Lost**, **Stolen** or **Retired**. Nothing on this page uses the radio.

An asset can carry the public key of a node. When a contact has that key, the row shows the node's name and when it was last seen, and the asset's page shows its type and position under **On the mesh**. Those values come from the contact and are not copied, so they are always current. The key is optional: you can register a device that is still in a box, or enter the key of a node that has not been heard yet.

**Add asset** opens an empty form. An asset needs at least a label, an organisation serial or a public key. **Add my owned nodes** appears when nodes whose owner is this radio are not in the register yet, and adds them as **Deployed**. On a contact page, **Add to fleet** does the same for that one node and **Open fleet record** opens its asset. Search looks through every field, the status list narrows the table, and a column heading sorts it. **Export CSV** and **Export JSON** save the rows that are shown.

On an asset's page, **Save** stores only what you changed. **Delete asset** asks for a second click; it removes the asset and leaves the contact alone. Deleting a contact does not remove its asset either. With more than one radio, each radio has its own register.

**Log.** Every asset has a log. Pick the kind of entry (maintenance, failure, placement, holder, firmware or note), the time, what happened, and optionally who did it and details, then **Add entry**. When you save a new status or a new name under **Assigned to**, the app writes that change to the log itself, with the old and the new value. The list shows the date of the last maintenance entry.

**What the node reported.** For an asset with a public key, **On the mesh** also shows the battery voltage and temperature of the newest stored telemetry and the firmware version the node last reported, with where that came from: the repeater's owner pane, an SNMP poll, or the connected radio itself. The page never asks a node for this. A node shows no battery until it is on one of the tracked telemetry lists, and no firmware until its owner pane was fetched or SNMP is set up.

**Needs attention.** A warning sign in the list marks an asset that is lost or stolen, and a deployed asset whose node was not seen for longer than the limit, whose battery reading is under the limit, or that reports a firmware other than its **Target firmware**. Tick **Needs attention** to see only those. The two limits are under **Attention rules** (48 hours and 3.5 volts to start with). For a lost or stolen device the asset page lists the last known positions of the node.

**Key vault.** This part only exists when the server was started with the vault switched on (see the advanced README); otherwise you will not see it. It stores private keys and passwords of your assets, encrypted. The first time you set a passphrase: it cannot be recovered, so without it the stored secrets are lost. After that you unlock with it, and the vault locks again after 15 minutes without use and when the server restarts. On an asset's page you store a secret with a kind, a label and the value. The list shows kind, label and date only. **Reveal** shows one value and **Hide** removes it from the screen again; every reveal is written to the audit log. An asset that still has secrets cannot be deleted. Under **Key vault** on the Fleet page you can lock the vault, change the passphrase, **Export** all secrets to a file encrypted under a passphrase of its own, **Import** such a file, and read the audit log. Use the vault over HTTPS only: the page warns you when it is not.

**Generate a key.** For an asset without a public key, the vault section offers a new keypair. You may give the first hex characters you want (up to four) and choose that the first two bytes, or the first byte, are not used by any node you know. The private key goes into the vault and the public key onto the asset. Nothing is sent to a radio: to put the key on a device, reveal it and enter it there yourself.

**Configs.** An asset's page keeps the config files of that device. **Import** takes the file the Dutch MeshCore toolbox saves on its USB config page for a repeater or room server, or the config file of **Settings > Radio** for a companion. Choose whether it is what the device had (**Read from the device**) or what it should have (**Wanted**), and add the role, the firmware version and a label if you like. The app picks a profile from the file (stock firmware, DMC repeater, DMC observer or companion); you can correct it. Every import is a new entry, so the list is also the history. A repeater or room server on a USB cable can also be read and set from here: see **USB cable** below.

A stored config never holds a secret. The private key, passwords, tokens and keys in a file are taken out when you import it. With the key vault unlocked they go into the vault, and the config shows **Secret, in the vault** in their place. With the vault off or locked they are not kept, and the page tells you how many were left out: unlock the vault and import the file again to keep them. When the asset has a public key and the private key in the file belongs to another one, the file is refused.

**View** shows a config by section. **Compare** lists what differs from another config of the same asset; secrets are compared by their vault entry and never shown. **Export** saves the file again without its secrets, under the name the toolbox uses. **Export with secrets** is there while the vault is unlocked, asks for a second click and is written to the audit log; that file holds the secrets as plain text. Deleting a config leaves its secrets in the vault. Deleting an asset removes its configs with it.

**What the node reported.** An opened config also shows where it differs from what its node last reported. The app looks at what it already has stored for the node with the asset's public key: the repeater panes you opened for it (**Node Info**, **Radio Settings**, **Advert Intervals**, **Owner Info**, **Regions**) and its SNMP polls. It compares the name, the position, the radio values, TX power, airtime factor, repeat, flood max, the advert intervals, the owner info and the home region, and lists each difference with the pane it came from and when that was stored. Settings without a stored value are named, so you can see which pane to open. Nothing is asked of the node here, so a stored value can be older than the node's current setting. A companion's file and an asset without a public key have nothing to compare with.

**Config templates.** **Save as template** on an opened config makes a template from it without the name, the position and the secrets. **Config templates** on the Fleet page lists them. A template has a document (JSON) and variables. Write `{{name}}` in the document where a variable goes; `{{asset.label}}`, `{{asset.org_serial}}` and `{{asset.site_name}}` are always there. A variable is text, a number, or yes or no, and can have a default. A template never holds a secret: leave such a key empty or write `{"$secret": null}`. Back on an asset's page, **Create from a template** asks for the variables and stores the result as a **Wanted** config.

**USB cable.** At the end of the Configs block, **Connect a device** opens a repeater or room server that is plugged into this PC by USB. This needs Chrome or Edge, and the app opened as `http://localhost:8000` on that PC (or over HTTPS); close the toolbox or any other program that uses the port. **Read the device** shows its name, role, firmware, board and public key, and whether it is this asset. **Store as a snapshot** keeps its settings as a config, with the secrets in the vault as for an imported file. An asset without a public key can take the device's when you tick that. To apply a config, pick it and press **Read the device and show the changes**: the app reads the device again and lists every difference, every command in order, and what it leaves out and why. Writing the private key and changing the radio (frequency, bandwidth, SF, CR) each need their own tick, which is off every time. Nothing is sent until you tick that you checked the commands and press **Send**. The commands go one at a time, each setting is read back, and the apply stops at the first answer that is not as expected. The result is written to the asset's log. The app never sends `erase` or `reboot` and does not change the region tree; restart the device yourself when a setting needs it. Nothing here goes over the radio of this app. Try it on a spare device first, not on the radio the app runs on.

**Onboard a device.** On the Fleet page, **Onboard a device** takes a repeater or room server on the USB cable through all of this in one flow. After **Read the device** it finds the asset with the same public key, or offers to create one with the device's name, role and board. A new asset can keep the device's own key, or get a new key made in the key vault (the vault must be unlocked). Then: store the current settings as a "before" snapshot (not with a new key, because those belong to the old key), choose a template and fill in its variables, apply the wanted config with the same preview, ticks and confirm as above, **Read the device again and compare**, store the result, and **Finish** sets the status (deployed or in stock) and writes an entry in the asset's log. With a new key, tick **Also write the private key** at the apply; the device is the new asset only after you restart it, so compare again after the restart.

### Packet Feed

A live list of every packet the radio hears. It has **Filters** (packet type and path width), pause and resume, autoscroll, oldest or newest first, **Group repeats by content**, a hex filter, **Show Stats**, and an optional sound per packet (Geiger, Sonar or Water drip). Click a packet for its byte-by-byte breakdown. Each packet shows the date and time. Under **Filters**, **Hide malformed** hides channel messages of random characters or from a sender whose clock was never set; your choice is kept in this browser.

With an OpenHop radio a packet also shows the policy rule that decides it, for example **Drop rule** followed by the rule's name, in red for a drop. RTFM-EV works that out from a copy of the node's policy, so it is an indication: the node itself decides, and a rule changed on the node can take a minute to show. The rule is stored with the packet, so the line is still there after a reload and in Packet History. Under **Filters**, **Only packets a policy rule decided** leaves out everything else.

### Packet History

The same kind of list over everything stored in the database. Pick 1, 3, 6, 12 or 24 hours or a date range, then **Load older** to page back. Filter by payload type, hop width or hex, and search message text, sender or channel. Select rows and **Export CSV**.

With an OpenHop radio, packets received since the update that added this also show the policy rule that decided them, as in the Packet Feed. The search finds a packet by the name of that rule, **Filters** has **Only packets a policy rule decided**, and the CSV has a column for the action and one for the rule. A packet heard several times is stored once, with the rule of its first reception. How far back it reaches depends on your data retention settings.

### Analyze Packet

Paste a raw packet as hex to see it decoded byte by byte.

### Who heard this

Every packet breakdown (from the Packet Feed, Packet History, a message or Analyze Packet) has a **Who heard this** section. It shows the packet hash, which is the same for every relayed copy of one packet, and a link to the packet's page on each analyzer site you configured with a packet address (Settings > Database).

**Ask** sends that hash to the analyzer at the Analyzer URL of the external node overlay (meshcore-analyzer.eu by default, whatever the node source) and lists the observers there that received the packet, with region, time, RSSI and SNR. That lets you compare your own reception with the rest of the mesh. Nothing is sent until you press the button, and the analyzer gets the hash, not the packet. It only knows what its own observers heard, so an empty answer does not mean nobody heard the packet.

### Mesh Visualizer

A 3D graph of the mesh built from live packets. Nodes are spheres and packets are animated arcs. Controls tune which nodes are shown and how the graph moves, and **Clear & Reset** starts over.

### Trace

Build a loop of repeaters and trace it back to your radio. Search repeaters by name or key and add them in the order to traverse, or add a custom hop as a 1, 2 or 4 byte prefix. Then **Send trace**. Results show the SNR per hop and a small map. This transmits over RF.

### Message Search

Full-text search across direct and channel messages. Use `user:` or `channel:` to narrow results (put names with spaces in quotes). `region:` filters by the region a message was sent with: a region name, `region:none` for messages sent without a region, or `region:unknown` for a region this app cannot name. Click a result to jump to that message.

### Mentions

Every stored message that mentions you as `@[your radio name]`, in channels and DMs, newest first. It hides what the chat hides (blocked senders, bots when hidden, hidden hop widths and SFs, malformed and spam messages when hidden). Click a mention to jump to it; **Load more results** goes further back and the refresh button reads the list again.

### Channel Registry

A local catalog of known channels. It is a reference list, not the channels the app monitors. You can add, edit, filter, import and export entries, sync from a remote list, and use **Add to Channels** to start monitoring one. Private entries are never exported. In a channel, the registry icon in the header (or **Edit in Channel Registry** in the channel info panel) opens that channel's entry straight in edit mode, adding it first if it is missing.

### Channel Finder

**Show Channel Finder** opens a panel that tries to find the names of channels you have no key for, using wordlists and brute force on your GPU. **Wordlists** picks which lists are used, in any combination: English, Dutch, **Known channels (MCCL)** (a short list of channel names seen on the mesh, on by default) and lists you upload. It needs a browser with WebGPU (for example Chrome or Edge 113 or newer) and HTTPS when you are not on `localhost`. Found channels can decrypt stored packets.

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
- On meshcomod (DMC-EV) firmware, a **Meshcomod (DMC-EV)** panel with CAD and GPS controls. Builds with the receive filter add a **Companion receive filter** card: filter settings, sender and text rules, blocked path prefixes, hidden-message counters with a history chart, and a per-radio backup you can restore after a flash. It runs on the radio and never transmits.
- meshcomod also lists a **Meshcomod** contact. Its chat is your radio's own command line: what you send there (`help`, `status`, `wifi scan`, `wifi status`, `tcp on`/`off`, `ble on`/`off`, `ota check` and more) runs on the radio and never goes out over LoRa, and the radio answers in the same chat. Buttons above the chat put a common command in the message box. Commands that restart the radio or can cut the app off from it (`reboot`, `bootloader`, `ota update`, `wifi off`, `wifi clear`, `tcp off`, `ble off`) ask first. The command line in **Settings > Radio** and on **My Node** takes these commands too: it sends them to the Meshcomod contact and shows the answer, which also lands in this chat. The chat is not sent to MQTT, Home Assistant or other integrations, and gives no notifications; trace, path discovery, telemetry and the permission switches are hidden for this contact.

### Host repeater

RTFM-EV can judge every received packet the way a repeater would. **Shadow mode** counts what would be forwarded or dropped, and never forwards anything. Region gating, an airtime budget, timing and policy rules are configurable, with live statistics. Live repeating (armed mode) needs the server setting `MESHCORE_HOST_REPEATER_ENABLED=true`, supported firmware, a permitted frequency band and an explicit confirmation. **Disarm (kill switch)** stops it, and it always starts disarmed after a restart. Make sure you are allowed to run a repeater where you are. The **DMC packet filter** matches the DMC observer firmware: hop and rate limits, blocked channels and path prefixes, sender and text rules, a per-node advert window, a message age limit and a **Dry-run** switch that only counts. The optional **Neighbour poll** transmits: every 12-336 hours it sends one zero-hop discover and asks each neighbouring repeater for its regions.

### Local Configuration

Settings for this browser or device: language, color theme (including four CRT phosphor themes) and CRT screen effects, the **Desktop buddy** (after you have used the Windows 95 theme), branding (app name and icon, shared by all devices), a local label banner, **Distance Units**, **Coordinate format**, **Date & Time Format**, relative font size, **Accessibility** (a colourblind mode and a reading font for dyslexia, on top of any theme), UI tweaks (such as reopen last conversation, battery display and **Replace as you Type**), the mention and DM sound, new node notifications, **Chat parsing** and **Web Push Notifications**. **Sign-in Redirect** is for an instance behind a reverse proxy that handles sign-in: when the session has run out, the app goes to the address you enter, or reloads the page when the field is empty.

### Bot lists

A bot list names known bots: an exact sender name, with an optional public key and note. The lists are under **Settings > Local Configuration > Bot lists**.

- **Enable** a list and its senders get a **Bot** marker in chat. A name is matched exactly, capitals included, so a person who uses the same name is marked too. **Never a bot** takes a name out, whichever list names it.
- **Hide bots** (there, or in the chat filter menu) hides listed senders in chat and keeps them out of unread counts, mentions and notifications. Search still shows them.
- **New list** makes a list of your own and **Names** opens it for editing. In chat, the actions of a message offer **Add to bot list** and, for a listed name, **Not a bot**.
- **Export** writes a list to a file. **Import file** stores such a file as a new list of your own, switched off, so you can read it before you enable it.
- **Subscribe to URL** takes the `https` address of a list file. It shows the list before storing it, keeps it read-only and switched off, and refreshes it once a day; **Refresh now** does that at once. The host of the list sees your internet address on each refresh. A refresh that fails keeps the names you have and shows why.
- One list ships with RTFM-EV. It is read-only and off until you enable it.
- **Block forwards** (per list, off by default) stops your repeater relaying channel messages from the names on that list. It works through Spam Guard: only in **Protect**, on its protected channels, and on air only while the host repeater is armed or the rules are on the OpenHop node. The line under the switch says **Active on N channels**, or what it is waiting for.
- Names that a refresh adds to a subscription are marked in chat at once, but your repeater only stops relaying them after you confirm them. The list then shows **N new names to review**, with **Confirm**, **Confirm all** and **Not a bot**. Switching Block forwards on for a subscription first shows its names.

Block forwards only stops your own repeater: other repeaters still relay the message, and it still arrives at your node. It covers channel messages only, because a repeater cannot see who sent a direct message. Anyone who posts under a listed name is stopped too.

### MQTT & Automation

Integrations (see Integrations).

### OpenHop

Only shown when the connected node is an OpenHop node. Set the OpenHop API address and token, then manage its configuration, system, updates, policy and plugins. Actions with real effect ask for confirmation.

### Radio-App Management

**Tracked Repeater Telemetry** and **Tracked Contact Telemetry**, name resolution for unnamed contacts, **Contact Management** (block new node types, blocked keys and names, bulk delete), **Loadouts**, and **Partial node sync**, which matches nodes you only know by prefix against the analyzer directory. You review each match before it is saved as a reversible soft link. Telemetry is collected once per hour, at the **Minute of the hour** set under Tracked Repeater Telemetry. **Automatic** takes a minute from your radio's key; give nodes that are near each other different minutes so their requests are not on air at the same time.

**SNMP agent** (off by default) lets a monitoring system such as LibreNMS or Zabbix poll this node over SNMP, with the 22 values of the first observer firmware release. Set the UDP port and your own community; in Docker, publish the port as well. It is read-only and never uses the radio.

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
- **Community MQTT/meshcoretomqtt:** a raw packet feed for community aggregators, so your radio can act as an observer. Regional presets are built in. Under **Publish packets** you can tick the payload types to send (none ticked sends all). Packets heard while the broker cannot be reached are kept (up to the number you set, 500 by default) and sent with the time they were heard once the connection is back. **Show the broker's refusal messages** reads the broker's error topic for your node, for brokers that publish one.
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

**"Some messages may be missing" after a reconnect.** While RTFM-EV is not connected the radio keeps only a few messages (16 on most boards) and drops the oldest channel messages first. The warning shows when the radio's queue was full on connect, so channel messages heard in that time may be lost. Keep the app connected to avoid it.

**Warning that automatic DM acknowledgement may not work for all contacts.** The radio contact table is full or could not be read. Sending and receiving still work. Lower **Max Contacts on Radio**, or clear the radio's contact table with another MeshCore client and restart.

**MQTT does not connect on Windows.** Start the server with `--loop none`.

**Channel Finder says WebGPU is not available.** Use Chrome or Edge 113 or newer, over HTTPS unless you are on `localhost`.

**Web Push does not work.** Push needs HTTPS. For iOS and Safari, set `MESHCORE_VAPID_SUBJECT` to a real `mailto:` address.

**A message shows Failed.** No acknowledgement arrived after all retries. Use **Retry** to send a new copy.

**Reporting a bug.** Start the server with `MESHCORE_LOG_LEVEL=DEBUG` and use **Open debug support snapshot** under Settings > About. Logs can contain channel names or keys (never your private key), so check what you share.
