# Changelog - RTFM-EV (DMC-EV fork)

This changelog covers work done in the **RTFM-EV** fork
(`Elektr0Vodka/RTFM-EV`) since it diverged from upstream
`jkingsman/Remote-Terminal-for-MeshCore`.

- Fork base commit: `33b3b8d` (upstream `main`), 2026-07-26
- Commits since fork: 456 total (307 non-merge), as of `c0985781` (#242)
- Generated: 2026-09-10; updated 2026-09-26

Entries are grouped by area and reference the non-merge commit that introduced
the change. Upstream development is on hold; the fork is the active repository.

## Update 2026-10-11 (node clocks from adverts and repeater clock sync, feat/advert-clock-drift-sync)

Two features found in a review of other forks of upstream (tristandostaler
`0e9be199`, `e63abb8d`, `d929000e`; upstream issue 359). Written for this
codebase, with a smaller scope and two extra safeguards. Migration `_139`. No
new dependency. Clock sync is off until you opt a repeater in.

### Node clocks, read from adverts
- **Every advert carries the sender's own time.** It is part of the signed
  advert, so it cannot be changed on the way. The app used to throw it away.
  It is now stored next to the time the advert was heard
  (`advert_events.sender_timestamp`).
- **Contact info shows a Clock row:** "In sync" (within 2 minutes of this
  server), or how far the node runs ahead or behind. A node whose clock was
  never set reads years behind (the firmware starts at 15 May 2024).
- **Nothing is sent to measure this.** The value is as old as the last advert
  heard from the node. Adverts stored before this version have no sender time,
  so the row appears after the next advert.
- A relayed advert is a few seconds old when it arrives, so a correct clock
  reads slightly behind. The 2 minute margin absorbs that.
- Contact freshness (`last_seen`, `last_advert`) still uses this server's
  receive time and is not affected by a node's wrong clock.

### Repeater clock sync (opt-in)
- **New checkbox for a tracked repeater**, in the telemetry history pane of
  its dashboard: "Set this repeater's clock when it runs behind".
- **When it sends:** during a telemetry collection, after the repeater
  answered the status request, and only if its newest advert shows the clock
  more than 2 minutes behind. Then one CLI command `time <now>` is sent and the
  reply is read. This is the case from upstream issue 359: a repeater without
  GPS that rebooted and lost its clock.
- **At most one send per new advert.** An advert heard before the last attempt
  still shows the old clock and is not acted on again, so a repeater that
  never answers is not asked every cycle.
- **The server clock is checked against the mesh first.** The firmware only
  moves a clock forward, so a wrong server time pushed into a repeater cannot
  be undone from here. Before sending, the median clock offset of the other
  nodes heard in the last 24 hours is taken. At least 5 nodes are needed and
  the median must be within 5 minutes. If most of the mesh disagrees with this
  server, or too few nodes were heard, nothing is sent.
- **A repeater that runs ahead is left alone** and noted in the server log.
  `time` cannot set a clock back; only `clkreboot` can, and that is not sent
  automatically.
- **Needs admin permission on the repeater.** The firmware accepts CLI
  commands only from a client it has stored as admin (it keeps that list
  across reboots). Log in once with the admin password. Without it no reply
  comes, which is logged.
- **Each sync is an RF transmission** (one command, one reply).
- Turning telemetry tracking off for a repeater turns its clock sync off too.
- The outcome is in the server log only (set, refused, no reply, or why
  nothing was sent). The Clock row in the contact info updates with the
  repeater's next advert.
- The manual **Sync Clock** button in the repeater dashboard is unchanged.

### Not taken from tristandostaler
- The clock history tables, the per-node statistics page and the drift
  ranking.
- The automatic `clkreboot` for a repeater that runs ahead (it reboots a
  remote repeater on its own).
- The NTP and HTTP check of the server clock. The mesh check above replaces
  it and needs no outside server.
- Sending `time` on every telemetry cycle whether or not it is needed.

### Backend
- Migration `_139`: `advert_events.sender_timestamp` (nullable) and
  `app_settings.clock_sync_repeaters` (JSON list, default empty).
- `POST /api/settings/clock-sync-repeaters/toggle` (400 for a repeater that is
  not tracked). `GET /api/contacts/analytics` gains `clock`
  (`offset_seconds`, `measured_at`, `state`). The tracked-telemetry toggle
  response gains `clock_sync_repeaters`.
- New: `app/services/clock_drift.py` (pure decision logic),
  `send_cli_on_held_radio` in `app/routers/server_control.py`. It puts a
  command on air by the same rules as the console (2026-10-10 entry below):
  the `XX|` reply tag, and an empty command as one space. Tests:
  `tests/test_clock_drift.py`, `tests/test_migrations/test_migration_139.py`,
  `frontend/src/test/repeaterClockSyncToggle.test.tsx`.

## Update 2026-10-11 (tap tooltips and CLI command suggestions, feat/tap-tooltips-cli-autocomplete)

Two interface features found in a review of other forks of upstream. Frontend
only: no backend change, no migration, no new dependency.

### Interface: explanations on touch screens (tristandostaler `8c57cb46`)
- **Tap to read a tooltip.** Most explanations in the app are native `title`
  tooltips, which a touch screen never shows. Tapping an element that has one
  now shows the text in a small bubble above it (below when there is no room).
- **Closes on:** a second tap on the same element, a tap anywhere else,
  scrolling, resizing, Escape, or a change of view.
- **Touch and pen only.** A mouse keeps the browser's own hover tooltip and
  gets nothing extra.
- **Buttons, links, inputs and other controls are left alone:** tapping those
  does what they are for. A titled element that reacts to a click without
  being marked as a control still does its own thing and shows the bubble too.
- One listener on the document (`TapTooltipLayer`, mounted in `main.tsx`, so
  the chat window has it as well). `data-no-tap-tooltip` on an element opts
  its subtree out.
- Not taken from the fork: the bubble on a mouse click and on a long press.
  This app has no long-press menu for the bubble to compete with.

### Repeater console: command suggestions (wchaney817 `3011b25f`, `08f4943c`)
- **Type-ahead in the repeater and room console.** While you type, matching
  commands are listed with their parameters and a one-line description. The
  firmware has no `help` command.
- **Keys:** Tab completes the first (or highlighted) suggestion, the arrow
  keys move through the list, Enter fills in the highlighted one, Escape hides
  the list until the text changes. A click fills one in as well.
- **A suggestion only fills the input.** Nothing is sent until you press Send,
  or Enter with nothing highlighted.
- **A line that starts with a space gets no suggestions.** The console sends a
  line as typed (2026-10-10 entry below) and the firmware's `region load`
  reads the leading spaces as the nesting depth of a region name; a completion
  would replace them. An empty line is still sent as before.
- **History recall is unchanged:** with an empty input the arrow keys recall
  sent commands, and the list stays hidden while you step through them.
- **The table is the stock MeshCore CLI** (143 commands). Checked on
  2026-10-10 against `meshcore-dev/MeshCore`: 140 are in
  `docs/cli_commands.md`, the `io` GPIO commands are in the sensor example
  source, and the "serial only" marks match the `sender_timestamp == 0` gates
  in `CommonCLI.cpp`.
- Two corrections to the fork's table: `region def` completed to
  `region def ...]`, and the bare `region` dump was marked serial only, which
  the docs limit to firmware before 1.12.0.
- **Limits:** descriptions are English only. Commands that exist only in DMC
  repeater, DMC MQTT or observer firmware are not in the table; the CLI docs
  link in the console header covers those. Commands marked "serial only" are
  listed for reference and do not work over RF.
- Not taken from the fork: `README_CLI.md` (a 1270-line CLI reference).

## Update 2026-10-11 (known channels list, region search, route timeouts, feat/channel-list-region-search-timeouts)

Three small features found in a review of other forks of upstream. No
migration, no new dependency.

### Channel finder: Known channels (MCCL) list
- **A fourth list under Wordlists:** "Known channels (MCCL)", next to English,
  Dutch and your uploads. It holds the 2560 hashtag channel names of the
  [MCCL](https://github.com/Elektr0Vodka/MCCL) list
  (`list_nl/channel-rainbow.json` at `eff8c3b8`, 2026-10-10). Of those names
  1872 are not in the Dutch list and 1423 are in neither bundled list.
- **Any combination can be on.** Each list has its own checkbox, as before.
  With only the known channels on, a dictionary pass tries 2560 names
  instead of several hundred thousand.
- **On by default,** also for a browser that already saved a selection
  without it. English stays on and Dutch stays off by default.
- The file is `frontend/public/wordlists/known-channels.txt`, a snapshot. It
  does not update itself; rebuild it with `scripts/build_mccl_wordlist.py`
  (same normalizer as uploads). For a live list, the registry sync URL in
  Settings > Database already reads the same MCCL file, and "Sync from
  channels" adds those names to the finder.

### Search: `region:` operator
- `region:<name>` next to `user:` and `channel:`. The name is compared
  without case and without a leading `#`, so `region:nl-gr` and
  `region:#NL-GR` find the same messages.
- `region:none` finds messages sent without a region (no transport code).
  `region:unknown` finds messages with a region this app could not name (a
  transport code that matched no entry in known regions). These are the same
  three states the region badge under a message shows.
- Several `region:` terms are combined with OR, and with the other operators
  and free text with AND. A region literally named `none` or `unknown` cannot
  be searched by name.
- Limit: a message stored before region tagging existed has no transport code
  and so counts as `none` until the region backfill has run.

### Repeater, room and telemetry requests: waits scale with the route (f3sty `5267f857`, `891a452f`)
- **A contact on a known route gets more time to answer:** the wait used so
  far plus 5 seconds per radio hop, capped at 30 seconds. A route through two
  repeaters is three hops, so a status request waits 25 seconds instead of 10.
  A contact reached by flood keeps the old wait, because a flood has no known
  hop count.
- **Login floods less eagerly.** A login that gets no answer on its route
  resets the path and repeats as a flood. The first attempt now waits 10 to 30
  seconds depending on the route instead of 5, so a slow answer over several
  hops no longer triggers the flood. The flood retry itself still waits 5
  seconds.
- Applies to: repeater and room login (first attempt), status, LPP telemetry,
  neighbours, ACL, regions, owner info, CLI commands and the batched CLI
  reads, path discovery, on-demand contact telemetry, and the scheduled
  telemetry collector.
- **Side effect:** an unreachable contact on a long route now holds the radio
  for up to 30 seconds per request instead of 10, and the telemetry collector
  takes longer per unreachable repeater.
- **Not scaled:** a console line that is empty or starts with a space (a
  `region load` line, 2026-10-10 entry below). The firmware answers none of
  those, so each one waits out the whole timeout, and that stays 20 seconds.
- Not taken from those two f3sty commits: the higher base login wait (5 to 10
  seconds, also for the flood retry), and the trace timeout changes. f3sty's
  telemetry minute (`ccf98498`) is a separate change, in the 2026-10-10 entry
  below.
- New: `app/services/route_timeout.py`. Tests: `tests/test_route_timeout.py`,
  `tests/test_repeater_routes.py::TestRouteScaledTimeouts`.

## Update 2026-10-11 (packet inspector: who heard this, feat/packet-who-heard)

One feature found in a review of other forks of upstream (wchaney817
`37b82ce1`, which asks a CoreScope instance in North Texas). Rewritten for the
EU analyzer this fork already uses. No migration, no new dependency.

### Packet inspector: Who heard this
- **New section in every packet breakdown** (Packet Feed, Packet History, the
  packet behind a message, Analyze Packet). It shows the **packet hash**: the
  firmware's own hash, which leaves the path out, so every relayed copy of one
  packet has the same hash.
- **Links to the packet's page** on each analyzer site that has a packet
  address (Settings > Database). That setting existed, but no screen used it:
  the **Look up sender on** buttons in the same breakdown (2026-10-10) open
  the sender's node page, not the packet.
- **The Ask button** (it names the host) asks the analyzer which of its observers received this
  packet and lists them, oldest first: name, region, time (with the delay
  after the first reception), RSSI and SNR, plus the number of receptions and
  of distinct observers. Compare that with your own reception to see where a
  packet did and did not arrive.
- **The host** is that of the external map source (Settings > Database,
  `external_map_sync_url`; `meshcore-analyzer.eu` by default), the same one
  the route check for suggested DM routes uses.
- **Privacy:** opening the inspector sends nothing outside your server. The
  analyzer is asked only when you press the button, and it gets the packet
  hash, not the packet. The section says so and names the host.
- **Limits:** the analyzer only knows what its own MQTT observers heard, so
  "has not seen this packet" does not mean nobody heard it. At most 500
  receptions are listed (a note says when there are more). The hash is the
  EU analyzer's too (checked on 200 live packets on 2026-10-10); another
  analyzer site may use a different hash, in which case its link finds
  nothing.

### Backend
- `POST /api/packets/who-heard` (`{data, lookup}`): takes raw hex so a pasted
  packet works as well. `lookup` false only hashes and builds the links;
  `lookup` true also calls `GET {host}/api/packets/{hash}`. 400 for data that
  is not a packet, 502 when the analyzer cannot be reached or answers
  unusably.
- New: `app/services/analyzer_packet_lookup.py`. Tests:
  `tests/test_packet_who_heard.py` (including our hash against a real
  analyzer packet), `frontend/src/test/packetWhoHeard.test.tsx`.

## Update 2026-10-10 (community bug fixes and enhancements, fix/community-bugfixes-enhancements)

Seven fixes found by reviewing the open upstream issues and the forks that are
ahead of upstream (`tristandostaler`, `wchaney817`, `f3sty`), plus fork issue
#263. Each is written for this tree with a test that failed first; no fork code
is copied as is. Migration `_138`. No new dependency.

### Rooms
- **Room chat shows again when you come back to a logged-in room**
  (tristandostaler `f52d4463`, upstream issue 301 item 4). The conversation
  pane reset its login gate from an effect. That effect ran after the
  remounted room panel had reported its cached login, so the chat and the
  composer stayed hidden until a page reload. The gate is now reset during
  render.
- **A confirmed room login fetches the messages already waiting**
  (tristandostaler `70d133dc`). The room server pushes the posts since the last
  sync as soon as it accepts the login. Auto-fetch is stopped for the duration
  of the login and `meshcore` does not look at the queue when it starts again,
  so a post that arrived in that window stayed on the radio until the next
  message or the hourly audit. `POST /api/contacts/{key}/room/login` now asks
  the radio once after an authenticated login. This talks to the own radio
  only, nothing more goes on air. Not done after a refused or unconfirmed
  login.

### Repeaters
- **The "login not confirmed" warning goes away once the login has proved
  itself** (wchaney817 `63cc1c5a`, upstream issue 326). A pane fetch or a
  console command that the repeater answered marks the last login attempt as
  confirmed and clears the error. A failed fetch leaves the warning in place.
- **The console sends a line exactly as typed** (tristandostaler `ba60f996`,
  `de03b643`). Leading spaces were trimmed and an empty line could not be
  sent, so the firmware's interactive `region load` could not be used: it
  reads the leading spaces as the nesting depth and a blank line as the end
  (`MyMesh::handleCommand`, simple_repeater and simple_room_server). Now:
  - the Send button is active on an empty input and the history shows
    leading spaces; empty lines are left out of the arrow-up recall;
  - the API accepts an empty command (`CommandRequest.command`);
  - an empty command goes on air as one space, because the companion firmware
    refuses a text frame without a text byte (`CMD_SEND_TXT_MSG` needs
    `len >= 14`) and the repeater counts a line of spaces as blank
    (`StrHelper::isBlank`). tristandostaler sends a NUL byte here; a space is
    used because the blank check for it is in the firmware source;
  - a line that starts with a space gets no `XX|` reply tag. The firmware
    strips no tag while a load is running, so a tagged line would count as
    depth 0 and be dropped.
  - Not tried on a repeater. The firmware sends no reply to a load line, so
    each one waits out the normal reply timeout before the next can be sent.

### Telemetry
- **Scheduled telemetry no longer runs at the top of the hour** (f3sty
  `ccf98498`, extended). Every instance woke at minute 0 UTC, so all their
  requests went on air at the same moment. The scheduler now wakes once per
  hour at a minute of its own.
- **That minute can be set**: Settings > Radio & App > Tracked Repeater
  Telemetry > **Minute of the hour**. **Automatic** (the default) takes it
  from the connected radio's public key (first two bytes modulo 60), so it is
  the same after a restart and differs between radios; while no radio is
  connected it is 0. Or pick `:00` to `:59`, so nodes near each other can be
  given different minutes. `app_settings.telemetry_schedule_minute`
  (migration `_138`, `-1` = automatic), `PATCH /api/settings`, and
  `schedule_minute` / `schedule_minute_auto` on the telemetry schedule.
- The hour gate is evaluated at most once per UTC hour, so moving the minute
  later within an hour does not run a second cycle. A changed minute applies
  from the next wake. The interval and the 24 checks per day ceiling are
  unchanged; which hours run is still counted in UTC.
- The "Next run at" line now shows that minute; its suffix reads "(hours
  counted in UTC)" in place of "(UTC top of hour)".

### Behind a reverse proxy
- **A run-out sign-in session is noticed** (wchaney817 `d33c90ba`, upstream
  issue 346). When a proxy in front of the app (Authelia, oauth2-proxy)
  answers with `401`, or with a `403` that is not the backend's own, the app
  goes to the address under Settings > Local Configuration > **Sign-in
  Redirect**, or reloads the page when that is empty. Before, it kept showing
  stale data while every request failed.
  - The backend's own `403` (private key export while disabled) is a JSON
    answer with `detail` and does not trigger it.
  - The WebSocket hides the status of a refused handshake, so after three
    failed connections in a row `/api/health` is asked over HTTP.
  - At most one automatic redirect per minute (`sessionStorage`), so a reload
    that does not bring the session back cannot loop.
  - Only a path on the same site or an `http(s)` address is accepted.
    `frontend/src/utils/authRedirect.ts`; the prefetch script in `index.html`
    repeats the check for the first requests of a page load.
  - The address is checked again at the moment it is used, not only when it
    is saved, and the navigation target is rebuilt from the parsed parts
    behind a literal `http://` or `https://`. A value put into browser storage
    by other means (`javascript:`, `data:`, `//other-site`) leads to a plain
    reload. Found by CodeQL (`js/xss-through-dom`) on the pull request: the
    first version passed the stored value to the navigation as it was.
  - The query and the fragment of the address are percent-encoded once more
    before use (`encodeURI`, plus the single quote). Escapes that are already
    there are kept, so `?rd=https%3A%2F%2Fapp%2F` stays as it is; square
    brackets, quotes and angle brackets become `%5B`, `%27`, `%3C` and so on.
    CodeQL kept flagging those two parts after the scheme was fixed. Behind a
    fixed `http(s)` scheme they cannot run script, so this changes what the
    scanner can prove more than what a browser would do.
  - Not tried behind a real proxy: tests only.

### Interface
- **A dialog taller than the screen can be scrolled** (tristandostaler
  `233c088b`). `DialogContent` is centred by a translate and had no height
  cap, so a tall dialog ran off both edges and its close button out of reach.
  It now caps at the viewport and scrolls. Dialogs that already cap
  themselves and scroll an inner region keep their own classes.
- **Analyzer look-up in two more places** (issue #263, plan 04 steps 3 and 4):
  - Chat header of a contact: a look-up icon, shown when at least one
    analyzer is configured. One site opens directly; with several it opens
    the contact info pane, which lists them. Disabled for a contact known by
    key prefix only.
  - Packet detail: **Look up sender on** a site, one button per analyzer,
    only when the packet resolved to a full sender key
    (`decrypted_info.contact_key`). Wired for the live packet feed.
  - Links open in a new tab with `noopener,noreferrer`. The public key is
    sent to that external site, which the tooltip says.

### Noticed, not changed
- Any operation that suspends auto-fetch (repeater login, telemetry, CLI) has
  the same gap as the room login had: `start_auto_message_fetching` only
  subscribes, it does not check the queue. Only the room login is changed
  here.
- Some locale strings use `{{name}}` where the translator takes `{name}`
  (`repeater_owner_info_conflict`, `openhop_config_mode_saved`), which leaves
  a pair of braces around the value.

## Update 2026-10-09 (Spam Guard: channel spam protection, feat/spam-guard-completion)

Migration `_137`. No new dependency. Off by default.

Behaviour is modelled on [openhop-spamguard](https://github.com/flackrat/openhop-spamguard)
v5.11.3 (features, default numbers and worked examples). The code is written
from scratch for this codebase; no SpamGuard source is copied.

### Spam Guard (new)
- **Detects channel spam behaviour, never people or opinions:** the same or a
  similar text under several made-up, disguised or brand-new names (also with
  words added, look-alike letters, leetspeak or emoji tricks), floods of
  copies, repeaters that spam enters the mesh through, and a spammer whose
  repeater keeps changing its identity. Every automatic block expires.
- **Monitor and Protect.** It starts in Monitor, where spam is detected and
  shown but nothing is blocked. In Protect the host repeater does not forward
  what a block catches. Three sensitivity presets (relaxed, balanced, strict)
  plus every tunable with a note on its side effects. On an OpenHop radio
  Protect writes the rules into the node's policy (see below).
- **Known people.** Names seen sending genuine messages pass the blocks that
  hold people (a spam repeater, links from unknown names, a lockdown).
  **Lockdown** lets only known names through for 30 minutes to 2 hours.
  Messages from normal-looking names that were held are listed under
  "Possibly genuine, held" with **Let through**.
- **No "block this sender by name".** A repeater is shared, such a block is
  invisible downstream, and names can be copied.
- **Chat:** flagged messages carry a Spam marker, earlier copies of a campaign
  are flagged after the fact, and each incoming channel message has **This is
  spam** / **Not spam**. The chat filter menu and Settings offer **Hide
  spam**, which also keeps flagged messages out of unread counts, mentions,
  Web Push and the Ollama unread summary (`messages.spam`,
  `app_settings.hide_spam`).
- **Spam Guard page** in the sidebar Tools, listed only while the feature is
  on: Overview (mode, health, numbers and charts for 24 hours, 7 days and hour
  of day), Protection (blocks, held messages, lockdown, block a repeater or a
  text yourself), Messages (what it read and the signals it saw), Spam sources
  (first-hop repeaters in a table and on the map, with every contact that fits
  a short route code listed rather than guessed) and Settings (protected
  channels, tunables, exceptions, the rendered forwarding rules).
- **Settings > Local Configuration > Spam protection** has the master switch
  (`app_settings.spam_guard_enabled`) and Hide spam. The host repeater and
  OpenHop settings show a one line status.
- **OpenHop radio:** an OpenHop node forwards on its own, so in Protect the
  blocks are synced into its policy through its API
  (`services/spam_backend_openhop.py`). RTFM-EV reads `/api/policy`, keeps
  every rule that is not its own and writes its rules before and after them,
  named `rtfm-spam:...` with integer ids, plus the known-people object
  `@rtfmspam.known_senders`. Your rules, other objects, groups and
  `default_action` are passed through as read.
  - Written only on a change and at most every 2 seconds. The node is read
    again every 60 seconds and rules that are missing or altered are put
    back; Health counts those repairs and shows the sync state.
  - Needs the API URL and token under OpenHop management. Switches the
    node's policy engine on when there are rules to write, and never off.
  - Monitor and Pause write no rules and remove the ones that are there.
    Rules are also removed when Spam Guard is switched off, when another
    radio connects and when RTFM-EV shuts down, because an OpenHop rule
    does not expire by itself. A dropped link to the node does not remove
    them; blocks that end in the meantime are still taken off the node.
  - **Nothing is written to a node that has `spamguard:` rules** (a real
    SpamGuard runs there); rules written earlier are taken out and Health
    says why.
  - **A private channel's key stays here until you agree.** OpenHop needs
    the channel key inside a rule to read sender and text. For Public and
    hashtag channels that key is public. For a private channel the Settings
    tab asks, per channel, before the key is copied into the node's
    `policy.yaml` (`share_key` in the settings); until then that channel
    is left out of the rules and Health says so.
  - `/api/policy_validate` is not used as a gate: read from the OpenHop
    source, it only normalises the four top-level keys and cannot reject a
    rule. Rule ids are untyped on the node; ours are integers.
- **Host repeater:** blocks become managed policy rules evaluated around your
  own rules (`evaluate_layers` in `host_repeater_policy.py`). They are held in
  memory, never written into your stored policy, and are also evaluated while
  your own policy engine is off. A repeater block can match on the first hop
  ("starts at this repeater"), which OpenHop rules cannot express.
- API: `GET /api/spam-guard`, `PUT /api/spam-guard/settings` (versioned, 409
  when stale), `POST /api/spam-guard/action`, `GET /api/spam-guard/rules`,
  `GET /api/spam-guard/health` (503 when something is wrong). WS events
  `spam_guard` and `message_spam`. Health names what is wrong as codes only;
  the error text, which can quote a stored value or a node URL, goes to the
  server log.

### Spam Guard: evidence log, export and replay
- **Evidence log** (Settings tab, off by default): while it is on, every
  message Spam Guard analyses is kept with what it made of it (route, name
  signals, known or not, the block that caught it), and so is every This is
  spam / Not spam answer. Kept for 1 to 30 days (`evidence_days`, default 7)
  and deleted by the retention pruner. A record never holds a channel key,
  only a short one-way id of it.
- **Download** as JSON Lines: `GET /api/spam-guard/evidence?days=&scramble=`.
  A scrambled download replaces every sender name and `@[name]` mention with
  a code that is the same within that file and different in the next one,
  and leaves out the channel names. A name typed into a message as plain
  text cannot be recognised and stays.
- **Replay** (`POST /api/spam-guard/replay`): runs the stored log, or an
  uploaded evidence file, through a fresh detector with the settings in the
  form (unsaved changes included) and shows what would have been stopped on
  arrival next to what was stopped at the time, and for the messages you
  labelled: caught, flagged afterwards, missed, let through, wrongly held.
  Nothing is stored or changed. A replay starts cold, like a fresh install,
  and leaves out blocks and exceptions made by hand. At most 20000 messages
  per replay; measured cost is 6 to 8 ms per message on a busy synthetic
  channel.
- A scrambled file still replays properly: the look of each name (its score
  and whether it was disguised) is recorded, and the replay uses that
  instead of judging the codes. Trusted names do not apply to such a file.
- Detector: the shared text of a running campaign is now worked out once
  per set of copies instead of on every message.
- Channel messages the radio hands over without their raw packet (the
  `CHANNEL_MSG_RECV` fallback, for example messages it queued while RTFM-EV
  was away) are now analysed too: they are flagged in chat, count towards
  campaigns and known people, and go into the evidence log. They come
  without hop hashes, so they count as heard directly and never lead to a
  repeater block. They are timed at the moment they are pulled from the
  radio, which can be later than when they were sent.

### Differences from openhop-spamguard (deliberate)
- **Monitor writes no rules.** SpamGuard writes `log_only` rules in Monitor
  mode. Both OpenHop and the host engine stop at the first matching rule, so a
  `log_only` rule ahead of your rules would let through a packet one of your
  `drop` rules should stop.
- **Rotation blocks let known people through and are evaluated last.** In
  SpamGuard's order a rotation allow exception lets an unknown name past a
  lockdown.
- Sender history is pruned by last seen, not first seen, so a regular does not
  count as brand new again every 24 hours.

### Not in this change
- If RTFM-EV stops without a clean shutdown, or cannot reach the node's API,
  rules already on an OpenHop node stay there until it reaches the node
  again. They can be removed by hand in the node's policy editor (names
  starting with `rtfm-spam:`).
- RTFM-EV's own OpenHop policy editor lists the `rtfm-spam:` rules next to
  yours; a change made to them there is undone at the next check.
- Not tested on live RF. The OpenHop sync is tested against a fake of the
  node's policy API written from the OpenHop source, not against a real node.

## Update 2026-10-10 (community fork follow-ups, fix/community-fork-followups)

Four follow-ups to the community fork work (#288, #289). No migration, no new
dependency.

### Unread summaries (Ollama)
- **The newest messages are summarized.** With more than 100 unread, the
  oldest 100 after the read boundary were sent and the newest left out. Now the
  newest 100 are sent, still in time order.
- **The hop-size filter applies.** Messages hidden by "Hide by hop size" were
  still summarized. The summary now covers what the chat shows: no blocked
  senders, no hop-hidden messages, no malformed-flagged ones when that filter
  is on. The malformed filter also moved into the query, so it no longer eats
  into the 100.
- **The same question is not asked twice.** A summary was requested on every
  channel open. The last finished summary per channel is kept in memory and
  returned while the server URL, model, channel name and messages are the same
  (a second tab, a remount, "mark unread" and reopening). Two requests for one
  channel at the same time share one call to the model. A failed attempt is not
  kept. The cache is lost on restart.

### Messaging
- **Over-long text is refused by the server too.** The composer already blocked
  it; an API client could still send it. `POST /api/messages/direct` and
  `/channel` now answer 422 before anything reaches the radio when the text is
  over the firmware's 160 bytes (`MAX_TEXT_LEN`), for a channel counted
  together with the `"<radio name>: "` the radio puts in front. Over that
  limit the radio refuses a DM and cuts a channel message short without saying
  so. The composer's own limit (156) is unchanged and lower.

### Frontend
- **Two React hook dependency warnings fixed** (MESHRIK `5e1a0c89`): the Home
  Assistant MQTT editor made a new empty array for its tracked contacts and
  repeaters on every render, and the realtime handlers did not list
  `channelsRef`. Lint is down from four warnings to two.

## Update 2026-10-10 (Handy Info: Awesome MeshCore link, feat/handy-info-awesome-meshcore)

### Settings > Handy Info: Links (frontend)
- Added `https://github.com/samuk/awesome-meshcore` (a curated list of
  MeshCore resources) as a built-in link under **Community sites**, listed
  last in that group (id `link-awesome-meshcore`, label `Awesome MeshCore`).
  It shows up for existing users as well, including those who have
  customized the list, and can be hidden, edited or flagged for the
  Knowledge base like any other built-in. No backend change, no migration.
- Tests: `frontend/src/test/settingsHandyInfoSection.test.tsx`.

## Update 2026-10-09 (dependency updates, chore/dependency-updates)

Every dependency in the repo moved to its newest release that the rest of the
toolchain supports. No migration, no feature change. Screens are meant to look
exactly as before; see "Tailwind 4" for how that was checked.

### Backend (`pyproject.toml`, `uv.lock`)
- `uv lock --upgrade`: 58 packages. Largest steps: FastAPI 0.136 to 0.143,
  Starlette 1.3 to 1.7, uvicorn 0.40 to 0.54, pydantic 2.12 to 2.14,
  websockets 15 to 17, cryptography 48 to 50, apprise 1.9 to 2.0,
  pydantic-settings 2.12 to 2.15, urllib3 2.7 to 2.8, oauthlib 3 to 4,
  boto3 1.42 to 1.43, bleak 2 to 3, dbus-fast 3 to 5.
- `meshcore` pin 2.3.14 to 2.3.15. Tests pass; not tried on a radio.
- Tooling: ruff 0.14 to 0.16, pyright 1.1.408 to 1.1.414, pytest 9.0 to 9.1.
  ruff 0.16 also formats Python code blocks in Markdown under `app/`, which
  reformatted two blocks in `app/fanout/AGENTS_fanout.md`.

### Frontend (`frontend/package.json`)
- **React 18 to 19.** One type fix (`RefObject<HTMLDivElement | null>` in
  `useChartZoom`); no runtime change needed.
- **TypeScript 5.9 to 6.0.** Not 7.0: `typescript-eslint` (8.71.1, also its
  canary) supports `<6.1.0` and stops with "does not support TS 7.0", and lint
  is a CI gate. TypeScript 6 checks side-effect imports, so stylesheet imports
  are declared in `src/types/vite-css.d.ts`.
- **Tailwind CSS 3.4 to 4.3** (see below).
- **ESLint 9 to 10**, `eslint-plugin-react-hooks` 5 to 7, `typescript-eslint`
  8.56 to 8.71. The hooks plugin's `recommended` preset now includes the React
  Compiler rules (209 findings in code not written for the compiler), so
  `eslint.config.js` names the two classic rules instead. ESLint 10's new
  `no-useless-assignment` and `no-unassigned-vars` flagged four lines, fixed in
  `novaRecolor.ts` and `rawPacketInspector.ts`.
- **Vitest 4 to 5**, jsdom 25 to 30, `@testing-library/jest-dom` 6 to 7,
  Prettier 3.8 to 3.9 (eight files reformatted).
- lucide-react 0.562 to 1.54, three 0.182 to 0.186, maplibre-gl 6.10 to 6.13,
  recharts 3.8 to 3.10, Vite 8.1 to 8.3, the Radix packages, and the rest of
  the minor and patch updates. `autoprefixer` is gone (Tailwind 4 prefixes).
- jsdom 30 asks for Node 22.22.2+, 24.15+ or 26+ to run the tests. Building is
  unchanged.

### Tailwind 4
- Migrated with the official upgrade tool, then corrected by hand: the tool
  also renames words that are not class names. It turned the host repeater mode
  value `'shadow'` into `'shadow-sm'` (in `types.ts`, `api.ts`, the hook and
  the settings screen) and `variant="outline"` into `"outline-solid"`. Those
  lines were restored by hand; `tsc` and the tests confirm none is left.
- Configuration moved from `tailwind.config.js` (removed) into `@theme` in
  `src/index.css`. PostCSS uses `@tailwindcss/postcss`.
- Rules added so the result matches Tailwind 3, each one explained where it
  stands in `index.css`:
  - `themes.css`, `styles.css` and `popout.css` are imported through
    `src/app-layers.css` into Tailwind's `utilities` cascade layer. Unlayered
    they would beat every utility regardless of specificity.
  - The universal `* { margin: 0; padding: 0 }` reset moved from `styles.css`
    to `@layer base`. Left after the utilities it cancelled every `space-y-*`.
  - `space-x-*` / `space-y-*` keep their Tailwind 3 behaviour (margin on the
    start of each child but the first, at class specificity). Tailwind 4's
    end margin does nothing on an inline child, which removed the gap under
    `<span>` and `<label>` headings. The responsive `sm:space-x-*` classes on
    the dialog and sheet footers have their own rule; without it the footer
    buttons touched. `src/test/tailwindCompat.test.ts` fails when a `space-*`
    class is used that has no rule.
  - `hover:` applies on `:hover` everywhere, not only on hover-capable
    pointers; buttons keep `cursor: pointer`; the text-size utilities keep
    absolute line-heights; the 36 default-palette shades the app uses keep
    their Tailwind 3 sRGB values (Tailwind 4 redefined the palette in OKLCH).
- Check: computed styles (43 properties) and positions of every element were
  compared between the build before and after the migration, on a scratch
  backend with a copy of the live database. Ten screens in the default theme
  (channel chat, Mesh Health, Packet Feed, SNMP, Channel Registry, My Node,
  Mesh Discovery, Message Search, Mesh Trends, Settings) and the channel chat
  in Light, CRT Green, MCEU Light, Windows 95 and DarkDutch: no style
  difference except `divide-y`, whose 1px line now belongs to the row above
  instead of the row below (same pixels).
- Second check, after the merge with main (MCEU layout), same method at
  1440x900. Default theme and MCEU Dark: the map and its five panels, the
  visualizer, channel chat, a DM, contact info, New Conversation, the theme
  dialog, Customize sidebar, Channel Import / Export, the command palette,
  Local and Database settings and Packet History. Light, Windows 95, CRT
  Green and MCEU Light: eight of those. MCEU Light at phone width: six. The
  generated class names of both builds were compared as well. Found and fixed:
  - Dialog and sheet footer buttons lost their 8px gap (`sm:space-x-2`, see
    above).
  - `bg-black/10` on the corrupt-message avatar got no CSS: Tailwind 4 reads
    class names as whole tokens and this one was written directly against a
    `${` in a template string. `ContactAvatar` uses `cn()` now; the same test
    file fails on a class glued to a placeholder.
  - `h-4.5 w-4.5` on 22 icons in the contact and channel info panes is not a
    Tailwind 3 class, so those icons had lucide's default 24px. Tailwind 4
    accepts the class and would shrink them to 18px. They are `h-6 w-6` now,
    the size they had.
  With those fixed no element differs in position. Left over, all equivalent:
  `translate` instead of a `transform` matrix, `outline-style: none` instead
  of a transparent outline, ring shadows without the zero-width offset shadow,
  and a transparent background on native range, checkbox and radio inputs
  (Tailwind 3 left the browser's field colour, which Chrome does not paint
  under a native control; not confirmed by pixels, the browser pane was
  hidden). The map and visualizer canvases are WebGL and were not compared
  pixel by pixel. Not covered: repeater dashboards (need a radio login).
- Third check, after the merge with the community fixes and features (#288,
  #289), in the default theme and MCEU Light, on a scratch backend with a
  stand-in Ollama server: the unread summary banner, the unread-summary
  settings block, the region dialog for a contact and for a channel, the last
  chat rows with the unconfirmed-send mark, plus chat, DM, contact info, map,
  New Conversation and Local settings again. No element differs in position
  or style. The code those two pull requests added needed no class renames.
- Tailwind 4 needs Safari 16.4, Chrome 111 or Firefox 128 and newer.

### Build and CI
- Dockerfile: uv image 0.6 to 0.13. Node 24 and Python 3.14 stay: Node 26 is
  not LTS yet and Python 3.15 is a release candidate.
- GitHub Actions: checkout v7, setup-node v7, setup-python v7, setup-uv
  v10.3.0 (no moving major tag exists after v7), codeql-action v4, docker
  build-push v7, metadata v6, login v4, setup-buildx v4, deploy-aur v4.2.0.
  The quality and CodeQL workflows passed on the pull request with the new
  versions. The Docker ones first run on the push to `main` and the AUR one on
  a release; the inputs the workflows pass were checked against each action's
  `action.yml` at the new tag and all still exist.
- `tests/e2e`: Playwright 1.58 to 1.64. Playwright 1.64 loads the config and
  lists all 51 tests in 27 files. The suite was not run: its global setup
  requires a connected radio and the specs transmit.
- `LICENSES.md` regenerated with `scripts/build/collect_licenses.sh`. The
  committed file was out of date and still listed removed packages (leaflet,
  react-leaflet, CodeMirror). On Windows the script needs
  `PYTHONUTF8=1`, otherwise the Python half is written in the console code
  page and names with accents break.

## Update 2026-10-10 (community fork features, feat/community-fork-features)

Three features, stacked on the community fork fixes below. Two migrations
(`_135`, `_136`), no new dependency.

### Room servers: auto-login on open and Sync Now (issue #262)
- Re-applies the fork's own earlier work (`f854c671`, never merged; the same
  idea is in the `statico/remoteterm-meshcore` fork as `b027b731`).
- **Sync Now** button next to Show Tools once logged in to a room. It sends the
  room login again, which the firmware answers with recent messages. Disabled
  while a login is running.
- **Auto-login on open** in the room chat (the surface mobile uses): when a
  password is remembered for that room, one login is sent on opening it. It
  fires at most once per open and never retries after a failure, so a room
  server that is down does not cause repeated logins.
- A login is an RF transmission. The panel therefore only auto-logs in where it
  is asked to (`autoLogin` prop, set by the room chat). The desktop full-page
  contact view embeds the same panel and does not auto-login; Sync Now works
  there after a manual login.
- `useRememberedServerPassword` also returns `storedPassword` (the value read
  from storage, unchanged while typing), which the one-shot auto-login keys on.

### Per-contact region for direct messages (statico `88f05cf7`)
- The globe in the chat header now also works in a contact conversation, with
  the same three choices a channel has: scope direct messages to a region,
  always send unscoped (ignore the global region), or use the global setting.
- It only has an effect when the DM is flood-routed. A send over a known path
  carries no region; the dialog says so.
- The override is applied to the radio right before the send and the saved
  global region is restored after it, also when the send fails, with three
  restore attempts. The background DM retries use it too. As for channels in
  this fork, an explicit override is always sent to the radio, also when it
  equals the saved global region, because the radio's live scope cannot be
  read back.
- Backend: `contacts.flood_scope_override` (migration `_135`),
  `POST /api/contacts/{public_key}/flood-scope-override`, shared
  `parse_override_input` / `resolve_override_scope` in `app/region_scope.py`
  and `temporary_flood_scope` in `app/services/flood_scope.py`. The channel
  send path is unchanged.
- Not tried on a radio: tests and a scratch backend only.

### Unread channel summaries through Ollama (statico `cabff2e4`, `e8da9b43`)
- Opening a channel that has unread messages can show a short summary above
  the messages, written by a model on an Ollama server you run. It can be
  dismissed. Off by default and inert until a model is named.
- Settings > Radio & App > Unread Channel Summaries: a switch, the Ollama
  server URL and the model name. The RTFM-EV server calls Ollama, so the URL
  must be reachable from the server. **When it is on, the unread text of the
  channel you open is sent to that server.** Nothing is sent otherwise.
- Up to 100 messages from the read boundary on. Blocked senders are left out,
  and so are messages flagged as malformed when "Hide malformed messages" is
  on. The URL is validated on save (http or https with a host). A failure to
  reach Ollama shows nothing in the UI and is logged without returning the URL
  or the upstream error to the browser.
- Backend: `app_settings.ollama_enabled`, `ollama_base_url`, `ollama_model`
  (migration `_136`), `POST /api/channels/{key}/summarize-unread?after=`,
  `app/services/ollama_summary.py`. No new dependency (uses `httpx`).
- Two defects in the statico version were found by running it and are fixed
  here: stored channel text already starts with `Sender: `, so the prompt said
  every name twice; and the banner shared its React key with the message list,
  which sent several summary requests per channel open and left a stale copy
  on screen. One open now produces one request.
- Checked against a stand-in Ollama server on a scratch backend, not against a
  real model.

## Update 2026-10-09 (community fork fixes, fix/community-fork-fixes)

Bug fixes taken from the `Bjorkan/MESHRIK` fork of upstream (22 commits ahead
of `33b3b8d`, reviewed at `5e1a0c89`), ported by hand onto this tree. Two
migrations (`_133`, `_134`), no new dependency. The open upstream pull requests
and issues were checked as well: the fixes they carry (companion repeat mode
#362/#363, repeater CLI autocapitalise #349/#350, 422 for mesh timeouts #345)
were already in this fork, so nothing from upstream needed porting.

### Messaging
- **Draft no longer follows you to another conversation** (MESHRIK `11e99e6a`).
  Text typed but not sent stayed in the composer after switching conversation,
  so it could be sent to the wrong channel or contact. The composer is now
  recreated per conversation.
- **Enter during IME composition no longer sends** (MESHRIK `8f173d15`).
  Confirming a candidate with Enter (Japanese, Chinese, Korean input) sent the
  half-composed message.
- **Channel resend after a radio rename** (MESHRIK `f2037aa3`). A resend
  stripped the sender prefix only when it matched the current radio name, so a
  message sent under an earlier name went on air as `New: Old: text`. The
  prefix is now taken from the stored `sender_name` first. A resend with a new
  timestamp stores the row under the current name. Applies to the manual
  resend and to the echo watchdog.
- **A send the radio never answered is kept, not deleted** (MESHRIK
  `85b71197`). When the radio gave no response to a send command the stored row
  was removed, although the packet may have gone out. Such a message now stays
  with `send_status = 'unknown'` and shows a warning mark; hearing it echoed
  (or an ACK) turns it into a normal delivered message. The API still answers
  422 with the same text, so the composer keeps the draft and the toast is
  unchanged. Migration `_134` adds `messages.send_status`
  (`pending`, `confirmed`, `unknown`; existing rows `confirmed`).
- **Messages deleted on the server leave the open conversation** (MESHRIK
  `ac58e0d9`). The background reconcile only added and updated, so a message
  deleted elsewhere stayed on screen until a reload. Only messages inside the
  fetched range are removed; older pages loaded by scrolling and messages that
  arrived during the fetch stay.
- **Reconcile compares every scalar field** (MESHRIK `257f3ed0`, in part). A
  change to sender, region, transport code, signature, text type or channel
  name was not picked up. Paths are still compared by count, not per path as
  in MESHRIK: the server only ever appends to a message's path list
  (`MessageRepository.add_path`, `json_insert(..., '$[#]', ...)`, the single
  runtime writer), so for one message an equal count means equal content and
  a per-path comparison can find nothing extra.
- **A message over the byte limit is not sent** (MESHRIK `68734cc4`, with a
  different threshold). The composer warned "likely truncated by radio" and
  sent anyway. What the firmware does (`BaseChatMesh.cpp`, `MAX_TEXT_LEN` 160):
  a channel message is cut to 160 bytes including the `Name: ` prefix and the
  radio answers OK, so the stored text differs from what went on air, its echo
  matches no stored row (echo matching is on exact text and timestamp) and
  shows up as a second, incoming message while the original never gets an
  echo count; a cut in the middle of a multi-byte character leaves invalid
  UTF-8. A DM above 160 bytes is refused with `ERR_CODE_TABLE_FULL`. Send is
  now disabled, and Enter does nothing, while the text is over the limit the
  counter shows (156 bytes for a DM, 156 minus name and separator for a
  channel); the hint reads "too long to send, shorten it". A message that
  exactly fills the limit is still sent (MESHRIK blocks that one too). The
  "likely truncated by radio" state is gone. Raw packets are not limited.

### Read state
- **Same-second arrivals stay unread** (MESHRIK `202e0f65`). `last_read_at`
  has one-second resolution, so a message arriving in the second a conversation
  was marked read never counted as unread. Migration `_133` adds
  `last_read_message_id` to `contacts` and `channels`; a message is unread when
  it is newer than `last_read_at`, or from that second with a higher id.
  Existing rows are seeded so nothing old turns unread.
- **A late unread answer no longer overwrites newer state** (MESHRIK
  `3d6ec6f0`, reworked). `/api/read-state/unreads` is a snapshot, and it can
  take seconds here (0.6 s to 16 s measured on the live instance). Two cases
  were wrong: an older answer arriving after a newer one replaced it, and an
  answer taken before a live message arrived dropped that message's count
  again. Now only the newest request may apply its result, and when live
  state changed during a request it is fetched again, at most three attempts,
  the last of which is applied regardless. MESHRIK discards such a snapshot
  without fetching again; with no retry a message arriving during the fetch
  would leave every badge from that snapshot missing until the next refresh.
- **Reads in the open conversation are saved** (MESHRIK `6f0b1d7b`). A message
  arriving in the conversation on screen was shown as read but the server only
  learned that at the next navigation or refresh, so another browser showed it
  unread. The client now reports the newest message shown (250 ms debounce,
  flushed on leaving) via `mark-read?message_id=`, which only moves forward.
  Skipped while the conversation is held unread by "mark unread from here".

### Contacts
- **Radio refusing a contact removal is reported** (MESHRIK `5f29c84a`). Delete
  and bulk delete ignored the radio's answer, so a contact the radio kept came
  back at the next sync without explanation. Both endpoints now return what the
  radio did and the UI shows a warning. One failing removal no longer skips the
  rest of a bulk delete. When a removal raises, the bulk response says
  `Radio removal failed` and the exception text goes to the log only (CodeQL
  `py/stack-trace-exposure` on the pull request).
- **Bulk delete with a key listed twice** counted and processed that contact
  twice (MESHRIK `5f24e2dc`).

### Interface
- **Search "Searching..." indicator** disappeared when an older, aborted
  request finished while a newer one was still running (MESHRIK `3f8bae66`).
- **Notification click** now waits for the tab to be focused and navigated
  before the service worker may be stopped (MESHRIK `2753d6fb`).

### Not taken from MESHRIK
- `5e1a0c89`, `1a7883da`, `f85304a3`, `50d20b94`, `44778327`: lint tidy-up,
  lazy loading (already present), PWA manifest and rebranding.

## Update 2026-10-09 (MCEU themes: page heads and cards, feat/mceu-layout)

No migration, no backend change, no new dependency, no new strings. CSS only.
Fourth of four layout parts for the MCEU themes.

### Interface: page heads and cards under the MCEU themes
- **Page head:** the title of every page (tools, settings, map, search and
  the chat header) is set in the display font at heading size (22px, 19px on
  phones), and the rule under the head is gone.
- **Cards:** a bordered, rounded panel that sits directly on the page
  ground is a raised surface, in both themes. That covers the stat tiles
  (Mesh Health's counters, for example) and the plain bordered panels.
  Panels with their own tint, selected state or hover fill keep it, and so
  do the wells inside a card.

### Not included
- The analyzer's one-line lead under each title and its reordered page
  actions. A lead needs new copy for about 15 pages in three languages, and
  no page here has a shared head component to put it in.
- Pages that build their tiles differently (Mesh Trends uses filled wells)
  look as before.
- On phones a two-word title can wrap next to a page's tabs (seen on Mesh
  Health), where the smaller title used to fit on one line.

## Update 2026-10-09 (MCEU themes: chat messages as cards, feat/mceu-layout)

No migration, no backend change, no new dependency, no new strings. Third of
four layout parts for the MCEU themes.

### Interface: chat messages as cards under the MCEU themes
- With **MCEU Light** or **MCEU Dark**, a chat message is a card instead of
  a bubble, after the analyzer's channel page: avatar, sender name in the
  accent colour and the time on top, the text below, then a row of chips.
- The chips are what the bubble showed inline: the hop count (a route icon
  and the number, still a click to the path view), **Direct**, the region or
  **Unscoped** / **Scoped**, and on your own messages the delivery mark.
- Every card has its own header; messages from the same sender are not
  grouped. Your own cards stay on the left and differ by their tint.
- React, reply, mark unread and delete sit at the right of the header.
- Cards are capped at a reading width on wide windows and fill the width on
  phones. Other themes keep the bubbles, and the chat window keeps its own
  choice of lines or bubbles.

### Not included
- The analyzer's observer count, SNR chip and "Open packet" chip: this app
  shows those through the path view and the packet analyzer, not per message.

## Update 2026-10-09 (MCEU themes: phone tab bar, feat/mceu-layout)

No migration, no backend change, no new dependency. Second of four layout
parts for the MCEU themes.

### Interface: bottom tab bar on phones under the MCEU themes
- On a phone-width window (768px and narrower) with **MCEU Light** or **MCEU
  Dark**, a bottom tab bar replaces the menu button: **Chats**, **Map**,
  **My Node** and **More**. The tab of the page on screen is lit.
- **Chats** opens the drawer with the conversation sections (favorites,
  channels, contacts and the rest, in your order). **More** opens it with the
  tools, followed by Settings, Chat window, language and theme. **Map** and
  **My Node** go straight to their page.
- The top bar on phones keeps the app name and the radio state (status dot,
  battery, Reconnect). Settings, chat window, language and theme moved behind
  More, so the bar no longer runs out of room.
- Swiping in from the left edge still opens the drawer, on the Chats half.
- Other themes and desktop are unchanged.

### Fixed
- Opening a conversation or page while Settings was open could land on the
  conversation that was open before Settings instead: closing Settings steps
  back in browser history and the router re-selected that entry afterwards.
  Seen with the new tab bar; the desktop buddy's click-to-open goes through
  the same code. The selection now waits for that history step.

### Not included
- "Add Channel/Contact" and the sidebar search still show at the top of the
  More half of the drawer.
- A buddy mention opened from the Settings page (jump to a message) uses a
  separate path that was not changed or checked.

## Update 2026-10-09 (MCEU themes: desktop shell, feat/mceu-layout)

No migration, no backend change, no new dependency. First of four layout
parts for the MCEU themes; the phone tab bar, chat cards and page headers are
not in this change.

### Interface: the analyzer's shell under the MCEU themes (desktop)
- With **MCEU Light** or **MCEU Dark** active on a desktop-width window, the
  app takes the shell of the EU MeshCore Analyzer design. Every other theme
  is unchanged. Phones (768px and narrower) got their own part, see above.
- **Sidebar head:** the app name and logo, and a **Search anything** button
  that opens the command palette (also Ctrl+K / Cmd+K).
- **Sidebar foot:** Settings (it reads **Back to Chat** while settings are
  open), Chat window, the language switcher (its menu opens upwards) and the
  theme dialog. The update dot sits on the Settings row.
- **Top bar:** a slim bar above the page with only radio state: the packet
  sparkline, a status pill, battery, node name and key, and Reconnect.
- The sidebar keeps its content, your custom order and hidden items. Collapsed
  to the rail, head and foot shrink to icons; the language switcher is left
  out there (it is in Settings and in the expanded sidebar).
- The theme dialog now stays open when a pick changes the layout, in both
  directions.

### Internals
- A theme asks for a layout with `layout` on its entry in `utils/theme.ts`;
  `useThemeLayout()` reads it. `AppShell` is the only place that branches on
  it. `<main>` is not moved between layouts, so the open page is not
  remounted on a theme switch.
- `StatusBar` gets `variant="topbar"`; the brand and the theme dialog moved
  to `components/shell/` so both layouts share them. New string
  `nav_search_anything` in English, Dutch and German.
## Update 2026-10-09 (Frontend test flakes: waits under load, fix/frontend-wait-flakes)

### Tests: `toggles settings page mode and syncs selected section into SettingsModal` (frontend)
- `src/test/appFavorites.test.tsx` could fail in a full `npm run test:run`
  with `Unable to find an element by: [data-testid="settings-modal-section"]`
  (2 of 6 full runs on a 16-core Windows machine) while passing every time on
  its own. `SettingsModal` is `React.lazy` in `AppShell`: the click commits
  the settings view with its Suspense fallback, and the modal arrives in a
  later render outside `act()`. The test gave that render `waitFor`'s default
  1 s. Measured with timed copies of the test inside the full suite, the wait
  took 166 ms to 5.1 s and passed 1 s in 6 of 18 samples (208 ms on its own).
  The import of the mocked module itself took 0 ms, so that is not the slow
  part. A copy of the test with the module made 1.5 s slow to load fails with
  the same error.
- The test now waits for the modal by its test id with a 10 s allowance and
  checks the "Back to Chat" button once afterwards, not on every poll. With
  that, the same measurement gave 27 ms to 1.2 s over 18 samples (one still
  past 1 s, which is why the allowance stays), the slow-module copy passes,
  and the test passed in three full runs. Code unchanged: lazy loading the
  settings page is intended.

### Tests: waits get 5 s by default (frontend)
- `src/test/setup.ts` now sets Testing Library's `asyncUtilTimeout` to 5 s for
  every test file (`waitFor`, `findBy*`); it was the library default of 1 s.
  Two files already set this value for themselves (`appStartupHash.test.tsx`,
  `appChatPopout.test.tsx`), for the same reason. `testSetup.test.ts` guards
  the setting.
- Why suite-wide: the settings test above was not the only one. The emoji
  picker test `every button in the picker is a non-submit button` in
  `messageInput.test.tsx` failed the same way once (at 1.2 s). With every
  wait timed over three full runs, waits that needed an asynchronous render
  took 500 ms or more 13 times, in 10 tests across 7 files, and passed 1 s
  twice (1027 ms in `messageInput`, 1095 ms in `appFavorites`). The emoji
  picker waits take 300 to 730 ms even with only two other files running.
- What it costs: a wait that really fails now takes 5 s to report, not 1 s.
  No passing test gets slower: over five full runs with a 15 s allowance not
  one wait failed, so no test relies on a wait timing out.
- Not chosen: fewer test workers. With 8 workers (16 is the default on this
  16-thread machine) two full runs took 191 s and 215 s, against 112 to 174 s
  for most runs that day, and a single test still ran 10.6 s. It also does not
  help when the load comes from outside the test run.
- Verified: a wait that needs 1.5 s fails before the change and passes after
  it, and three full runs passed, 2849 of 2849 each, with the machine at 83
  to 97% CPU from other work before each run.
- Not fixed: whole tests reaching the 20 s `testTimeout`. Seen in two of the
  day's full runs (two tests in `mapView.test.tsx`, one in
  `hostRepeaterSettings.test.tsx`), both in runs that took over 215 s because
  the machine was busy with other work. With other processes holding the
  CPU at 88 to 100% (sampled around that run), one `hostRepeaterSettings`
  test reached 20 s with the file run on its own. That is a different limit
  from the one changed here.

## Update 2026-10-09 (MCEU themes, feat/mceu-theme)

No migration, no backend change, no new dependency. Five font files added
(160 KB, SIL Open Font License).

### Interface: MCEU Light and MCEU Dark themes
- Two new entries in the theme picker, **MCEU Light** and **MCEU Dark**
  (`mceu-light`, `mceu-dark`), after the look of the EU MeshCore Analyzer's
  new design ("Atlas"). The colours are that design's own tokens
  (`web/next/css/atlas.css` in EU-Meshcore-Analyzer): warm paper ground with
  white cards and a blue accent in the light theme, near-black ground with
  a lighter blue in the dark one.
- Text colours use the base token where it reaches 4.5:1 on the ground and
  the token's darker or lighter "ink" variant where it does not (warning and
  success in the light theme; warning, success and destructive in the dark
  one). Five values have no Atlas token and are derived: the scrollbar thumb
  (light), its hover (dark), the dark error toast border, the dark overlay
  and the dark float shadow.
- Shapes, shared by both themes: the sidebar and top bar sit on the ground
  and only cards are raised; sidebar rows are inset pills and the open one is
  a card with a hairline ring; cards and dialogs get a 20px radius, controls
  12px and 10px; menus and popovers get the Atlas float shadow; fields and
  outline buttons are surfaces; message bubbles get a 16px radius, incoming
  as a bordered surface and outgoing in the soft accent.
- Fonts: Bricolage Grotesque on headings, Figtree for text and JetBrains Mono
  for monospace, the same Latin and Latin Extended subsets the analyzer
  serves, in `frontend/public/fonts`. The browser fetches them only while an
  MCEU theme is active.
- Outgoing bubbles use the soft accent with normal text, not the solid accent
  with white text of the Atlas chat mockup: links and muted text inside a
  bubble take their colour from the theme and would not be readable on the
  solid accent.

### Not included
- The Atlas page layout (six-area sidebar, page headers, phone tab bar). The
  themes restyle the existing screens; no component changed.
- An entry that follows the OS light/dark setting. The existing "OS
  Light/Dark Mode" entry still switches between Light and Original.
- Atlas's orange "live" colour is not used: no state in this app maps to it.

## Update 2026-10-09 (desktop buddy: unacknowledged DMs, integrations and SNMP, feat/buddy-expression-quiet)

No migration, no backend change, no new dependency.

### Interface: desktop buddy (three more things to tell)
- **A direct message of yours got no acknowledgement.** Said when the radio
  gave up on a DM (WS `message_failed`) in a chat that is not on screen; the
  chat on screen already shows the failed mark. Click to open the chat. A
  message this browser has not loaded (sent from another device) is not
  announced. It falls under the "Direct messages and mentions" switch.
- **An integration has lost its connection.** Any enabled integration under
  MQTT & Automation that has been disconnected or in error for a minute
  without a break (`health.fanout_statuses`). Said once, and again only after
  it was connected in between. Click to open MQTT & Automation.
- **An SNMP node stopped answering.** Nodes with polling switched on whose
  last poll failed. The buddy reads the stored results every 5 minutes
  (`GET /api/snmp/nodes`); it never polls a node or starts a discovery itself.
  Click to open the node's SNMP page, or the overview when there are several.
- New switch **Integrations and SNMP** under "Tell me about" (seven in
  total). While it is off the buddy does not ask for the SNMP nodes at all.
- The warned state is stored per browser (`rtfm-buddy-services-warned`), so a
  reload does not repeat a warning, and it is forgotten when the integration
  or node is removed.

### Not included
- Favourite nodes going silent, radio queue or noise floor warnings, backup
  failures, host repeater events, power outages and prefix collisions are not
  announced: they need thresholds or data that have not been decided or
  checked yet.

## Update 2026-10-09 (desktop buddy: click menu, feat/buddy-expression-quiet)

No migration, no backend change, no new dependency.

### Interface: desktop buddy (click menu)
- A single click on the buddy opens a small menu next to it. The double-click
  trick, dragging and the right-click goodbye are unchanged: the menu waits
  for the double-click window (250 ms), and a press that ended somewhere else
  was a drag.
- **What did I miss?** lists the last 20 lines the buddy said or kept back
  while it was quiet, newest first, with the time. A line that has something
  to open (a contact, a mention, a settings page) opens it on click. The list
  lives in memory and is empty after a reload.
- **Help for this page** opens the User Guide at the section for the page on
  screen (Messaging, Contacts and nodes, Map, Tools or Settings). The guide
  stays one page (`#manual`); the section travels through the new
  `utils/manualNavigation.ts`, so the URL hash does not change. Pages without
  a section do not show the item.
- **Mute** for 15 minutes, 1 hour or until reload, or **End mute** while one
  is running. **Choose another buddy** opens Settings > Local Configuration.
  **Hide until reload** does what a right-click does.
- The summary line after a quiet period now ends with "Click to see them."
  and opens the list.
- The menu closes on Escape, a click elsewhere, a click on the buddy, and
  when the buddy starts to speak. Nothing in it transmits: every item
  navigates or changes a browser-local setting.

## Update 2026-10-09 (desktop buddy: expression, switches and quiet periods, feat/buddy-expression-quiet)

No migration, no backend change, no new dependency.

### Interface: desktop buddy (expression)
- The buddy plays a fitting animation before each line: attention for a DM or
  mention, a cheer for a new node or a reconnected radio, an alert for a lost
  radio or a low battery, an announcement for an update, an explanation for a
  page tip. Characters differ in what they have, so each mood is a chain and
  the first animation the character knows is played (`buddy/buddyMood.ts`). A
  character with none of them (Gourdy) just speaks, as before.
- When the thing a line is about is on screen, the buddy gestures toward it
  while it talks: the sender's or channel's row in the sidebar, the radio
  status, the battery indicator, the Settings button (for an update). These
  elements carry a `data-buddy-anchor` attribute (`buddy/buddyAnchors.ts`); the
  lookup happens when the line is said, and an element that is absent or off
  screen means no gesture. `clippyjs` reduces a point to one of four
  directions, so this is a direction, not a precise pointer.
- An animation before a line is told to wrap up after 3 seconds (a gesture
  after 2) and gets 1.5 seconds for its exit frames. A running idle animation
  gets up to 4 seconds to hand over first, so the mood animation is not cut to
  a few frames when two lines follow each other.

### Interface: desktop buddy (switches, mute, quiet hours)
- Settings > Local Configuration, below the buddy picker: **Tell me about**
  (six switches: direct messages and mentions, new nodes, radio connection,
  low batteries, updates, page tips), **Mute** (15 minutes, 1 hour, until
  reload, end now) and **Quiet hours** (daily from and to in the browser's
  local time; the range may wrap midnight). The header theme dialog keeps only
  the picker and the battery threshold.
- While the buddy is quiet nothing gets through. When the quiet period ends it
  says one line with what it kept back, counted per topic ("While I was quiet:
  2 messages, 3 new nodes."). Page tips are not kept; they are given on a later
  visit instead. The app's own toasts are unaffected.
- A low battery warning is no longer repeated after a reload: the warned state
  is stored per browser (`rtfm-buddy-battery-warned`) with the same re-arm rule
  (threshold + 5 points). Nodes without telemetry in the last 24 hours are
  forgotten, so they warn afresh when they report again.
- New per-browser keys: `rtfm-buddy-groups-off`, `rtfm-buddy-mute-until`,
  `rtfm-buddy-quiet-hours`, `rtfm-buddy-battery-warned`.

### Interface: desktop buddy (internals)
- New `buddy/buddyCatalog.ts`: one table of line kinds (group and mood) and one
  builder per kind. Battery, update and tip lines used to be built inline in
  `BuddyHost.tsx`; all lines now go through the same `say(line)`. Adding a kind
  is a table row, a builder and a trigger.
- New `buddy/buddyQuiet.ts` (quiet rules and the held-back counter) and
  `buddy/buddyHistory.ts` (the last 20 lines, in memory; nothing reads it yet).
- The buddy relies on more `clippyjs` 0.1.0 private members
  (`_playInternal`, `_getDirection`, `_animator.exitAnimation`,
  `_animator.currentAnimationName`). Each call is guarded: a missing member
  costs the animation, not the line. `frontend/AGENTS.md` now lists all of
  them under "Desktop buddy".

## Update 2026-10-09 (26 more desktop buddies, feat/buddy-acs-characters)

No migration.

### Interface: desktop buddy (26 more characters)
- The **Desktop buddy** picker lists 26 more characters after the 10
  `clippyjs` agents: the Office assistant Mother Nature, the Windows XP
  search assistants Courtney and Earl, the
  Microsoft Agent characters Birdie, Cami, Charlie, E-Man, E-Woman, Electra,
  Gar, Hanz, Milton, Oscar, Plany, Santa, VRGirl, Wabbit and WartNose, and
  from the older Agent 1.5 format Al, Checkmate, Gourdy, Max, Ozzar, Sharky,
  Spaceman and Totem.
- They were converted from Microsoft Agent `.acs` files with the new
  converter below and live in `frontend/src/buddy/custom/<id>/` (`agent.json`
  + `map.png`, 17 MB in total). Each is its own lazy chunk and its sprite
  sheet a separate asset file, so a browser downloads only the buddy it
  picked. The characters and sprite sheets are Microsoft's and third parties'
  artwork, not ours.
- `frontend/.prettierignore` (new) skips the generated `agent.json` files.

### Interface: desktop buddy (tooling)
- New `scripts/buddy/acs_to_clippy.py` (standard library only): converts a
  Microsoft Agent 2.0 character file (`.acs`) into the `agent.json` and
  `map.png` that `clippyjs` reads, so more buddies can be added next to the 10
  the library ships. `--info` lists what a file contains, `--preview` writes a
  self-contained page to play every animation. It also adds what `clippyjs`
  needs and Agent files leave to their states: exact `Show`, `Hide` and
  `Idle...` names, and return animations appended to the animations that name
  one. Mouth overlays are dropped.
- The converter also reads the older Agent 1.5 files (OLE compound files with
  a `char.acf` stream and one `.aaf` stream per animation; versions 1.30 and
  1.31). That layout is not documented anywhere we found; it was worked out
  from nine real files and is written down next to the reader. A stream is
  only accepted when it is read to its last byte, and a damaged animation
  stream costs that one animation (Ozzar ships with 104 of its 106).
- New `scripts/buddy/compare_with_clippyjs.mjs`: compares a conversion with the
  same character as shipped by `clippyjs`. On real files, Clippit, F1, Links
  and Rover come out identical (0 field and 0 pixel differences); Genius and
  Rocky differ in 1 and 97 frames, exactly where the file gives an image an
  offset that the `clippyjs` data dropped. See `scripts/buddy/README.md` for
  the format mapping and what is and is not verified. Tests:
  `tests/test_acs_to_clippy.py` (synthetic files, no third-party artwork).
- New `frontend/src/buddy/customAgents.ts`: registry for converted buddies.
  An entry adds the buddy to the picker after the `clippyjs` ones and loads it
  as its own lazy chunk. `BUDDY_AGENT_IDS` and `BUDDY_AGENT_NAMES` in
  `buddy/agents.ts` now merge both sources.
## Update 2026-10-08 (SNMP node page with graphs, feat/snmp-node-page)

### Tools: SNMP node page (frontend)
- A row on the SNMP page now opens a full page for that node
  (`#snmp/<public key>`), in the style of My Node. It replaces the in-place
  expand: the arrow in front of a row, or a click anywhere on the row, opens
  the page. The node name still opens the contact page and **Poll now** still
  polls.
- Header: back to all SNMP nodes, name, type, status, address, last good
  poll, schedule, the last error when the node is failing, **Open contact
  page** and **Poll now**.
- Time range selector as on My Node (20 m up to 30 d and **Custom** with a
  start and an end), remembered per browser.
- Tiles with the newest values (uptime, firmware version, free heap, WiFi
  RSSI, noise floor, connected MQTT slots) and the number of reboots in the
  period (counted from drops in the uptime).
- Graphs of the stored polls, grouped as the values are, each with wheel
  zoom, drag pan and hover values: uptime, packets received and sent,
  received and sent by route (flood, direct), receive errors, air time,
  noise floor, last RSSI, last SNR, connected MQTT slots, packet queue depth,
  skipped publishes, memory (free heap, largest free block, free internal
  RAM), free PSRAM (only when the node reports any) and WiFi RSSI.
- **Counters: Rates / Totals.** Packets, errors, air time and skipped
  publishes are counters that only go up since the node started. **Rates**
  (default) shows the increase between two polls, per minute, and air time
  as a percentage of the time. An interval with a reboot is left out, so a
  restart does not draw a negative spike. **Totals** shows the counter
  itself. The choice is remembered per browser.
- All 22 values of the newest poll, grouped, at the bottom.
- **Auto refresh** and **Refresh** work as on the overview and share its
  setting. They re-read stored data and never poll the node.
- Nothing on this page transmits over RF.

### Tool pages no longer load chat messages (frontend)
- Opening a page that is not a chat sent a needless
  `GET /api/messages?type=PRIV&conversation_key=<page>` in the background:
  My Node, Mesh Health, Mesh Trends, Mesh Discovery, SNMP, Analyze Packet,
  Packet History, Knowledge base, Channel Registry and the link detail page.
  The message loader listed the pages that are not a chat, and new pages
  were not added to it. It now lists what is a chat instead: a contact, a
  channel, and the contact page (so the messages are ready when you open the
  chat from there).
- A page can share its id with a chat: the SNMP page of a node and that
  contact. Going between the two now counts as a switch, so the chat loads
  its messages after a visit to the node's SNMP page and nothing of the chat
  lingers on the SNMP page.

### SNMP history period (backend)
- `GET /api/contacts/{public_key}/snmp/history` takes optional `start` and
  `end` (Unix seconds). With `start` it returns the polls from `start` up to
  `end` (now when `end` is left out) and ignores `hours`. `end` without
  `start`, or an `end` that is not after `start`, is a 400. Without `start`
  nothing changes: the last `hours`, default 24. Read-only, no migration.
- Checked in a browser against net-snmp 5.9.4 agents on loopback with eight
  hours of generated history that includes two reboots.

## Update 2026-10-08 (SNMP page under Tools, feat/snmp-tools-page)

Builds on the SNMP polling of `feat/snmp-observer-support` (#277). No
migration.

### Tools: SNMP page (frontend)
- New **SNMP** entry in the sidebar Tools section (`#snmp`). It lists every
  node that has SNMP set up on its contact page, one row per node: status,
  name, address, schedule, last good poll, last error, and the main values
  side by side (firmware version, uptime, free heap, largest free block,
  connected MQTT slots, packet queue depth, WiFi RSSI, noise floor, receive
  errors, last RSSI and last SNR).
- A node whose last poll failed is marked **Failing**, gets a red row and
  shows the error. Failing nodes are listed first by default. Their values
  are those of the last good poll, shown dimmed.
- Every column header sorts the table; a second click reverses the order.
  Nodes without a value for that column stay at the bottom.
- The arrow in front of a row opens the full data of that node in place: all
  22 values grouped (system, radio, MQTT, memory, network) and the history
  chart with its value and range pickers. Several nodes can be open at once.
  Opening a row polls nothing; it shows the newest stored poll.
- **Poll now** per node and **Poll all now**, which polls the nodes one after
  the other in the order shown. Both use the existing per contact poll over
  UDP on the LAN. Nothing on this page transmits over RF; "Ask node for its
  address" stays on the contact page.
- **Auto refresh** (off, 10 s, 30 s or 60 s; default 30 s, remembered per
  browser) re-reads the stored data so scheduled polls show up. It does not
  poll the nodes: how often a node is polled is still its own schedule in
  minutes. **Refresh** reloads right away.
- The node name opens that contact's page. With no node set up, the page
  explains how to set SNMP up there.
- The per contact **SNMP (LAN)** card behaves as before. Its value list and
  time format moved into shared helpers (`SnmpValueGroups`,
  `formatSnmpTime`) that the page uses too.

### SNMP overview (backend)
- New read-only endpoint `GET /api/snmp/nodes`: every contact with SNMP
  settings, with its name, type, host, port, schedule, last good poll, last
  error and the newest stored poll (`latest`, null when none is stored). It
  reads the database only: no poll, no radio access.
- The community is not in the response, only `community_is_default`, as on
  the per contact config endpoint. The query behind it
  (`ContactSnmpRepository.list_overview`) does not select the community.
- Checked in a browser against two net-snmp 5.9.4 agents on loopback, one
  node with a wrong community. Not tested against a real observer node.

## Update 2026-10-08 (SNMP for observer firmware 3/3: RTFM-EV as SNMP agent, feat/snmp-observer-support)

### Settings: SNMP agent (frontend)
- **Settings > Radio-App Management > SNMP agent** (off by default). When on,
  a monitoring system such as LibreNMS or Zabbix can poll this node over
  SNMP. Settings: on/off, UDP port (default 161) and community (default
  `public`). The card shows whether the listener is running, how many
  requests it answered and how many it refused for a wrong community, or why
  it could not start.

### SNMP agent (backend)
- RTFM-EV answers SNMPv2c GET, GETNEXT and GETBULK with the same 22 OIDs as
  the observer firmware (`1.3.6.1.4.1.99999`, see `app/snmp/mib.py`), so one
  monitoring template fits a firmware node and this host. Read-only: a SET is
  refused with `notWritable`. A wrong community, SNMPv1 or a malformed
  request gets no answer.
- Where the values come from:
  - system and radio: the connected radio's name, firmware version and the
    60 second stats sample (uptime, packet counters, noise floor, RSSI, SNR,
    air time). Before the first sample, or with no radio, they are 0 or
    empty.
  - mqtt: connected slots is the number of connected MQTT integrations.
    Queue depth and skipped publishes are always 0 (this app has neither).
  - memory: the host's available memory from `/proc/meminfo`, not a heap.
    The OIDs are 32-bit integers, so values stop at 2147483647 (2 GiB). On a
    host without `/proc/meminfo` they are 0. PSRAM is always 0.
  - network: WiFi RSSI is always `-127`, the firmware's own value for "no
    RSSI".
- New endpoints `GET` / `PUT /api/snmp-agent`. New table `snmp_agent`
  (migration `_132`, one row). The listener binds `0.0.0.0` on the chosen
  port. It never uses the radio.
- Docker: publish the UDP port as well, for example `- "161:161/udp"` under
  `ports:` (the line is in `docker-compose.example.yml`, commented out).
  Outside Docker, a port below 1024 needs root; the card shows the bind
  error if the port cannot be opened.
- Security: SNMPv2c has no encryption and the community is the only check.
  Anyone who can reach the port and knows the community can read these
  values. Leave it off unless you use it, and set your own community.
- Checked against net-snmp 5.9.4 (`snmpget`, `snmpwalk`, `snmpbulkwalk`,
  `snmpset`). Not tested with LibreNMS or Zabbix.

## Update 2026-10-08 (SNMP for observer firmware 2/3: polling of observer nodes, feat/snmp-observer-support)

### Contacts: SNMP (LAN) card (frontend)
- Repeater and room server contact pages have a new **SNMP (LAN)** card in
  "Your data & telemetry". It polls the SNMP agent of the DMC observer and
  agessaman observer firmware over your network. It works without a repeater
  login, because nothing goes over RF.
- Set up: host or IP address, port (default 161) and community. **Poll now**
  reads all 22 values the firmware serves and shows them grouped (system,
  radio, MQTT, memory, network) with units. A failed poll shows the reason
  and keeps the time of the last good poll.
- **Ask node for its address** fills in the IP the node reports. It sends one
  CLI command (`get wifi.status`) over RF, so it asks for a second click
  first, and it needs an admin login on the node. Nothing is saved until you
  save the form.
- The community is write-only in the UI: it is never sent back to the
  browser. Leaving the field empty on an edit keeps the stored one.
- **Poll on a schedule** (off by default) with an interval per contact
  (1 to 1440 minutes, default 5). The server polls in the background; the
  card shows "Scheduled every N min" and the last good poll or failure.
- **History**: every good poll, scheduled or manual, is stored. The card has
  a chart with a value picker (any of the numeric values) and a range picker
  (24 hours, 7 days, 30 days), with the usual zoom and pan.

### Home Assistant: SNMP sensors (backend)
- A repeater that the HA MQTT integration tracks and that has SNMP set up
  gets 22 extra sensors on its existing HA device (`SNMP Free Heap`, `SNMP
  WiFi RSSI`, `SNMP MQTT Connected Slots` and so on). They use their own
  state topic, `<prefix>/<node_id>/snmp`, so the telemetry sensors are not
  touched.
- Every good poll, scheduled or manual, is published. Values the node did not
  serve are left out of the payload. The newest stored poll is replayed when
  discovery is published, so the sensors fill in right away.
- With scheduled polling on, the sensors go unavailable after three missed
  polls (at least 10 minutes). A node that is only polled by hand has no
  expiry. Removing the SNMP settings removes the sensors from HA.
- The address and the community are never published.
- New fanout hook `on_snmp` (`broadcast_snmp`), dispatched to all modules;
  only the HA MQTT module uses it.
- Room servers cannot be picked as tracked repeaters, so their SNMP values
  are not published to HA.

### SNMP (backend)
- New package `app/snmp/`: a small SNMPv2c implementation written for this
  (BER codec, message framing, the MeshCore OID table, an async UDP GET
  client). Read-only, no SNMPv1 or v3, no new dependency. Checked against
  net-snmp 5.9.4 (`snmpd`, `snmpget`, `snmpwalk`).
- New endpoints under `/api/contacts/{key}/snmp/`: `config` (GET, PUT,
  DELETE), `poll` (POST) and `discover-address` (POST, the only one that
  uses the radio).
- New table `contact_snmp` (migration `_130`): host, port, community and the
  outcome of the last polls. It is separate from `contacts` so the community
  never rides along in contact payloads, WebSocket events or fanout. It is
  stored in plain text and is part of database backups.
- New table `snmp_history` and column `contact_snmp.poll_interval_minutes`
  (migration `_131`). `GET /api/contacts/{key}/snmp/history?hours=` returns
  the stored polls, thinned to at most 1500 rows for long ranges.
- Scheduler (`app/services/snmp_poll.py`): checks every 30 seconds, polls a
  contact when its interval has passed since its last attempt (good or
  failed), at most 4 polls at a time. A failed poll stores no history row.
- Stored polls are pruned by age with the existing **telemetry** retention
  setting (default 30 days) and are counted in its row in Settings >
  Database. The per-node row cap of that setting does not apply to them.
- Size, for planning: one stored poll is about 0.4 kB, so a node polled every
  5 minutes adds roughly 115 kB per day.
- The server needs to reach the node on UDP (default port 161). SNMP is off
  by default on the firmware; turn it on with the settings editor's
  Observer firmware group or `set snmp on`, then reboot the node.
- Not verified against a real node yet: tested against net-snmp serving the
  same OIDs.

## Update 2026-10-08 (SNMP for observer firmware 1/3: on/off in the repeater settings editor, feat/snmp-observer-support)

### Repeater dashboard: Observer firmware group (frontend)
- The Settings Editor has a new **Observer firmware** group with one row,
  **SNMP agent** (on/off). It maps to the `snmp` CLI key of the DMC observer
  and agessaman observer firmware.
- The group has its own **Read** button and is not part of "Read current
  values", so a repeater on stock firmware is never asked for a key it does
  not know. The row's Edit button stays locked until the repeater has reported
  `on` or `off`. A repeater that does not know the key shows `-` and stays
  locked.
- The change is saved by the firmware and applies after a reboot. The result
  dialog says so; the editor does not reboot the repeater.
- Limits: the SNMP agent only runs on firmware builds compiled with SNMP. An
  observer build without it still accepts and stores the flag, and the CLI
  cannot tell the two apart. The community string is not shown or changed
  here (firmware default `public`).

### Repeaters (backend)
- `snmp` (`on` / `off`, reboot required) is on the settings allow-list
  (`app/services/repeater_settings.py`), flagged as an observer-only key.
  Only the exact words `on` and `off` are accepted, because the firmware
  treats any value starting with `on` as on.
- `POST /api/contacts/{key}/repeater/settings/read` without a key list now
  reads every non-observer key (`default_read_keys()`); observer keys are read
  only when named. The 21 existing keys are read as before. No migration.
- `snmp.community` is deliberately not on the allow-list.

## Update 2026-10-08 (Manual MeshCore TEAM beacon from the chat, feat/team-beacon-chat-button)

### Chat: Share location (frontend)
- On a private channel the Share location menu (map pin in the chat header)
  has a **TEAM beacon (#TEL:)** group with two entries: **Beacon: my radio
  location** (only when the radio has a position) and **Beacon: my current
  GPS** (browser geolocation). The map picker's Format select has a third
  option, **MeshCore TEAM beacon (#TEL:)**; with it chosen the label field is
  hidden, because `#TEL:` carries a position only.
- Each entry only writes the `#TEL:` text into the composer. Nothing is
  transmitted until you press Send, the same as the marker and TEAM waypoint
  entries. The periodic beacon (Settings, off by default) is unchanged.
- Not offered on the Public channel, hashtag channels or direct messages, the
  same rule as the TEAM waypoint and the periodic beacon.
- The text is built by `buildTeamTelemetryPayload` in
  `frontend/src/utils/teamPayloads.ts`, a mirror of the backend
  `encode_telemetry`: 11 bytes, unpadded Base64, phone battery unknown,
  forwarding status 1. The radio battery byte comes from the latest radio
  stats (`health.radio_stats.battery_mv`) when there is a reading, otherwise
  it is sent as unknown.
- Limits: TEAM only reads a `#TEL:` that is the whole message, so text typed
  before or after it in the composer makes it an ordinary message. The picker
  and GPS entries send whatever position you choose, not necessarily the
  radio's. Not tested against a real MeshCore TEAM client.
- No backend change, no migration.
- Tests: `frontend/src/test/teamPayloads.test.ts` (same strings as the Python
  encoder), `chatHeaderLocation.test.tsx`, `locationPickerModal.test.tsx`,
  `useConversationActions.test.ts`.
- Docs: `README.md`, `frontend/AGENTS.md`, `docs/sources-of-truth.md`,
  `docs/parity-audit.md`.

## Update 2026-10-08 (Handy Info: meshcore-info.eu link, feat/handy-info-meshcore-info-eu)

### Settings > Handy Info: Links (frontend)
- Added `https://meshcore-info.eu/` as a built-in link under **Community
  sites**, listed after MeshCore.io (id `link-meshcore-info-eu`, label
  `meshcore-info.eu`). It shows up for existing users as well, including
  those who have customized the list, and can be hidden, edited or flagged
  for the Knowledge base like any other built-in. No backend change, no
  migration.

## Update 2026-10-07 (OpenHop policy operators match the OpenHop editor, fix/openhop-policy-operators)

### OpenHop: Policy rules (frontend)
- Reported by Richard (2026-10-06): OpenHop's rule editor offers **Greater or
  Equal** and **Less or Equal** on `payload_length`, `hop_count`, `rssi` and
  `snr`. RTFM-EV already offered both there (since the 2026-10-01 update),
  but also on every other numeric field.
- The operator list per field now matches OpenHop's own editor
  (`openhop-dev/openhop_repeater`, branch `dev`, 2026-10-06):
  `route_type`, `payload_type`, `path_hash_size`, `transport_code_0` and
  `transport_code_1` offer `equals`, `not_equals`, `greater_than` and
  `less_than` only. The four fields above keep all six.
- `channel_hash` offers `equals`, `not_equals` and `in` (`contains` and
  `intersects` removed). `channel_message_body`, `channel_sender` and
  `payload_hex` offer `contains`, `starts_with`, `ends_with`, `equals` and
  `not_equals` (`in` removed), in that order: switching a condition to one
  of these fields now falls back to `contains` instead of `equals`, as in
  OpenHop's editor.
- An existing rule that uses a removed operator on one of those fields is
  not changed: the operator stays selected and selectable in the editor,
  and both engines still evaluate it. It is only no longer offered for new
  conditions on those fields.
- The Settings > Host repeater policy editor shares the builder, so the
  same fields follow the same lists there; its `matches` operator on the
  text fields is kept. No backend change, no migration.
- Tests: `frontend/src/test/openHopConditionBuilder.test.tsx`.
- Docs: `frontend/AGENTS.md`.

## Update 2026-10-05 (Remove a radio, feat/radio-removal)

### Settings > Radio > Radios: remove a radio (backend + frontend)
- Requested by Richard (2026-10-04): a radio in the Radios list could not be
  removed, so a radio that connected once for a test stayed listed forever.
- Every radio except the current one now has a **Remove radio** button. It
  opens a confirmation with one checkbox, off by default: "Also delete this
  radio's battery, noise floor and airtime history". Unticked, the samples are
  kept without a radio (they show as "Before radio tracking" in the My Node
  radio picker). Ticked, they are deleted and cannot be restored.
- The current radio cannot be removed (`409`): it would be registered again
  as a new radio on the next connect.
- A replacement link that pointed at the removed radio is cleared, so the
  older radio stands alone again. Contacts, messages and packets are not
  touched. A removed radio that connects again is treated as a new radio.
- New endpoint `DELETE /api/radio-identities/{id}?delete_stats=false`
  (`RadioIdentityRepository.delete`, one transaction, followed by a
  `health` broadcast). No migration.
- Tests: `tests/test_radio_identities.py` (`TestDelete`),
  `tests/test_radio_identity_api.py`, frontend
  `radioIdentitiesSettings.test.tsx` and `api.radioIdentity.test.ts`.
- Docs: `app/AGENTS.md`, `frontend/AGENTS.md`, in-app manual (EN/NL/DE).

## Update 2026-10-05 (Malformed message filter, feat/malformed-message-filter)

### Chat: "Hide malformed" filter for generated channel spam (backend + frontend)
- New **Hide malformed** checkbox in the chat filter popover, below the hop
  size and "Hide unscoped" filters. Off by default. When on, incoming channel
  messages flagged as malformed are hidden in chat and left out of unread
  counts, mention flags, the unread divider, conversation recency, in-app
  notifications and sounds, and Web Push. Your own messages always stay
  visible. Nothing is deleted: turning the filter off shows them again.
- Background: on 2026-10-05 a sender flooded `Public`, `#public`, `#nl` and
  `#nl-public` (region `nl`) with messages of random code points from mixed
  Unicode blocks under a new random sender name each time, at normal 2-byte
  hop width, so the hop size filter did not help. Every one of them carried a
  sender timestamp counted from the MeshCore default clock (15 May 2024).
- A message is flagged when it arrives, at the decrypt step of raw packet
  ingest (`app/malformed.py`), by either rule:
  - Text: the body has no ASCII letter or digit and contains an invalid code
    point (a noncharacter, or planes 4 to 16 outside the tag block), letters
    from two or more script families, or letters next to box-drawing
    characters. Emoji-only, punctuation-only and single-script messages are
    not flagged. Japanese kana with kanji counts as one family.
  - Clock: the sender timestamp is within 30 days after the MeshCore default
    RTC epoch (1715770351) and the message arrives more than a week after it.
    This also flags a real user whose node booted without a clock sync.
- Measured on the live database before the change (7852 incoming channel
  messages): both rules matched all 59 stored spam messages; the text rule
  matched no other message and neither did the clock rule.
- The raw packet header alone cannot identify this spam (same route type, hop
  width, hop counts and relays as normal traffic), so channels the app has no
  key for are not covered.
- The flag is stored (`messages.malformed`, migration `_129`, which also
  backfills existing incoming channel text) and sent with every message
  (`malformed: true`). The filter is the server setting
  `app_settings.hide_malformed`, so it is shared by all browsers.
- Not changed: a channel packet whose decrypted text is not valid UTF-8 was
  already dropped by the decoder and never became a message. In the same
  burst that was 117 more packets on the four channels.

## Update 2026-10-05 (Flood scope lost after a radio reboot, fix/flood-scope-after-radio-reboot)

### Radio connection: set the radio up again after a silent reconnect (backend)
- Fixed: after the radio rebooted, channel messages went out with the radio's
  own stored default scope (for example `nl-nh`) instead of the app's
  "Flood Scope / Region" (for example `nl`), until the server was restarted or
  the scope was saved again. A per-channel regional override equal to the
  global scope did not help, because the app only sent a scope command when
  the override differed from the global scope.
- Cause: the scope the app sets (`CMD_SET_FLOOD_SCOPE`) lives in radio RAM and
  is gone after a reboot. meshcore reconnects a dropped transport by itself
  within about a second, which the 5 s connection monitor usually does not
  see, so post-connect setup (which applies the scope) never ran again.
- `RadioManager.connect()` now subscribes to the library's `CONNECTED` event
  and flags a reconnect (`library_reconnect_pending`); the connection monitor
  then re-runs post-connect setup, the same as after a drop it did see. Setup
  clears the flag when it starts, so a reconnect during setup triggers one
  more run.
- Side effect: every library-level reconnect now runs the full post-connect
  setup (time sync, flood scope, contact/channel sync, and the startup advert
  when that is enabled and not throttled), where it used to do nothing.

### Channels: a regional override is always sent to the radio (backend)
- A channel's regional override (and a per-send `flood_scope_override`) is now
  applied on every send, also when it equals the global "Flood Scope / Region".
  Before, an override equal to the global scope sent no scope command, on the
  assumption that the radio was already on that scope. The radio's live scope
  cannot be read back and can drift from the saved setting, so that assumption
  does not hold.
- After the send the radio is set back to the global scope, as before. That
  also puts a drifted radio back on the global scope.
- Cost: two extra local radio commands (apply, restore) per send on a channel
  whose override equals the global scope. Nothing extra goes on air. Channels
  without an override still send no scope command.

## Update 2026-10-04 (mIRC style chat window, feat/mirc-chat-popup)

### Interface: chat-only popup window (frontend + backend)
- New **Chat window** button in the top bar. It opens the app in a separate
  popup (`?popout=chat`) that only does messaging: a conversation list
  (Channels, Direct, Rooms, with unread counts and a filter), the chat, and the
  recent senders of the open chat. It works without the main tab.
- The popup is the same app with a different shell (`popout/ChatPopoutShell`),
  so the chat itself (`ChatHeader`, `MessageList`, `MessageInput`, room login,
  contact and channel info, New conversation, Search) is the same code as in
  the main app. It does not mount the sidebar, status bar, desktop buddy,
  command palette, channel finder or settings, and it skips the packet seed
  (`GET /api/packets/recent`).
- Views that are not a chat (map, Channel Registry, repeater dashboards,
  Settings) open in the main app instead. Known limit: "Edit in Channel
  Registry" from the popup opens the registry, not that channel's edit form.
- **Detach** opens one conversation in a small window of its own
  (`?popout=single`).
- Message layout is switchable per browser: **Lines** (`[time] <Name> text`,
  the popup default) or the regular **Bubbles**. Both layouts are built from the
  same row pieces in `MessageList` (body, hop / direct / scope badges, delivery
  status, URL preview, row actions), selected through `MessageLayoutContext`.
  The main app always uses bubbles.
- Skins, per browser: **mIRC** (default), **mIRC dark**, or **App theme**
  (follows the theme saved in the main app, also when it changes while the
  popup is open). The two mIRC skins are popup-only and are applied without
  saving, so the main app's theme is not changed.
- While a main tab is open the popup leaves the mention sound, browser
  notifications and new-node notifications to that tab (`BroadcastChannel`
  presence in `popout/mainPresence.ts`), so they do not fire twice. If the main
  tab dies without unloading, the popup takes over after one unanswered probe.

### WebSocket: per-connection event profile (backend)
- `WS /api/ws?events=chat` opts a connection out of `raw_packet` and
  `host_repeater` events (`EVENT_PROFILES` in `app/websocket.py`). The chat
  popup uses it. Without the parameter, or with an unknown value, the full
  stream is sent as before.

### Not measured
- No CPU or memory figures are claimed for the popup. What is verified is what
  it leaves out: the views listed above, the packet seed request and the raw
  packet events.

## Update 2026-10-03 (MeshCore TEAM support, feat/meshcore-team-support)

### Chat: MeshCore TEAM and signalk-meshcore payloads (backend + frontend)
- Channel messages sent by MeshCore TEAM (tmacinc/MeshCore-TEAM) and
  signalk-meshcore (Banzarykey/signalk-meshcore) are now parsed.
  - `#TEL:` position beacon (11 bytes, Base64, padded or not): position,
    radio battery, phone battery, forwarding status, autonomous flag.
  - `#T:` topology beacon: position, batteries, known node count and how many
    of them the sender hears directly (the neighbour bitmap itself is not
    resolved to nodes).
  - `#WAY:` waypoints and routes, with the `@C:` colour prefix and multi-part
    routes continued in `#WRC:` messages.
  - `#CAP:` capability adverts (v1 and v2) and `#CAP:R:` advert requests.
- A `#TEL:` with forwarding status 0 is treated as signalk-meshcore (TEAM
  never sends 0 there): its phone byte is read as a percentage instead of a
  voltage.
- In chat these render as cards instead of raw text. Beacons and waypoints use
  the existing location card, so they get the inline map preview when that
  preference is on. The cards are always on: they load nothing from outside,
  so they do not depend on the "Render MeshCore Open GIFs & Reactions"
  preference. They stay normal messages for unread counts and notifications.
- Parsers: `app/team_payloads.py` and `frontend/src/utils/teamPayloads.ts`
  (mirrored, same test vectors).

### Map: Beacons overlay (backend + frontend)
- New overlay **Beacons** (Map > Overlays, off by default): each sender's
  newest beacon as a pin, waypoints as pins in a second colour, and routes as
  lines in the colour TEAM sent. **Trails** draws every beacon of a sender in
  the map's time window as a dashed track. Pin popups show sender, channel,
  time, position, batteries, distance, hops and **Open in chat**.
- Pins carry an icon by type. Beacons: a boat for signalk-meshcore senders, a
  radio for autonomous TEAM radios, a person for TEAM phone users (the chat
  cards and popups use the same icons). Waypoints: TEAM's own type icon
  (camp, meetup, danger, game area, deer stand, water, vehicle, route,
  custom). The `#TEL:` payload has no vessel or AIS type, so that cannot be
  detected: see the vessel type below.
- New endpoint `GET /api/messages/beacons` (`since`, `until`,
  `latest_per_sender`, `sender_key`): beacons and waypoints from followed
  channels, derived from stored messages. Multi-part routes are
  reassembled per sender, channel and mesh id; an incomplete route gets a pin
  but no line. Beacons without a GPS fix are left out. Blocked senders are
  skipped. Local view only, never forwarded.

### Contacts: beacon history (frontend)
- The contact info pane and page show a **Beacon history** section (time,
  position, status, channel, **Open in chat**) for nodes that sent TEAM
  beacons in a followed channel. Nodes that never sent one do not get the
  section.
- New per-contact **Vessel type** (contact info, next to the power source):
  sailing vessel, motor boat, fishing vessel, cargo ship, passenger ship, tug,
  search and rescue, other. Set by hand; it replaces the sender-kind icon of
  that contact's beacons on the map, in popups and on chat cards. Stored in
  `contacts.vessel_type` through `POST /api/contacts/{key}/annotations`.

### Sending: TEAM waypoints and an optional position beacon (backend + frontend)
- **Share location > Pick on map** offers a second format in private channels:
  **MeshCore TEAM waypoint**, with a waypoint type. It puts a
  `#WAY:<meshId>|<name>|<lat>|<lon>||<TYPE>|` message in the composer; you
  still send it yourself. Not offered on the Public channel, hashtag channels
  or DMs. Routes are not sent.
- **Settings > Radio-App Management > MeshCore TEAM beacon**: a master toggle
  (off by default), a private channel and an interval (60 to 3600 s, default
  240). When on, the radio's own advertised position is sent as a TEAM
  `#TEL:` message on that channel through the normal channel send path, with
  the radio battery when known. Nothing is sent without a connected radio and
  a set position. The Public channel and hashtag channels are refused, both
  when saving and again before every send. The default interval stays under
  the 5 minutes after which TEAM treats a node as stale. `#T:` and `#CAP:`
  are not sent.
- Setting: `team_beacon` (`enabled`, `channel_key`, `interval_seconds`) in
  `GET` / `PATCH /api/settings`. Service: `app/services/team_beacon_sender.py`.
- Migration `_128` adds `contacts.vessel_type` and `app_settings.team_beacon`.
- Not verified on air: the sender is tested with a mocked send only.

## Update 2026-10-03 (suggested DM routes for companions, feat/contact-route-suggestions)

### Contacts: suggested routes (backend + frontend)
- The contact pane of a companion now lists **Suggested routes**: the paths
  the contact was heard on (adverts and incoming direct messages), reversed
  for sending and ranked by freshness, times heard, hop count and past DM
  delivery on that route. New endpoint
  `GET /api/contacts/{public_key}/route-suggestions`
  (`app/services/route_suggestions.py`). No migration.
- Suggest only. Nothing changes how a DM is routed until you press **Use**,
  which sets that route as the existing routing override. The final DM
  retry still floods.
- **Check with analyzer** (optional, per click) asks the analyzer behind the
  external map sync URL whether it has seen the hop links
  (`/api/paths/inspect`) and the link between the last hop and the contact
  (`/api/nodes/{pubkey}/reach`). This sends the contact's public key and the
  hop IDs to that host; the pane names the host. The analyzer only
  validates: it never changes the ranking and never adds a route RTFM-EV did
  not hear itself (`app/services/analyzer_path_check.py`).
- Not included: channel messages as a path source (their sender is matched
  by name), automatic route selection, and the kiekr API (not open to third
  party clients).

## Update 2026-10-02 (Python bot system removed, remove-bot-functionality)

### Integrations: bots removed (backend + frontend)
- The upstream Python bot system is gone: the `bot` fanout type, its code
  executor (`app/fanout/bot_exec.py`, `app/fanout/bot.py`), the bot code
  editor and the "Python Bot" option in Settings > Integrations. Creating a
  `bot` integration through `/api/fanout` now returns 400 (unknown type).
- Migration `_127` deletes existing `fanout_configs` rows with
  `type = 'bot'`. Their bot code is not kept; a pre-upgrade backup still has
  it.
- `MESHCORE_DISABLE_BOTS` is removed (a leftover value in an env file is
  ignored), as are `POST /api/fanout/bots/disable-until-restart`, the
  `bots_disabled` / `bots_disabled_source` health fields, the
  `disable_bots` debug field and the startup "Unprotected bot execution"
  warning modal.
- The service and Docker installers no longer ask about bots. The service
  installer now always offers HTTP Basic Auth (default No); before, it only
  asked when bots were enabled.
- The code editor dependencies (`@uiw/react-codemirror`,
  `@codemirror/lang-python`, `@codemirror/theme-one-dark`) were only used by
  the bot editor and are dropped.

## Update 2026-10-02 (Advert panel on Mesh Discovery, feat/mesh-discovery-advert-panel)

### Tools (frontend)
- **Tools > Mesh Discovery has an Advert panel** at the top with two
  buttons: **Direct (0 hop)** (zero-hop advert, only nodes in direct radio
  range) and **Flood advert** (forwarded by repeaters). They send the same
  adverts as Settings > Radio > Send Advertisement, which is unchanged, and
  are disabled while the radio is disconnected or an advert is being sent.
  No backend change.

## Update 2026-10-01 (OpenHop policy editor: all fields + typed values, policy-filtering-options)

### OpenHop: Policy rules
- The rule editor now offers every field the OpenHop policy engine evaluates:
  `route_type`, `payload_type`, `payload_length`, `path_hash_size`,
  `hop_count`, `rssi`, `snr`, `mode` and `local_transmission` were missing
  next to the channel / path / transport / payload hex fields.
- Fix: numeric and boolean values are saved as JSON numbers and booleans.
  OpenHop compares values without type conversion, so a rule saved from
  RTFM-EV with `"0"` never matched a route type of `0`, and editing a rule
  made on the node turned its numbers into text.
- Each field only offers the operators that apply to it (`intersects` and
  `ends_with` added). Pickers for route type, payload type (now with
  `15 RAW_CUSTOM`), path hash size (1/2/3 bytes), mode (`forward` /
  `monitor` / `no_tx`) and true/false fields.
- Rule summaries show names next to numbers (`route_type equals 0
  TRANSPORT_FLOOD`).
- Rule layout follows OpenHop's own editor: **Match logic** (Match all (AND)
  / Match any (OR)) sits next to **Action** and applies to every condition
  below it. A new rule starts as Match all with one row; there is no
  "Single condition" mode and no per-row match selector any more, and
  **Add condition** is always visible. Conditions can be removed and moved
  up or down. A hint under `channel_message_body` advises putting
  `channel_decryptable` or `channel_hash` above it.
- A rule whose rows are all empty is saved without conditions (`{}`, never
  matches) instead of `all: []`, which OpenHop treats as match-everything.
  Nested groups from older or hand-written rules are still shown; for the
  OpenHop API they carry a warning, because OpenHop does not evaluate them
  (such a group always counts as matched).
- The Settings > Host repeater policy editor shares the builder and gets
  the same layout, pickers, per-field operators and typed values.

## Update 2026-10-01 (meshcore 2.3.14 dependency bump, #261)

### Dependencies
- Bump `meshcore` 2.3.9.1 -> 2.3.14 (`pyproject.toml`, `uv.lock`). Upstream
  changes in that range:
  - 2.3.10: duplicate of an undecryptable channel frame no longer raises
    `KeyError` in the parser; ADVERT_PATH path parsed by length instead of
    stripping zero bytes; serial port fds closed on connect timeout; BLE
    reconnect tears down the stale client (no duplicate notifications); the
    library no longer configures the root logger or forces its own level.
  - 2.3.11: serial connect asserts DTR (same as before) and, if the radio does
    not answer, retries once with DTR inverted. `APP_START` on connect and on
    auto-reconnect now times out after 2 s instead of the 15 s default.
  - 2.3.12-2.3.13: `send_msg_with_retry` rework (fixed timestamp across
    attempts, accepts a late ACK for any attempt). RTFM does not call it; its
    own DM retry loop already behaves this way.
  - 2.3.14: `send_cmd` honours an explicit `dst_type` and no longer raises on a
    bare pubkey string (it assumes a repeater). RTFM keeps passing a
    `{public_key, type}` destination.

### Logging
- The `meshcore` logger is now capped at INFO in `setup_logging`. Up to 2.3.9.1
  the library forced INFO on every connect; from 2.3.10 it inherits
  `LOG_LEVEL`, and at DEBUG it would log the radio's private key export and
  channel secrets as hex to stdout and the debug log buffer.

## Update 2026-10-01 (Windows 95 desktop buddy, clippy-win95-buddy)

### Interface: desktop buddy (Windows 95 theme, then any theme)
- New **Desktop buddy** picker under Settings > Local Configuration (below the
  theme picker) and in the header theme dialog: Off or one of the 10 `clippyjs` agents (Clippy, Merlin, Bonzi,
  F1, Genie, Genius, Links, Peedy, Rocky, Rover). Under Windows 95 Clippy is on
  by default until the user picks another buddy or Off (stored as `off`).
  Other themes only offer the picker once this browser has used Windows 95
  (`rtfm-buddy-discovered`) and default to Off; an explicit choice applies to
  every theme. Per-browser settings (localStorage), like the theme.
- Mounted in `AppShell` next to the Channel Finder, so it stays on screen while
  navigating. It announces new nodes (the existing batched `new_node` WS
  event), DMs and @mentions outside the open conversation, radio
  disconnect/reconnect/pause, an RTFM-EV update and an OpenHop firmware update
  (only when OpenHop management is configured), plus a short tip the first
  time each page is opened in a session.
- Battery warnings with a configurable threshold (default 20%): own radio from
  health `battery_mv`, nodes from `GET /contacts/telemetry/latest` (polled every
  10 minutes while the buddy is shown; telemetry older than 24 h and nodes set
  to mains power are skipped). Warns once per drop, re-arms 5 points above the
  threshold.
- Click the balloon to open what it is about (node, DM, mention, My Node,
  settings page). Drag to move (position saved per browser), double-click for
  an animation, right-click to dismiss until reload; idle animations every few
  minutes.
- CRT themes: the buddy and its balloon sit just below the scanline and
  vignette overlays (z-index 9996, still above every app layer), so scanlines,
  curvature and flicker cover them; under a CRT theme they are recoloured to the
  phosphor (CSS filter in `themes.css`), and the glow effect adds a phosphor
  halo.
- New dependency `clippyjs` ^0.1.0 (MIT library; characters and sprite sheets
  are Microsoft's). Each agent is a lazy chunk (0.9 to 2.5 MB), only fetched
  when picked; sounds are never loaded. No backend change, no migration.

## Update 2026-09-30 (Power Outage tab: sorting + pagination, power-tab-sorting-pagination)

### Mesh Health: Power Outage table
- Column headers (Node, Role, Power, In outage, Island, Last heard) sort the
  node table; click again to flip the direction. Default stays island order
  (nodes without an island last).
- Paginated with a **Show max rows** selector (10 / 25 / 50 / 100 / All). It
  shares the existing `mesh_health_page_size` setting with the Adverts table,
  so changing it on one tab changes both. No migration.
- A floating go-to-top button appears after scrolling down the Power Outage
  tab.

## Update 2026-09-30 (Registry edit shortcut + Knowledge base, feat/registry-edit-knowledge-base)

### Channels: edit in Channel Registry
- New **Edit in Channel Registry** action in the channel header (registry icon)
  and in the channel info panel. It opens Tools > Channel Registry with that
  channel's edit dialog already open; a channel missing from the registry is
  added first. The registry itself stays browser-local.

### Tools: Knowledge base
- New **Tools > Knowledge base** view: your own handy links, grouped by the
  Handy Info categories. **Add link** creates a custom link that is shown there;
  removing a link only takes it out of the Knowledge base (it stays in Handy
  Info).
- Settings > Handy Info > Links: a book icon on every link (built-in or custom)
  adds it to or removes it from the Knowledge base.
- Stored as a `kb` flag in the existing `handy_info` settings overlay (built-in
  override or custom entry; links only). No migration. Editing a link keeps
  its flag.

## Update 2026-09-30 (Power source: DTIS nodes + per-contact override, power-source-contact-override)

### Contacts: power source override
- New **Power source** dropdown in the contact info annotations (next to
  Battery chemistry): Auto (shows what the name gives) / Mains / Battery /
  Solar / Solar + battery / Unknown. Stored in `contacts.power_source`
  (migration `_126`, nullable, NULL = auto) via
  `POST /api/contacts/{key}/annotations`; 422 on any other value.
- Precedence (`resolvePowerSource` in `frontend/src/utils/powerSource.ts`):
  manual override, then DTIS name prefix, then the power icons in the name.
  Used by the map Power source filter and the Mesh Health Power Outage tab.

### Power source detection: DTIS nodes
- Nodes whose name starts with `DTIS |` (case-insensitive) run on a P1 Pro with
  solar and are classified as **Solar + battery**, over any icon in the name.
- Unknown keeps its own label and still counts as going dark, like Mains.
  Help text and User Guide (EN/NL/DE) updated.

## Update 2026-09-30 (Host repeater DMC filter + MQTT sync with dmc-observer-dev, feat/host-repeater-dmc-filter-sync)

### Host repeater: DMC packet filter
- The filter follows DMC `dmc-observer-dev` (`923fc428`): new **dry-run**
  (count drops, still forward), **per-node advert window** (each origin's flood
  advert once per 0-720 h, 256-entry cache), **blocked path prefixes** (up to 8,
  1-4 bytes, whole-entry match), **sender and text rules** (up to 8 each; block,
  throttle one match per N s, or decide a share of matches; first rule that
  decides drops) read on Public plus up to 4 watched `#` channels, and a
  **message age limit** (1-10080 min). The malformed scan's +-1 week check and
  the age limit are skipped while the clock reads before 2026, like the firmware.
- Check order is the firmware's (hash, path, hops, advert window, group-text
  checks, rate limit), except that group-text content drops still never consume
  the GRP_TXT rate budget (existing deliberate deviation).
- New per-reason filter counters (per-type hops / rate, hash size split, malformed
  reasons, per channel / prefix / rule drops and throttle passes, top sources,
  saved airtime, dry-run hits) in the stats pane and `stats.filter`. No migration:
  the settings document gains fields with defaults.

### Host repeater: neighbours
- The host repeater keeps a neighbours table like a DMC observer repeater:
  signed zero-hop repeater adverts and discover replies, max 50.
- New opt-in **Neighbour poll** (Settings > Host repeater), 12-336 h, default
  24 h. It **transmits**: one zero-hop repeater discover (60 s listen), then per
  neighbour an anon regions request sent zero-hop. Runs while the host repeater
  is shadow or armed on a connected non-OpenHop radio; the first poll waits 2
  minutes. The radio contact used for a request is restored (or removed) after.

### Community MQTT
- New opt-in `filter` topic (`publish_filter`, 60-600 s, default 60 s): the host
  repeater's filter counters, per-type config and live `region_gate`, in the
  observer `MQTTFilterStatsJson` shape. `dryrun` is true unless the host repeater
  is armed; `host_repeater.state` says which.
- New opt-in own `neighbors` topic (`publish_own_neighbors`), sent once per
  completed neighbour poll with `self.scopes` / `default_scope`.
- Both only publish while the host repeater is shadow or armed.
- `config` topic: adds `boot_id`, `radio.rx_delay` / `tx_delay_factor` /
  `direct_tx_delay_factor` (host repeater timing), `mqtt.filter_interval`,
  `mqtt.own_neighbors` and `mqtt.neighbors_interval` (while the poll is on).
- Docs: README host repeater section, `app/AGENTS.md`,
  `app/fanout/AGENTS_fanout.md`, `frontend/AGENTS.md`, `docs/parity-audit.md`,
  `docs/sources-of-truth.md`.

## Update 2026-09-30 (SQLite reader pool + traffic-links index, perf/sqlite-reader-pool)

### Backend: database concurrency
- Reads no longer queue behind writes. `Database.readonly()` now hands out one
  of three read-only reader connections (WAL, `PRAGMA query_only`, LIFO pool so
  sequential reads reuse a warm cache) instead of sharing the single writer
  connection under its lock. `tx()` is unchanged. A slow analytics read no
  longer stalls packet ingest or other writes: on a copy of a live database,
  a contact mark-read during two looping `traffic-links` requests went from a
  13 s median (31 s max) to 50 ms. Each reader has a 64 MB page cache, so
  SQLite cache memory can grow by up to 192 MB under concurrent reads.
  `:memory:` databases (tests) keep the single connection and switch
  `query_only` on during reads, so a write inside `readonly()` fails in tests.

### Backend: traffic-links index
- Migration `_125` adds a covering index `ix_link_edge_events_group`
  (`a_pubkey, b_pubkey, hop_width, ts, raw_packet_id, confidence`), so the
  map's All-traffic link aggregation reads only the index. On a 226k-row
  `link_edge_events` the query went from about 2.7 s to 0.2 s warm. Costs about
  35 MB of disk at that size; building it took 23 s once at startup.

## Update 2026-09-30 (Relay reception without the 5000-copy cap, hourly history and per-relay details, feat/relay-reception-history)

### Mesh Health: Relay reception covers the whole window (backend, frontend)
- The tab loaded at most the newest 5000 received copies, so windows of about
  6 h and longer showed a capped "Copies received" and a per-relay summary
  built from part of the window. The summary and totals are now SQL
  aggregates over every copy in the window (`GET /api/packets/relay-reception`).
- "Packets via 2+ relays" now counts the whole window (it counted only the
  packets shown in the table) and a new "Packets" tile shows all packets.
- The per-packet table pages through the window: rows per page 25/50/100/200
  (remembered per browser) with previous/next (`limit` 1-200 + `offset`,
  `packet_total`).
- The per-relay table gains **First** (packets whose first copy came via that
  relay, with its share) and **Only via** (packets heard only via that relay),
  both sortable.

### Mesh Health: per-relay details (backend, frontend)
- Each relay row expands (arrow before the name) into its history for the
  window: copies, packets (share of all packets), first arrivals, packets
  heard only via it, average/best SNR and RSSI, an activity chart (copies and
  first arrivals) and a signal chart (average SNR and RSSI) over time, packet
  types, hop counts and the 25 newest copies with a "first" marker and the
  number of relays that delivered that packet.
- New endpoint `GET /api/packets/relay-reception/relay?start_ts&end_ts&relay=<hash>`
  (repeatable; `relay=` for copies heard from the origin).

### Mesh Health: long-term relay history (backend, settings)
- Stored copies are still pruned after 2 days by default. Before each
  retention prune, every complete hour is folded into a new hourly per-relay
  table (`relay_reception_hourly`, migration `_124`), so windows longer than
  the stored copies (7d, 14d, 30d) show per-relay totals and charts. The tab
  notes from when the stored copies start; the per-packet table, packet types,
  hop counts and recent copies cover stored copies only. If the rollup fails,
  the prune of stored copies is skipped for that run.
- New retention setting **Relay history, hourly (Mesh Health)**
  (`relay_history_retention_days`, default 365, `0` keeps forever) under
  Settings > Data retention.
- Docs: User Guide (EN/NL/DE) Mesh Health section, `app/AGENTS.md`,
  `frontend/AGENTS.md`.

## Update 2026-09-30 (Guessed locations at every zoom + labels, fix/guessed-locations-no-min-zoom)

### Map: guessed locations
- Guessed-location markers no longer have a minimum zoom; they draw at every
  zoom level like real node markers (removes the zoom 8 limit from #252).
- Guessed markers now get a name / ID-tag label that follows the map's Labels
  setting (off / name / ID tag) and shows from the same zoom as real node
  labels (`LABEL_MIN_ZOOM`, 11). The label layer sits below the real node
  labels, so a real node's label wins a collision. Help text, User Guide
  (EN/NL/DE) and `frontend/AGENTS.md` updated.

## Update 2026-09-30 (Power source filter + Power Outage tab, power-source-filtering-resiliency)

### Map: power source filter
- New **Power source** section in the map Filters panel: show or hide nodes by
  the power icon in their name (⚡/🔌 mains, 🔋 battery, ☀️/🌞/🔆 or the word
  "solar" for solar, solar + battery, no icon = Unknown). Classification
  mirrors EU-Meshcore-Analyzer (`frontend/src/utils/powerSource.ts`). Choice
  persists in `remoteterm-map-hidden-power`; the focused node is exempt.

### Mesh Health: Power Outage tab
- New **Power Outage** tab (`MeshPowerOutagePanel`) showing which nodes would
  stay online when the grid goes down: Battery/Solar/Solar+battery survive,
  Mains/Unknown go dark. Stat tiles, power source mix, and surviving
  "islands" (connected components over heard advert-path links where both ends
  survive, `frontend/src/utils/powerResilience.ts`) with a per-node table
  (status filter, open node, show on map). Scope: repeaters + rooms or all
  nodes; heard within 24h/7d/30d/all. Frontend only, no migration.

## Update 2026-09-30 (Guessed locations visible from farther out, fix/guessed-locations-min-zoom)

### Map: guessed locations
- Guessed-location markers now draw from zoom 8 instead of zoom 12
  (`GUESSED_LOCATIONS_MIN_ZOOM` in `frontend/src/map/layers/guessedLocationsLayer.ts`),
  so estimated node positions are visible from a regional view. Help text,
  User Guide (EN/NL/DE) and `frontend/AGENTS.md` updated to match.

## Update 2026-09-29 (README rewritten for the fork + docs site, feat/readme-fork-refresh)

### Docs: GitHub Pages documentation site
- New documentation site on GitHub Pages: the README (landing page),
  `README_ADVANCED.md`, `README_HA.md` and the in-app User Guide (EN/NL/DE) are
  built from the repository markdown by `.github/workflows/pages.yml`
  (`scripts/build/stage_pages_site.py` + the `pages/` shell, official Pages
  actions) on pushes to main that touch those sources. No generated HTML is
  committed and internal `docs/` material is not published. Other relative
  links point to the files on GitHub. Needs Settings > Pages > Source set to
  "GitHub Actions" once.

### Docs: README.md
- `README.md` rewritten as the README of RTFM-EV (a fork of RemoteTerm for
  MeshCore): what it is, what the fork adds, a feature overview grouped by
  area, requirements, quick start (source and Docker), a configuration table
  of the main `MESHCORE_*` variables, security notes, meshcomod / OpenHop /
  host repeater summaries, and links to the in-app User Guide,
  `README_ADVANCED.md`, `README_HA.md`, this changelog, `docs/` and
  `CONTRIBUTING.md`. Per-screen detail now lives in the User Guide.
- Removed the Arch Linux (AUR) install path: the `rtfm-ev` AUR package it
  named does not exist (the AUR RPC lists only upstream's
  `remoteterm-meshcore`), and the fork has not published a release.
- The prebuilt-frontend tip now says it needs a fork release carrying a
  prebuilt frontend asset, which does not exist yet.
- Dropped the "planned" roadmap items that have since shipped (device history,
  multi-radio identity) and a stray sentence fragment.
- Node requirement updated to what the frontend toolchain needs (Vite 8:
  Node 20.19+ or 22.12+).

## Update 2026-09-29 (Coordinate format everywhere, fix/coordinate-format-everywhere)

### Settings > Local > Coordinate format (frontend)
- The chosen format (decimal, degrees/minutes/seconds, MGRS) now also applies
  to positions that still showed fixed decimals: the contact/repeater status
  line under the name, the Path modal node coordinates, My Node (header and
  Location row), the Mesh Health prefix-collision node list, the repeater
  Node Info Lat/Lon row and the Community Map geofence-center note. Decimal
  mode keeps each spot's previous precision; the repeater Node Info row keeps
  the raw values the repeater returned. Reported by Richard on Discord.

## Update 2026-09-29 (In-app User Guide, feat/user-guide-manual)

### Tools: User Guide page (frontend)
- New "User Guide" entry in the sidebar Tools section, also reachable at
  `#manual`. It covers getting started, the layout, messaging, contacts and
  nodes, the map, every Tools view, every Settings section, integrations,
  backup/restore/retention and troubleshooting.
- Covers swapping radios (#248): the different-radio prompt, the one-time
  history question, Settings > Radio > Radios, the My Node radio picker and
  owned nodes carried over from a replaced radio.
- Full text in English, Dutch and German (`frontend/src/content/manual/`),
  following the interface language with English as fallback. UI labels in the
  NL/DE text match the NL/DE catalogs.
- A table of contents scrolls to each section without changing the URL hash;
  on narrow screens it folds into a "Contents" panel above the text.
- Rendered by a small built-in markdown subset parser to React elements (no new
  dependency, no HTML injection). Tests check that all three locales keep the
  same ordered section ids and contain no em dash.
- The User Guide view no longer triggers a message fetch (added to the
  non-message conversation types).

## Update 2026-09-29 (Radio identity registry, plan 18 Phase 1, feat/multi-radio-identity-history)

### Radio: remember which radio fed the install (backend + frontend)
- New `radio_identities` registry (migration `_123`): every radio that has fed
  this install, recorded at connect from the radio's own key.
- Battery, noise floor and airtime samples now record which radio measured
  them (`radio_identity_id`). Swapping the radio no longer blends two devices
  into one series, and airtime no longer spikes across a swap. A sample from a
  swapped radio that is not registered yet is skipped.
- Existing samples: on the first connect after the upgrade they are assigned
  to the connected radio when every own key found in the history (outgoing
  channel messages, 0-hop signal samples) is that radio's. Otherwise the app
  asks once whether the history belongs to this radio.
- A different radio connecting raises a prompt: new radio, or a replacement
  for an earlier one with what it inherits (battery/noise/airtime history,
  owned nodes, the note). Carry-over is applied when reading; nothing is moved
  or deleted. "Decide later" hides it for the browser session; the radio keeps
  working meanwhile.
- Settings > Radio > Radios lists every radio (also without a connected
  radio): answer a pending radio, change or undo a replacement link, add a note.
- My Node battery, noise floor and airtime charts show the current radio plus
  what it inherits; a radio picker appears once there is more than one radio or
  history from before radio tracking.
- The sidebar Owned section also lists nodes owned by a replaced radio when
  the link carries "Owned nodes".
- API: `/api/radio-identities` (list, confirm-new, replace, legacy-history,
  link edit/undo, notes); `radio_id` / `unassigned` filters on the
  `/api/statistics` battery, noise-floor and airtime endpoints; `health` carries
  `radio_identity`. Observed mesh data (contacts, packets, messages) stays
  global. Nothing is transmitted.

## Update 2026-09-29 (Loadouts: contacts + disconnect prompt, plan 08 slices 2-3, feat/loadouts-contacts-disconnect)

### Radio: loadouts hold contacts too (backend + frontend)
- Channel sets are now called "Loadouts" in the UI (Settings > Radio-App
  Management > Loadouts). API paths and storage keep the `channel-sets` name.
- A loadout can hold contacts as well as channels (or only contacts). The
  editor lists contacts with a full public key, filterable, selected first.
- Loading a loadout adds its contacts to the radio after its channels.
  Additive: contacts already on the radio are reported as such and nothing is
  removed. A full contact table fails that contact and the rest
  (`table_full`); a contact deleted since saving fails as `unknown_contact`,
  one set to App only as `excluded`.
- Contacts a loadout put on the radio (or found there) stay protected until
  the next reconnect: they join the first residency tier after pinned contacts
  (reason "loadout" in the contact's radio residency), so a full sync does not
  remove them. Protection is in memory only and adds up over several loads.
- `POST/PATCH /api/channel-sets` take `contact_keys`; apply returns
  `contact_items`, and the totals cover channels and contacts. No migration.

### Radio: offer a loadout before disconnecting (frontend)
- Settings > Radio > Disconnect, while the radio is connected and at least one
  loadout exists: a dialog to pick a loadout and "Load and disconnect",
  "Disconnect without loading", or Cancel. When anything fails to load, the
  per-item results are shown and the radio stays connected until you choose
  "Disconnect anyway". Without loadouts, Disconnect works as before.

## Update 2026-09-29 (OpenHop receive-error graph, fix/openhop-crc-rx-errors)

### My Node: receive-error graph on OpenHop nodes (backend)
- With the OpenHop API configured, `GET /api/statistics/airtime/range` now
  fills `rx_errors` from OpenHop's radio CRC error history
  (`/api/crc_error_history`), bucketed like OpenHop's airtime buckets, so the
  My Node "Receive errors" card shows on OpenHop nodes. If that call fails the
  airtime chart still loads and the card stays hidden.
- OpenHop's companion `STATS_PACKETS` frame puts the repeater's dropped-packet
  count in the `recv_errors` slot, not radio CRC errors. The sampler no longer
  stores that value for OpenHop nodes (`airtime_history.recv_errors` is NULL),
  so without the OpenHop API the card is hidden instead of showing drops as
  receive errors. Rows stored before this change are left as they are.
- New `OpenHopClient.crc_error_history`. No migration.

## Update 2026-09-29 (Richard's Discord requests, feat/richard-requests-2026-09-29)

### Sidebar: sort a custom group by recent activity (frontend + backend)
- Each user-created sidebar group has its own sort toggle (A-Z / recent),
  the same control as the Favorites sub-groups. On "recent", channels and
  contacts in the group are interleaved with the most recently active one on
  top.
- Stored per group as `sort_order` (`alpha` default, `recent`) inside the
  existing `app_settings.contact_groups` JSON. No migration; groups saved
  before this keep A-Z.

### Security: bots are off by default in this fork (backend)
- `MESHCORE_DISABLE_BOTS` now defaults to `true` (upstream: `false`). The bot
  system cannot run or be configured unless the server is started with
  `MESHCORE_DISABLE_BOTS=false`, so the startup security warning no longer
  appears on a default install.
- Existing bot integrations stop running after upgrade until
  `MESHCORE_DISABLE_BOTS=false` is set. Settings > Integrations says how to
  re-enable them.

### Map: "Equal node sizes" toggle (frontend)
- Map settings > node size: a checkbox that draws companions, rooms and
  sensors at the repeater size, on both the flat and neon node layers. Off by
  default (repeaters stay larger); remembered per browser.

## Update 2026-09-26 (Channel sets, plan 08 slice 1, feat/channel-sets)

### Channels: load a saved channel set onto the radio (backend + frontend)
- Settings > Radio-App Management > Channel sets: save named groups of
  channels and load one onto the radio's channel slots with "Load onto
  radio", for example before taking the radio away from the server.
- Loading is additive: the radio's slots are read first, channels already on
  the radio are left as they are, every other set channel goes into an empty
  slot, and no channel is ever evicted. Each channel reports loaded (slot),
  already on the radio (slot), or not loaded (no free slot, or the radio
  refused it); one failure does not stop the rest.
- On TCP radios (and with `MESHCORE_FORCE_CHANNEL_SLOT_RECONFIGURE`) slot 0
  is left alone, because every channel send writes its channel there first.
- A point-in-time load: the next reconnect or full periodic sync offloads the
  radio's channel slots again, as for every channel. Nothing is transmitted.
- `GET/POST /api/channel-sets`, `PATCH/DELETE /api/channel-sets/{id}`,
  `POST /api/channel-sets/{id}/apply`; sets stored in
  `app_settings.channel_sets` (migration `_122`).
- Contacts in sets (slice 2) and a load-before-disconnect prompt (slice 3)
  are not built.

## Update 2026-09-26 (Docs reconciled through #242, fix/docs-reconcile-236-242)

### Documentation
- **`docs/parity-audit.md`:** status reconciled to `c0985781` (#242). No §7
  item changed; the later merges (#237-#242) are docs, plan work outside the
  audit's reference sets, tester fixes and a test fix, and are listed in the
  status.
- Refreshed the commit counts in this changelog's header.

## Update 2026-09-26 (Backend test flake: radio operation lock bound to an old event loop, fix/send-messages-lock-loop-flake)

### Tests: fresh radio operation lock per test (backend)
- `test_concurrent_sends_to_same_channel_both_succeed` failed intermittently
  in CI (main push run for #240 and the #241 PR run) with "Lock ... is bound
  to a different event loop". `radio_manager._operation_lock` is a
  module-global `asyncio.Lock`; it binds to the event loop of its first
  contended acquire, and a lock left bound by an earlier test on the same
  xdist worker broke the next test's concurrent sends. The per-file
  save/restore fixtures only put that same lock back. `tests/conftest.py`
  now resets it to `None` around every test (the app creates it lazily).
  Test-only change.

## Update 2026-09-26 (Relay signal map overlay, plan 21 S2, feat/relay-snr-map-layer)

### Map: relay signal rings (frontend)
- New map overlay (Overlays > Relay signal, off by default, remembered per
  browser): a ring around each relay that passed flooded packets to your
  radio in the map's time window, coloured by the average SNR your radio
  measured on those copies (the amber -> blue -> green ramp of the live
  packet arcs) and sized by the number of copies, with a "+5.3 dB · 8×"
  label. The rings sit under the node circles and do not take clicks, so
  node popups work as before. The panel counts the relays drawn and those
  left out (no unique node or no known position).
- Data is the per-relay summary of `GET /api/packets/relay-reception` (Mesh
  Health > Relay reception), joined in the browser with the map's contacts
  (manual locations and map filters applied); refreshed every minute for
  open-ended windows. No backend change. This is the fixed-station form of
  plan 21 S2 (signal by relay position); an SNR-over-GPS track needs a moving
  radio and is not built.

## Update 2026-09-26 (Soft links in the visualizer and path modal, plan 16, feat/soft-links-visualizer-pathmodal)

### Packet visualizer and path modal: name linked hop prefixes (frontend)
- A hop prefix the user linked to a node in Settings > Radio-App
  Management (the partial node soft links from #152) now shows that node
  where the prefix alone was ambiguous or unknown. In the packet visualizer
  the node is labelled with the linked name and the tooltip reads
  "Probably: <name>", with the other local matches under "Other possible";
  the link wins over the advert-path guess because it was reviewed, and the
  node stays marked ambiguous. In the path modal ("Show paths") such a hop
  reads "Linked to <name> (soft link)" instead of `<UNKNOWN>`, or above the
  list of ambiguous matches.
- The links come from `GET /api/partial-resolutions` (a DB read), loaded
  when the visualizer mounts or the path modal opens
  (`hooks/useSoftResolutions.ts`). Names resolved for unnamed full-key
  contacts (#226) already reached both views through the contact list.

## Update 2026-09-26 (Tester fixes: hop-size filter, map focus, soft links, fix/richard-hop-filter-map-focus)

### Chat: "Hide by hop size" filter applies everywhere (backend + frontend)
- The filter moved from browser localStorage to the server setting
  `app_settings.hidden_hop_widths` (migration `_121`, JSON list of 1/2/3,
  default empty). A local choice from before this change is carried to the
  server once on first load (only when the server has none), then the old key
  is removed.
- Opening a channel no longer shows a hidden message just because it is the
  first unread one: the unread divider moves to the first visible unread
  message, or disappears when every unread message is hidden. Same for the
  "Hide unscoped" filter.
- Hidden messages no longer count as new: `/read-state/unreads` excludes them
  from counts, mention flags, the unread boundary and last message times
  (like blocked senders), live WebSocket messages hidden by the filter raise
  no unread count, notification, sound or mention ticker (like a muted
  channel), and Web Push skips them. Unread counts are re-fetched after the
  filter changes. "Hide unscoped" stays a per-browser view filter.

### Map: "view on map" centres on the requested node (frontend)
- The map's one-time initial camera fit read the contacts of its first
  render, so a focus link opened before contacts loaded, or a new focus on an
  already open map, left the camera on the home view or the previous
  location. The map now centres once per focus key as soon as the node is
  known (advertised or manual location), and skips the delayed geolocate
  fallback while a focus is pending.

### Settings: remove applied soft links (frontend)
- Radio-App Management -> "Sync partial node info" lists the soft links
  applied earlier (collapsed, with count) with a remove button per row.
  Removing clears only the link; a contact it created or merged stays.

## Update 2026-09-26 (Room ACL history + device history retention, plan 14, feat/room-config-history-retention)

### Room server dashboard: ACL history (backend + frontend)
- Fetching a room server's ACL now also stores an `acl` snapshot in
  `device_config_history`: who has which permission, sorted by key prefix,
  without the locally resolved names, so a reordered list or a contact that
  gained a name is not a change. An empty list (no answer) is not stored.
  Room status and LPP telemetry were already kept in telemetry history.
- New `GET /api/contacts/{key}/room/config-history`. The room tools show the
  same "History" block as the repeater dashboard, full width, re-read after
  an ACL fetch (DB only, nothing sent to the room server).

### Data retention: device history (backend + frontend)
- New `device_history_retention_days` (migration `_120`, default 0 = keep
  forever, the behavior so far): one age limit for the pane snapshots
  (`device_config_history`) and the contact positions
  (`contact_location_history`, aged by when a position was last reported,
  so a node still sending it keeps it). Settings > Database > Data retention
  gains a "Device history" row with the row count of both tables; the
  retention stats endpoint lists them as `device_config` and
  `contact_locations`.

## Update 2026-09-25 (Parity L4 closed, fix/parity-l4-auto-discovery-closeout)

### Documentation
- **`docs/parity-audit.md`:** the last open §7 item, the L4 auto contact
  discovery confirmation, is closed by inspection. RTFM-EV discovers
  contacts automatically (every advert heard, plus the radio's own
  auto-add), "Block Discovery of New Node Types" skips new contacts per
  type, and new-node notifications are opt-in per type. There is no
  confirm-before-add queue, by design. The §5 row moves from Unverified to
  Present and L4 to DONE. No code change.

## Update 2026-09-25 (Live verification of #230-#234, fix/config-history-partial-timeout)

### Repeater dashboard: a partly answered pane fetch is not a config change (backend)
- When only some CLI commands of a pane timed out (live: `get lat` on
  NL-DHR-TDP-EV while name and lon answered), the response was stored in
  `device_config_history` with that field empty, so the History block
  showed "lat 52.95 -> -" and then "- -> 52.95" on the next full fetch.
  `DeviceConfigHistoryRepository.record` now keeps the latest snapshot's
  value for a field that came back empty, so such a fetch adds nothing
  unless another field really changed. A field that never answered stays
  empty. The pane itself still shows what came back. Snapshots already
  stored are left as they are.

## Update 2026-09-25 (Docs reconciled through #234, fix/docs-reconcile-224-231)

### Documentation
- **`docs/parity-audit.md`:** status reconciled to `34ffcb0f` (#234). No §7
  item changed after #220; the later merges (#221, #224-#228, #230-#234) are
  plan work outside the audit's reference sets and are listed in the status.
- **`app/AGENTS.md`:** tree gains `services/relay_reception.py`,
  `services/analyzer_resolution.py`, the new repository stores
  (`packet_receptions`, `device_config_history`, `analyzer_names`, location
  history in `contacts`) and the tests `test_relay_reception.py`,
  `test_device_history.py`, `test_analyzer_resolution.py`.
- **`frontend/AGENTS.md`:** tree gains `MeshRelayReceptionPanel.tsx`.
- **`docs/sources-of-truth.md`:** Cornmeister's node API as the name
  resolution preset, and the `public` channel naming of the
  meshcore-analyzer.eu sites.
- Refreshed the commit counts in this changelog's header.

## Update 2026-09-25 (Device history view, plan 14 second slice, feat/device-history-view)

### Repeater dashboard and contact info: read-only history (frontend)
- The repeater dashboard gains a "History" block (full width, below the
  telemetry history): the stored pane snapshots from
  `GET /api/contacts/{key}/repeater/config-history`, grouped by pane (Node
  Info, Radio Settings, Advert Intervals, Owner Info, Regions), newest
  first, each showing the fields that changed against the previous snapshot
  (old value struck through, new value) or, for the oldest, all stored
  fields. Five per pane, then "Show all". It re-reads after a pane fetch
  completes and has its own refresh; both are database reads, nothing is
  sent to the repeater.
- The contact info page (Network region) gains "Positions": the positions
  the contact advertised, from `GET /api/contacts/{key}/location-history`,
  newest first, in the coordinate format set under Settings, with first and
  last seen. Hidden until at least one position is stored.
- No new endpoints. New i18n keys (EN/NL/DE) `repeater_config_history_*`,
  `contact_positions_heading`, `contact_positions_note`.

## Update 2026-09-25 (Host repeater policy rules: regex, prob, throttle, saved airtime; feat/host-repeater-filter-rules)

### Host repeater: rule engine parity with the jhuebert/MeshCore repeater filter (backend)
- Policy rule fields `channel_name` (the channel RTFM-EV decrypted the packet
  with, via `RxFacts.channel_name`), `region` (`unscoped` for plain floods, the
  resolved region name for scoped ones, none for direct packets), `path_first`,
  `path_last` and `path_string` (`10>a1>b2`), so rules can isolate one upstream
  relay or combine a channel with a region the way `FILTER.md` recipes do.
- New `matches` operator: a Python regular expression searched in the field
  (`^`/`$` anchors, `(?i)` for case-insensitive). Patterns are validated and
  capped at 128 characters when the settings are saved, and compiled through a
  bounded cache.
- Per-rule gates in `then`: `prob` (1-100, the rule decides only that share of
  its matches; the roll is deterministic per rule and packet hash) and
  `throttle_seconds` (one matching packet per window slips past, the rest get
  the action) with `throttle_key` (`rule`, `sender`, `channel`, `path_first`;
  the firmware only has the per-rule budget). A rule that steps aside is
  skipped like a non-match, so the next rule decides. Throttle state lives in
  `PolicyState` inside the engine and resets with the seen table.
- Stats: `policy_passes` per rule, and saved airtime (estimated time-on-air of
  the frame we would have re-sent) for policy drops, DMC filter drops and the
  advert limiter, as `airtime.saved_total_ms`, `saved_airtime_by_reason` and
  `saved_airtime_by_rule`, in session and lifetime totals.
  (`app/services/host_repeater_settings.py`, `host_repeater_policy.py`,
  `host_repeater_engine.py`, `host_repeater.py`; tests
  `tests/test_host_repeater_rules.py`)

### Host repeater: rule editor and stats (frontend)
- The rule form (host repeater only) gains **Match probability**, **Throttle
  (seconds)** and **Throttle budget**; blank inputs are omitted so existing
  rules keep their shape. The OpenHop API rule form is unchanged.
- The rule list shows `prob` / `throttle` badges and, from the stats poll, each
  rule's hits, throttle passes and saved airtime. `payload_type` conditions get
  a type-name picker. The stats pane shows the saved airtime total in the
  session and lifetime blocks. EN/NL/DE strings.
  (`OpenHopRuleForm.tsx`, `OpenHopPolicyRules.tsx`,
  `OpenHopConditionBuilder.tsx`, `HostRepeaterSettings.tsx`,
  `HostRepeaterStatsPane.tsx`, `types.ts`; tests
  `src/test/hostRepeaterPolicyRules.test.tsx`)

## Update 2026-09-25 (Relay reception refreshes live, plan 21 S1 Phase 3, feat/relay-reception-live-ws)

### Mesh Health: Relay reception updates as packets arrive (backend, frontend)
- The `raw_packet` WebSocket event gains `relay_reception` (true when the
  copy was stored in `packet_receptions`, i.e. flood-routed) and
  `last_hop_hex` (the delivering relay, null = heard from the origin).
  `record_packet_reception` returns what it stored so the processor can
  fill both.
- The Relay reception tab re-fetches when such a copy arrives, at most once
  every 3 s, on the short windows (30m/1h) that the header marks as
  auto-refresh; a 30 s poll is the fallback when the stream is quiet or a
  WebSocket event was missed. The tab had no polling before (only Adverts
  and Requests did). Longer windows stay manual (Refresh button).

## Update 2026-09-25 (Analyzer channel links: lowercase Public, fix/analyzer-public-channel-name)

### Analyzer links: the default Public channel is `public` on meshcore-analyzer.eu sites (frontend)
- The meshcore-analyzer.eu software (Cornmeister, Meshcore-analyzer.eu,
  MeshCoreNetz, MeshDresden; channel pages at `#channels?channel={name}`)
  lists the default Public channel as `public` (checked against each site's
  `/api/channels`), so "Open channel on ..." and the reaction-target link
  for Public opened an empty channel page there. `buildChannelLookupUrl`
  now substitutes `public` for the default Public channel (key
  `8B3387E9...`) on templates of that shape. Other analyzers (on8ar's
  CoreScope lists `Public`) and the separate `#public` hashtag channel are
  unchanged.

## Update 2026-09-25 (Fixes from the live check of #224-#228, fix/verify-224-228-findings)

### Mesh Health: one relay, one row across path hash widths (backend, frontend)
- The Relay reception summary grouped relays by the raw last-hop hash, so a
  relay heard on packets with 2-byte and 3-byte path hashes (`6942` and
  `694203`) showed up as two rows and two pivot columns, and a packet's cell
  for the wider hash fell into "+n more" instead of that relay's column.
  `aggregate_relay_receptions` takes a `relay_identity` key; the endpoint
  merges hashes that resolve to the same unique contact (labelled with the
  longest hash seen) and the panel matches cells to columns by resolved key.
  Unresolved and colliding hashes stay separate.

### Repeater dashboard: an unanswered pane fetch is not a config snapshot (backend)
- A pane fetch that timed out (every field empty, e.g. "No CLI response")
  was stored in `device_config_history` as a snapshot, which records a fake
  change now and another when the repeater answers again. Such responses
  are skipped. Snapshots already stored are left as they are.

### Handy Info: name resolution on analyzers applied before plan 16 (frontend)
- An analyzer applied before its preset gained a node API template (for
  example Cornmeister applied before #226), or whose entry was edited to add
  one afterwards, kept a site without the template, so the Configure tab
  showed "No node API template" and no checkbox. The checkbox now also
  appears when the Handy Info entry carries the template, and enabling it
  copies the template onto the applied site.

## Update 2026-09-25 (Contact location and repeater config history, plan 14, feat/device-history)

### Persistence: location history and repeater pane snapshots (backend)
- New `contact_location_history` (migration `_119`): every distinct position
  a contact advertises, rounded to 4 decimals (about 11 m, so GPS jitter
  collapses into one row; missing and (0, 0) positions are ignored), with
  first/last seen, the same shape as name history. Captured from advert
  ingest and contact-card import. Read with
  `GET /api/contacts/{key}/location-history`.
- New `device_config_history` (same migration): snapshots of the repeater
  dashboard panes (node info, radio settings, advert intervals, owner info,
  regions) stored as JSON when a fetched pane differs from the last stored
  one (the repeater clock, local owner-info bookkeeping, the guest password
  and the raw regions dump are excluded from the comparison and the
  snapshot), at most 200 per contact and kind. Read with
  `GET /api/contacts/{key}/repeater/config-history?kind=`. Room-server
  panes and a history UI are deferred. Decisions: 4-decimal rounding, rooms
  deferred, cap 200 (2026-09-25).

## Update 2026-09-25 (Relay reception comparison, plan 21 S1, feat/relay-reception)

### Mesh Health: per-relay reception of the same flooded packet (backend, frontend)
- New `packet_receptions` table (migration `_118`): one row per received
  copy of a flood-routed packet (`raw_packets` keeps one row per payload, so
  copies via other relays were invisible until now), with the delivering
  relay (last path hop, `path_utils.last_hop_hex`), SNR/RSSI, route, hop
  count and hash width. Written by `record_packet_reception` right after the
  raw-packet dedup; direct-routed packets are skipped (their path is popped
  hop by hop, plan 21 Q3). Retention setting
  `packet_reception_retention_days` (default 2 = 48 h, 0 keeps forever) in
  Settings > Database > Data retention, pruned with the other classes.
- `GET /api/packets/relay-reception?start_ts&end_ts&limit`: packets x relays
  with best/last SNR and RSSI per cell, copies, a decrypted preview when the
  packet became a message, and a per-relay summary (receptions, packets, best
  and average SNR, last seen). Relay hashes resolve to a contact only on a
  unique full-key match; a collision shows the raw hash with a "?" marker.
- Mesh Health gains a "Relay reception" tab (window-scoped like Adverts and
  Requests): stat tiles, the pivot table (up to 8 relay columns, extra relays
  folded), and the sortable relay summary. i18n EN/NL/DE. Decisions: new
  table (Q1), floods and transport floods only (Q2/Q3), 48 h default (Q4).

## Update 2026-09-25 (Analyzer name resolution for unnamed contacts, plan 16 case (a), feat/analyzer-name-resolution)

### Contacts: resolve a name for a full public key without one (backend, frontend)
- A contact RTFM-EV knows only by its full public key (an unknown sender, a
  key pasted into a DM) can now get its name from an analyzer: the contact
  info pane gains "Resolve name from analyzer", Settings > Radio-App
  Management gains "Resolve unnamed contacts" (newest first, up to 100).
  Order: the locally synced external map directory (no network), then the
  new `analyzer_resolved_names` cache (migration `_117`; a found name is
  reused for 7 days, a miss for 1 day), then the analyzer sites that opted
  in. A found name is applied only when the contact has none, goes through
  the normal name-history/reconcile path and is broadcast live. Endpoints
  `POST /api/contacts/{key}/resolve-name?force=` and
  `POST /api/contacts/resolve-names`.
- Per-site opt-in: `AnalyzerSite` gains `node_api_url_template` (a JSON
  node endpoint with `{pubkey}`, e.g. cornmeister's
  `/api/nodes/{pubkey}/detail`, now part of the Cornmeister preset) and
  `resolution_enabled` (default off; cannot be on without a template). The
  Handy Info Configure tab shows a "Name resolution" checkbox on an applied
  analyzer that has such a template; enabling it asks for confirmation and
  states what is sent (the one public key per lookup). Handy Info entries
  (built-in overrides and custom analyzers) carry the API template too.
  Case (b) (asking an analyzer about short hop hashes) is not built.
  New i18n keys (EN/NL/DE) for the button, toasts, settings field and
  confirmation.

## Update 2026-09-25 (Owned sidebar section, plan 17 Phase 3, feat/sidebar-owned-section)

### Sidebar: "Owned" section for the nodes your radio owns (frontend)
- New `owned` sidebar section listing the contacts whose owner key (the
  "Owner key" field in the contact info pane, `contacts.owner_key`, PR #104)
  equals the connected radio's own public key (case-insensitive), grouped by
  type (companions, sensors, repeaters, room servers) like the Contacts "All"
  view. The section only renders when at least one such contact exists; it
  takes part in the Customize panel like the built-in sections (reorder, hide,
  collapse; `owned` is appended to an already stored section order), shows the
  usual unread/new counters and the per-section clear button. Rows keep the
  Contacts sort orders. Owner source decision: the radio's own key (App passes
  `config.public_key` as `ownPublicKey`); no migration.
- `POST /api/contacts/{key}/annotations` now also accepts the connected radio's
  own public key as `owner_key` (it is not a contact row, so it was rejected
  with 422 before); the contact info pane's Owner field gains a "Use my
  radio's key" button and shows "Your radio" for that value. New i18n keys
  `nav_owned_heading`, `contact_owner_own_radio`,
  `contact_owner_use_own_radio`, `contact_owner_use_own_radio_hint` (and the
  reworded `contact_owner_unknown`) in EN/NL/DE.


## Update 2026-09-25 (GRP_DATA placeholder rows kept out of fanout, feat/grp-data-fanout-suppress)

### Fanout: channel data placeholders are not forwarded unless opted in (backend, frontend)
- The "Image (not supported)" / "Data (not supported)" placeholder rows stored
  for meshcore-open channel data (`GRP_DATA`) packets (PR #214) were broadcast
  to fanout like any channel message, so bots, private/HA MQTT, webhooks,
  Apprise and SQS received rows that carry chunk metadata rather than a
  message. `FanoutManager` now drops messages with `txt_type` 0x40 unless the
  integration's scope carries `"data_placeholders": "all"`; the message
  filter still applies on top. New scope key validated by `_enforce_scope`
  (`'all'` | `'none'`, missing = `'none'`) for webhook, Apprise, HA MQTT,
  private MQTT and SQS, exposed as a "Forward channel data placeholders"
  checkbox in the scope editor (EN/NL/DE). Bots, community MQTT and the map
  upload keep their fixed scope and never receive them. WebSocket clients
  (the chat view) and web push are unchanged.


## Update 2026-09-25 (Backend test flake: tile cache concurrent fetch, fix/tile-cache-test-flake)

### Tests: deterministic `test_concurrent_requests_share_one_fetch` (backend)
- `tests/test_tile_cache.py::TestCacheLookup::test_concurrent_requests_share_one_fetch`
  could fail under xdist with `assert 2 == 1`. `TileCache.get` reads the cache
  directory through `asyncio.to_thread` before it registers the shared
  in-flight refresh; the test released its gate after one `asyncio.sleep(0)`,
  so on a busy thread pool a caller's miss result could be delivered only
  after another caller's refresh had completed and stored the tile, and that
  caller fetched again (mechanism reproduced with a scratch test that delays
  the miss result). The test now runs the thread hops inline via
  `monkeypatch` so every caller reaches the shared task within one loop
  iteration. Code unchanged: the extra upstream fetch in that window is
  redundant, not incorrect. The three other flakes reported for the same suite
  (`test_retention_repository::test_stats_covers_every_class`,
  `test_advert_events::TestLatestRawAdverts::test_returns_raw_packet_for_latest_transmission`,
  `test_radio_sync::TestSyncAndOffloadAll::test_add_contact_decodes_legacy_packed_path_len`)
  did not reproduce at `b9a4a1b0` (ten clean full runs, an eight-round loop of
  the affected files, and a 218-file order-dependency search); left as is.

## Update 2026-09-25 (Noise-floor overlay on the My Node RSSI chart, plan 21 S4, feat/mynode-noise-floor-overlay)

### My Node: noise floor laid over the RSSI chart (frontend)
- The RSSI card now draws the radio's polled noise floor (the existing
  `noise_floor_samples`, one reading a minute, carried forward per bin) as a
  dashed line on the same dBm axis, and shades an estimated noise floor
  (mean RSSI minus mean SNR per bin) from the chart floor up, so the unshaded
  gap below the RSSI line is the SNR margin. The y-axis widens to include
  both. Hovering a bin adds `NF` / `est. NF` values to the tooltip; a legend
  line under the chart explains the two marks. The separate Noise Floor card
  and the SNR card are unchanged. Plan [21] S4 wording says "on the SNR chart";
  the overlay lives on the RSSI chart because that is the only dBm axis
  (the polled floor and `RSSI - SNR` are dBm, SNR is dB). Sample rate stays
  60 s (plan [21] Q5 default). `LineChart` gains optional `overlay` / `band`
  props; helpers `noiseFloorPerBin` / `estimatedNoiseFloorPerBin` in
  `MyNodeView.tsx`. New i18n keys `node_tooltip_noise_est`,
  `node_chart_rssi_noise_legend` in EN/NL/DE.

## Update 2026-09-25 (Inline contact sharing, parity audit L4 / upstream #347, feat/inline-contact-share)

### Chat: inline `<pubkey:type:Name>` contact sharing (frontend)
- A message containing the official app's share form
  `<64-hex pubkey:type:Name>` (type 1 client, 2 repeater, 3 room, 4 sensor)
  now renders as a contact chip instead of raw text: name, type and short key
  with an **Add contact** button for an unknown key (adds the contact with the
  shared name and type through the existing create-contact flow; a local
  radio command, nothing is transmitted), or a button that opens the contact
  when you already have it. The tag is always parsed (it is an explicit form,
  not a heuristic) and takes precedence over the bare public-key scanner.
- **Copy share tag** next to the `meshcore://` link in contact info and under
  your own key in Settings > Radio copies the tag to paste into a message.
- Parity audit L4: inline contact sharing done; auto contact discovery
  confirmation still open. New i18n keys `chat_contact_share_*`,
  `contact_share_tag_*` in EN/NL/DE.
## Update 2026-09-25 (Triangulation link-out, plan 13 last item, feat/map-triangulate-link)

### Map + contact info: triangulate a node on the DMC triangulator (frontend)
- The last open item of plan [13] (map overhaul) ships as the plan's
  recommended option (a), a deep link: **Triangulate** in the map node popup
  and **Triangulate on triangulator.dutchmeshcore.nl** in the contact info
  identity section open `https://triangulator.dutchmeshcore.nl/?prefixes=<first
  6 hex of the key>` in a new tab. That is the triangulator's own share-link
  form (2/4/6-hex path-hash prefixes); it pre-fills the query and runs
  discovery against the public mc-radar / map.meshcore.io feeds itself, so
  RTFM-EV sends nothing but the prefix. Prefix-only contacts get their whole
  bytes; keys shorter than one byte get no link. New i18n keys
  `contact_triangulate_label`, `contact_triangulate_title`,
  `map_triangulate_link` in EN/NL/DE.

## Update 2026-09-25 (GRP_DATA image placeholder, plan 28 item 1.17, feat/group-data-placeholder)

### Channel datagrams (GRP_DATA) shown as a placeholder (backend + frontend)
- `PayloadType.GROUP_DATA` (0x06) packets, which meshcore-open uses for its
  chunked image transport (`CMD_SEND_CHANNEL_DATA`, data type `0xAE1C`, up to 15
  chunks plus an XOR parity chunk), are now decrypted with the channel key next
  to `GROUP_TEXT` (`app/decoder.py`: `decrypt_group_data`,
  `try_decrypt_group_data_with_channel_key`; plaintext `data_type(u16 LE) |
  data_len(u8) | blob` as in firmware `BaseChatMesh::onGroupDataRecv`). Before
  this the type was defined but never processed, so the packets only appeared
  as undecrypted raw packets.
- A decrypted datagram is stored as one placeholder channel message with
  `txt_type = 0x40` (`TXT_TYPE_GROUP_DATA`; firmware text types are 0..3), text
  `<Sender>: [image] id=<hex> chunks=<n>` for image chunks (sender = unique
  contact match on the 2-byte key prefix carried in every chunk, else the
  prefix in hex) or `[data] type=0x<type> len=<n> sha=<8 hex>` for any other
  data type. The text omits the chunk index, so all chunks and repeats of one
  image land on one row and each arrival becomes a path (hop badge). The raw
  packet is linked to the row like a decrypted text message.
- The blob is neither stored nor decoded: decoding needs meshcore-open's
  neural image codec (about 2 GiB of model files), which is out of scope.
- The chat renders these rows as an "Image (not supported)" / "Data (not
  supported)" pill (`MessageList.tsx`, hover for id, chunk count or data type
  and length) instead of the marker text. New i18n keys
  `chat_group_data_image_placeholder`, `chat_group_data_image_detail`,
  `chat_group_data_placeholder`, `chat_group_data_detail` in EN/NL/DE.
- Known limitation: a sender that reuses an image id on the same channel later
  merges into the earlier placeholder (meshcore-open itself only keeps a partial
  image for 60 s).

## Update 2026-09-25 (Radio default flood scope, parity audit L1, feat/radio-default-flood-scope)

### Settings > Radio: default scope on the radio (backend + frontend)
- New `GET /api/radio/default-flood-scope` reads the radio's own configured
  default region with the companion `CMD_GET_DEFAULT_FLOOD_SCOPE` (64):
  `{supported, scope_name, scope_key}`; `supported=false` on firmware without
  the command, `scope_name=null` when no default is set. Local command,
  nothing transmitted.
- Settings > Radio shows it read-only under "Flood Scope / Region" ("Default
  scope on the radio: ..."), with a Refresh button and a hint when it differs
  from RTFM-EV's outbound scope (RTFM-EV applies its own scope per send with
  `CMD_SET_FLOOD_SCOPE`; on firmware older than v12 an empty outbound scope
  falls back to the radio default). Closes the companion-reachable part of
  parity audit L1; other repeaters' live region-gate state stays DMC-MQTT-only.
  New i18n keys `settings_radio_default_scope_*` in EN/NL/DE.

## Update 2026-09-25 (MQTT config topic, parity audit L3, feat/mqtt-config-topic)

### Community MQTT: node config topic (backend + frontend)
- New opt-in toggle **Publish node config** on Community MQTT integrations
  (`publish_config`, default off, like the DMC firmware's `set mqtt.config 1`).
  When on, RTFM-EV publishes a retained `meshcore/{IATA}/{PUBKEY}/config`
  message right after `status` on connect and on the status cadence: the
  counterpart of the DMC observer firmware `config` topic
  (`MQTTMessageBuilder::buildConfigMessage`) for the sections a
  companion-driven host can fill: identity and firmware, `radio`
  (freq/bw/sf/cr/tx power/multi-acks), `repeat` (host repeater forwarding
  limits, `disable_fwd` while not armed), `region_gate`, `region` (home,
  default outbound scope, wildcard flood, the host repeater's scope tree as
  `{name, flood, parent}`), `host_repeater.state` and the `mqtt` toggles.
  Firmware-only sections (bridge, gps, power, room, timezone, alert, snmp)
  are omitted; broker address, credentials and keys are never included.
  Closes the last open item of parity audit L3. New i18n keys
  `settings_fanout_publish_config`, `settings_fanout_publish_config_desc`
  in EN/NL/DE.

## Update 2026-09-25 (Receive-error graph, parity audit L2, feat/rx-error-graph)

### My Node: receive errors chart (backend + frontend)
- The 60 s radio stats sampler now also persists the radio's cumulative RX
  error counter (`recv_errors` from the companion `STATS_PACKETS` frame,
  firmware v1.12+; NULL on the legacy 26-byte frame) in `airtime_history`
  (migration `_116`, `AirtimeHistoryRepository.insert(..., recv_errors)`).
- `GET /api/statistics/airtime/range` bins gain `rx_errors`: the sum of the
  counter deltas of the sample pairs in each bin, with the same counter-reset
  and disconnect-gap rules as the airtime deltas; `null` when no pair had the
  counter (older firmware, or the OpenHop airtime source, which has no error
  counter).
- My Node shows a **Receive errors** card (bar chart, same time range and zoom
  as the airtime chart, total in the window as the stat) whenever the window
  has at least one bin with the counter. Closes the last open item of parity
  audit L2 (telemetry graph parity). New i18n keys `node_chart_rx_errors_*`
  in EN/NL/DE.

## Update 2026-09-25 (Scored path history, plan 28 item 1.15, feat/scored-path-history)

### Contact info: message routes (scored) (backend + frontend)
- **Contact info > Network** now lists the routes your direct messages to that
  contact were sent on (the firmware's learned direct path, or flood), ranked
  the way meshcore-open ranks its path history: `0.45 x delivery rate
  ((successes + 1) / (attempts + 2)) + 0.25 x trip time (fastest / this, 0.6 when
  unknown) + 0.1 x freshness (1 / (1 + days since the last success)) + 0.2 x
  route weight (+0.5 per success, -0.5 per failure, 0.1-5)`. Each row shows the
  hops, the score, delivered/attempts, the last send-to-ACK time and when it was
  last used. **Display only**: DM routing stays firmware direct path, then flood.
- Every DM attempt (first send and background retries) records the route the
  radio's contact record held at that moment (`app/services/dm_path_outcomes.py`);
  the ACK credits the last attempt with its trip time, and a DM that runs out of
  retries counts one failure per distinct route. Stored per
  `(contact, path, hop count)` in `contact_path_outcomes` (migration `_115`,
  `ContactPathOutcomeRepository`, newest 100 routes per contact, rows follow the
  contact on delete). Scoring is `app/services/path_scoring.py`;
  `GET /api/contacts/analytics` gains `path_scores`.
- Not ported from meshcore-open: choosing retry paths from the ranking, the
  flood-ACK path attribution, and deleting a route after three failures at
  weight 0 (RTFM-EV keeps the row so the history stays visible).
- New i18n keys `contact_path_scores`, `contact_path_scores_hint`,
  `contact_path_score_flood`, `contact_path_score_detail` in EN/NL/DE.

## Update 2026-09-25 (Host repeater Phase 4: score-based delays, advert limiter, lifetime stats, feat/host-repeater-phase4)

### Host repeater (backend + frontend, plan 29 Phase 4)
- **Score-based receive delay** (the repeater's `rxdelay`, off by default). With
  **Score-based receive delay** set in Settings > Host repeater > Timing, a weakly
  received flood is held for `(base ^ (0.85 - score) - 1) x airtime` before it is
  judged (delays under 50 ms are skipped, cap 32 s), so a copy relayed by a
  neighbour with better reception is judged first and the held copy is dropped as
  a duplicate, the way the firmware's delayed inbound queue works. The score is
  the firmware's `packetScoreInt` (SNR above the spreading factor's floor, scaled
  by frame length). New engine functions `packet_score` / `rx_delay_ms`; the
  runtime holds the frame in a task (`HostRepeaterRuntime._hold`) and drops held
  frames at shutdown (`host_repeater.stop()`). Statistics show the hold
  percentiles, how many frames were held, how many a neighbour relayed first and
  how many are still waiting; recent decisions carry `rx_delay_ms` and `score`.
- **Shorter retransmit delay for strong receptions** (OpenHop `use_score_for_tx`,
  off by default): the random delay is scaled by `1 - score`, never below 20 %,
  once it is 50 ms or more.
- **Advert limiter (per node)**, off by default: an OpenHop-style token bucket per
  advertising public key (`advert_bucket_capacity`, `advert_refill_tokens` every
  `advert_refill_interval_seconds`, `advert_min_interval_seconds` between two
  adverts of the same node), checked after every other rule for flood adverts.
  New drop reason `advert_rate`; statistics show allowed / dropped / nodes tracked.
  OpenHop's penalty box and adaptive tiers are not ported.
- **Lifetime totals survive restarts.** Observed / would-forward / would-drop,
  reasons, types, policy matches, forward airtime and the receive-hold counters
  now also accumulate in `host_repeater_stats` (migration `_114`,
  `HostRepeaterStatsRepository`), written from the RX path at most once a minute,
  at shutdown and on reset. `GET /api/radio/host-repeater/stats` gains
  `lifetime` (with `since`, `runs`, `persisted`), `rx_delay` and
  `advert_limiter`; `POST .../stats/reset?lifetime=true` starts the totals over.
  The statistics pane shows a **Lifetime totals** block with its own reset; the
  session counters still reset on restart.
- Settings document: new fields `rx_delay_base`, `use_score_for_tx`,
  `advert_limiter_enabled`, `advert_bucket_capacity`, `advert_refill_tokens`,
  `advert_refill_interval_seconds`, `advert_min_interval_seconds` (all defaults
  keep today's behaviour). New i18n keys `settings_host_repeater_rx_delay_*`,
  `..._use_score_for_tx*`, `..._advert_*`, `..._stats_rx_delay*`,
  `..._stats_advert_limiter`, `..._stats_lifetime_*`, `..._stats_reset_lifetime`,
  `..._reason_advert_rate` in EN/NL/DE.
- Nothing in this change transmits; armed mode is unchanged apart from the delay
  it is handed.

## Update 2026-09-25 (Host repeater armed mode: live forwarding, plan 29 Phase 3, feat/host-repeater-armed)

The host repeater can now forward for real. Shadow mode (PR #207) is unchanged;
**armed mode** adds the sender and everything that keeps it safe. It is off by
default at three levels and always comes up disarmed after a server restart.

### Radio (backend)
- **Sender** `app/services/host_repeater_tx.py`, the only host repeater module
  that may touch the radio (the engine and the shadow runtime keep their
  no-radio import boundary, still enforced by a test). While armed, every
  "would forward" decision becomes a job held on the host until its random
  retransmit delay has passed, then sent with `CMD_SEND_RAW_PACKET` at the
  MeshCore priority (direct 0, TRACE 5, floods = new hop count). Forwards take
  the radio lock non-blocking and retry every 25 ms until their latency
  deadline (`max_forward_latency_ms` after the delay), so our own messaging
  always wins. Queue cap (`max_pending_forwards`, default 20, oldest dropped)
  and in-flight cap (`max_in_flight`, default 2, assumed transmitted after the
  modelled airtime plus 100 ms) keep the firmware's 16-slot packet pool free.
- **Arming preconditions**, all required: `MESHCORE_HOST_REPEATER_ENABLED`
  (env), the admin switch, radio connected with a known identity, firmware
  raw send (companion ver code >= 13), firmware client repeat off, not
  OpenHop, a known EU sub-band whose duty-cycle limit is at least
  `arm_min_sub_band_percent` (default 1 %, so the 0.1 % bands are refused),
  and `confirm: true` from the operator.
- **Automatic disarm** (state and reason broadcast to every browser): radio
  disconnect (opt-in re-arm after reconnect via the existing setting),
  firmware client repeat found on, radio identity change, frequency or
  modulation change, five `TABLE_FULL` errors in a row or more than 20 % send
  errors over the last 50, the radio's measured TX airtime over the last hour
  above the sub-band limit (from the 60 s stats sampler: the firmware counter
  is the truth, not the model), a full queue for more than 60 s, and shutdown.
- **API**: `POST /radio/host-repeater/mode {mode: off|shadow|armed, confirm}`
  (armed answers 409 `{message, blockers}` on a failed precondition, 400
  without `confirm`; off/shadow leave armed mode without touching the saved
  settings), `POST /radio/host-repeater/disarm` (kill switch). `GET` now
  reports `state` `armed`, `armed_since`, `disarm_reason`, `rearm_pending` and
  the real `arm_blockers` list (`not_available_yet` is gone). Saving the
  settings with the admin switch off while armed disarms. Stats gain a `tx`
  block (sent, airtime, errors, table-full, queued, in flight, drops by cause,
  last error). The WS `host_repeater` event carries the same live fields.
- New settings `arm_min_sub_band_percent`, `max_pending_forwards`,
  `max_in_flight`; documents saved before this change load with the defaults.
  No migration.

### Settings (frontend)
- **Settings > Host repeater**: an "Armed (live)" state pill, an arm panel that
  is hidden entirely while the env switch is off, an **Arm live repeating...**
  button (disabled with the blocker list while any precondition fails, or
  while there are unsaved edits) that opens an inline confirmation (frequency
  and sub-band limit, airtime budget, what stops it, firmware repeat must stay
  off, the off-grid restriction of stock firmware) with an "I understand"
  checkbox, and a red **Disarm (kill switch)** banner while armed. The reason
  for the last automatic disarm is shown. The statistics pane adds the live
  forward counters. Three new fields in Timing. A **Repeating** badge in the
  top bar in every browser while armed (`useHostRepeaterArmed`, from the
  initial state plus the WS event). EN/NL/DE.
- `ApiError` keeps the structured FastAPI `detail` so the 409 blocker list can
  be shown.

## Update 2026-09-25 (Database restore + scheduled backups, feat/backup-restore)

### Backup and restore (backend + frontend)
- **Restore a backup from Settings > Database.** Upload a `.db` file
  (**Restore from file...**) or pick one under **Backups on the server** (the
  server-side backup directory). The server validates it (SQLite header,
  `PRAGMA quick_check`, the RemoteTerm tables, schema not newer than the running
  build) and stages it as `meshcore.db.restore-pending`. The live database is not
  touched until the next server start. At that start, before the database opens,
  the current database is saved as `meshcore-pre-restore-<stamp>.db` next to it,
  the old `-wal`/`-shm` are removed, the staged file is swapped in, and the normal
  migrations upgrade it. A staged restore can be cancelled. Settings shows the
  outcome and where the previous database went. If the staged file fails its
  checks at startup, the current database is kept and the file is moved aside as
  `.restore-failed`. New `app/services/db_restore.py`; new routes
  `GET /api/backup/files`, `GET|DELETE /api/backup/restore`,
  `POST /api/backup/restore/upload`, `POST /api/backup/restore/server`,
  `DELETE /api/backup/restore/result`.
- **Scheduled backups.** With the server path enabled, **Back up automatically**
  writes `meshcore-auto-<stamp>.db` every N hours (default 24, 1-720) and keeps the
  newest N (default 7, 1-365). Rotation only deletes `meshcore-auto-*` files.
  Checked every 5 minutes; "last run" comes from the newest automatic file name,
  so restarts do not add extra snapshots. New `app/services/backup_scheduler.py`
  and `app/services/backup_store.py` (directory checks, listing, naming,
  rotation; `POST /api/backup/save` now uses the same directory checks). New
  settings `backup_schedule_enabled`, `backup_schedule_interval_hours`,
  `backup_schedule_keep` (migration `_113`).
- **UI:** new `SettingsBackupRestore` panel inside the Settings > Database backup
  block; the server list refreshes after **Back up to server now**. New i18n keys
  `settings_db_schedule_*` and `settings_db_restore_*` in EN/NL/DE.
- Closes the remaining gaps of plan [22] (restore flow, scheduled backups).
  Network-protocol (SMB/NFS/SFTP) clients are still out of scope; a mounted share
  works as the backup directory.

## Update 2026-09-24 (Channel Registry date fields: text padding, fix/channel-registry-date-field-padding)

### Channel Registry (frontend)
- **Fix: "Last heard" and "Added" date text sat flush against the left border**
  of the edit form's date fields, and could run under the calendar button.
  The fields are `DateTimeField`s, which take their padding from the caller,
  and the registry form passed only the height/font classes it uses for its
  `Input`s (those get padding from the `Input` component itself). The two
  date fields now get the same horizontal padding as the other inputs plus
  room for the calendar button. Reported by a tester; the calendar picker
  itself was already working. No behaviour change.

## Update 2026-09-24 (Host repeater, shadow mode only, plan 29 Phases 1-2 + DMC region gating, feat/host-repeater-shadow-v2)

RTFM-EV itself can now judge every received packet the way a repeater would
(firmware client repeat stays off). This version only has **shadow mode**: it
counts what it would forward and never transmits. Live forwarding (plan 29
Phase 3) is not built.

### Radio (backend)
- **Forwarding engine** (`app/services/host_repeater_engine.py`, pure, no radio
  imports): MeshCore `Mesh.cpp` forwarding rules (flood hash append at the
  packet's own hash size, direct next-hop strip, routed ACK regeneration,
  multipart ACK, TRACE SNR append, zero-hop CONTROL, types never flood-forwarded,
  seen table, packets for us), the repeater firmware gates (`flood.max`,
  `flood.max.unscoped`, `flood.max.advert`, region map, loop detect),
  the DMC `dmc-dev` RF packet filter (hops, rate with soft cutoff, minimum hash
  size, channel blocklist, malformed Public scan, ACL bypass mapped to
  contacts or favourites) and OpenHop policy rules (evaluated first, drop /
  allow / log_only, groups). TX priority follows MeshCore (direct 0, TRACE 5,
  floods the new hop count). Delay factors, 5 s delay cap and the 60 s
  duty-cycle window with 3600 ms per minute follow OpenHop. LoRa airtime uses the
  RadioLib time-on-air formula with MeshCore's 16-symbol preamble.
- **Region map** (firmware `RegionMap` parity): up to 32 regions with a parent,
  a flood deny flag and one home region. Like the repeater firmware, a
  region-scoped flood is only forwarded when its transport code matches a listed
  region that is not denied; unlisted regions are never forwarded. The engine
  matches codes against its own list, not the app's `known_regions`. Settings
  saved before this change (`region_rules`) are converted on load.
- **DMC duty-cycle region gating** (`dc.gate`, DMC `dmc-dev` `MyMesh::loop`,
  `RegionMap::applyDutyGate`): opt-in, threshold 70 and hysteresis 10 by default.
  The reading is the share of the airtime budget in use (1 hour times the
  sub-band duty cycle, refilled at that rate; 360 s at 10 %), as confirmed by the
  DMC developer. Every 10 s one more layer closes (`*` first, then the broadest
  regions; the deepest layer and the home region stay open) or re-opens with up
  to 30 s of jitter. Would-forward airtime and the radio's own TX (from the
  60 s `tx_air_secs` sample) use the same budget. New drop reason `region_gated`;
  gate level, budget use and closed regions in the shadow stats.
- **Shadow runtime** (`app/services/host_repeater.py`): fed from
  `on_rx_log_data` after the packet processor; host-side MAC checks decide
  "for us" / "our own" like the firmware's decrypt. Statistics (in memory):
  decisions by reason and type, host latency and delay percentiles, would-forward
  airtime per minute / hour vs the EU sub-band limit (DMC ETSI table), echo gap
  to the first neighbour relay, hidden-frame estimate and RX airtime model
  calibration from the 60 s radio stats sampler, recent decisions.
- **API** `GET /api/radio/host-repeater`, `PUT /api/radio/host-repeater/settings`
  (versioned; 409 on a stale version), `POST .../validate`, `GET .../stats`,
  `POST .../stats/reset`. New WS event `host_repeater` on every settings change.
- **Migration `_112`**: `host_repeater_config` (one versioned JSON settings row).
- **Server switch (env half)** `MESHCORE_HOST_REPEATER_ENABLED`, default off;
  arming will need it plus the admin switch. Neither transmits in this version.
- OpenHop radios: the host repeater is disabled (OpenHop repeats itself); the
  API refuses to enable shadow mode and the runtime skips OpenHop frames.

### Settings (frontend)
- **Settings > Host repeater** (its own settings section, directly after Radio):
  state, frequency and sub-band limit, switches (shadow, admin, re-arm), timing,
  airtime budget, repeater rules, a region map editor (parent, flood allow/deny,
  home region; an empty list is pre-filled with the radio's flood scopes, the
  default scope plus channel overrides; "Import from a repeater" reuses
  `POST /api/contacts/{key}/repeater/regions` after a confirm, because it
  transmits), region gating controls, DMC filter table and channel blocklist, OpenHop-style policy
  rules (reuses the OpenHop rule editor with the host's field list), and a
  shadow statistics pane (polled every 5 s). Other browsers follow a saved change
  live; with local edits they show a reload notice and a stale save reloads after
  the 409. Shown disabled on OpenHop radios. EN/NL/DE.

## Update 2026-09-24 (Room server alpha notice removed)

### Rooms (frontend)
- **Removed the "experimental, public alpha" warning** shown above the room
  server login form, along with its `room_experimental_notice_*` i18n keys
  (EN/NL/DE). Room server login and behaviour are unchanged.

## Update 2026-09-23 (Region discovery moved to Mesh Discovery, feat/discover-regions-mesh-discovery)

### Tools (frontend)
- **Discover Regions moved from Settings > Radio to Tools > Mesh Discovery**,
  below the sweep buttons and results. It still prefers repeaters from the
  last mesh sweep, now shown on the same page. "Add to Known Regions" now
  merges the discovered regions into `known_regions` and saves them
  immediately (reusing the repeater Regions pane's seed path), since there
  is no unsaved Known Regions field on that page to review first. The Known
  Regions field, Dutch-scope seed and analyzer region sync stay in Settings >
  Radio. No backend change.

## Update 2026-09-23 (Local message delete, plan 28 item 1.7, feat/local-message-delete)

### Messages (backend)
- **`DELETE /api/messages/{id}`**: hard-deletes the message row and its linked
  raw packet in one transaction (mirroring the retention pruner's message
  prune), so historical decryption cannot recreate it, and also deletes any
  stored reaction that resolves to that message. Local only - nothing is
  sent over RF. If the message is an outgoing DM whose background retry loop
  is still in flight (`app/services/message_send.py`), the retry is stopped
  instead of sending again for a message that no longer exists. Broadcasts a
  new `message_deleted` WS event per deleted row. New
  `MessageRepository.delete_with_raw_packets` and deleted-message tracking in
  `app/services/dm_ack_tracker.py`. No migration.

### Chat (frontend)
- **Delete action.** Hovering a message row now shows a Delete action next
  to React/Reply. Unlike React/Reply it is available on every message
  (including reactions and messages with no sender timestamp), and asks for
  confirmation first since deletion is irreversible. Removes the message
  from the active conversation and any cached one; other open tabs update
  over the `message_deleted` WS event, and unread counts are re-fetched so
  they stay correct.
## Update 2026-09-23 (DM failed state + manual retry, plan 28 item 1.1, feat/dm-failed-retry)

### Chat (frontend)
- **Failed DMs.** An outgoing DM that got no ACK after all background retries
  now shows a red "Failed" marker instead of a `?` that never goes away. A
  late ACK (see below) turns it into a normal delivered tick.
- **Retry.** A failed DM gets a Retry row action (next to React/Reply). It
  sends the text again as a new message (new timestamp, new ACK code, the
  usual retries) and the new bubble replaces the failed one, like
  meshcore-open's resend. Retry transmits over RF. If the new send fails (for
  example no radio), the failed bubble stays and an error toast shows.

### Messages (backend)
- **Failed marker.** New nullable `messages.failed_at` (migration `_109`;
  `_108` is reserved by another branch, numbering is reconciled at merge).
  After the last retry attempt the backend waits one more ACK window, then
  sets `failed_at` (only on an outgoing row with no ACK) and broadcasts the
  new WS event `message_failed` (`{message_id, failed_at}`). The `Message`
  payload carries `failed_at`.
- **Late ACK.** For 30 s after a DM is marked failed, every ACK code it was
  sent with still matches (meshcore-open behaviour): the ACK counts, clears
  `failed_at` and broadcasts `message_acked`. An ACK later than that is
  treated as unmatched and the DM stays failed.
- **`POST /api/messages/direct/{message_id}/resend`.** Only for an outgoing
  DM marked failed with no ACK (409 otherwise, 400 for channel or incoming
  messages). Sends a new copy through the normal DM send path, then deletes
  the failed row and broadcasts the new WS event `message_deleted`
  (`{message_id, type, conversation_key}`). The failed row is kept when the
  new send fails. No new in-flight limit: a retry is one ordinary DM send.
- DMs whose first send returns no expected ACK code (no retries are
  scheduled) are not marked failed; they keep showing `?`.
## Update 2026-09-23 (Battery chemistry, feat/battery-chemistry, plan 28 item 1.9)

### Battery display (frontend)
- **Battery chemistry setting.** `frontend/src/utils/batteryDisplay.ts`
  `mvToPercent` now supports four chemistries: LiPo keeps the existing real
  discharge curve (Meshtastic OCV table); LiFePO4, LiPo HV and NMC use
  meshcore-open's linear min-max mV ranges (`utils/battery_utils.dart`,
  github.com/zjs81/meshcore-open, fetched and verified 2026-09-23:
  2600-3650 / 3000-4350 / 3000-4200 mV) since no cited real discharge curve
  was found for them. A global default lives in Settings > Local
  Configuration > "Battery Chemistry" (server-side, `app_settings.
  battery_chemistry`, so it is consistent across browsers rather than a
  per-browser local preference like most settings on that page). Each
  contact can override it in its contact info ("Battery chemistry", null =
  use the global default). All three callers (status bar, My Node, and the
  telemetry map layer) go through `mvToPercent`; the map layer resolves the
  node's own override, the other two (this radio, no per-node concept) use
  the global default.

### Backend
- New `app_settings.battery_chemistry` (`TEXT NOT NULL DEFAULT 'lipo'`) and
  `contacts.battery_chemistry` (nullable `TEXT`, NULL = use the global
  default, same convention as `telemetry_perms`) columns, migration `_108`.
  `POST /contacts/{public_key}/annotations` accepts `battery_chemistry`
  alongside the existing annotation fields (422 on an unrecognized value).
## Update 2026-09-23 (Radio settings no longer reset client repeat, fix/radio-save-keeps-repeat, plan 29 Phase 0)

### Radio (backend)
- **Fix: saving Radio settings silently turned off client repeat.** `set_radio`
  was always called without its optional repeat byte. Stock companion
  firmware (fw ver 9+) treats a missing byte as 0 and always persists it, so
  every Radio settings save turned off the off-grid "client repeat" mode,
  even when another app had enabled it. RTFM-EV never enables client repeat
  itself, but it must not fight another app's setting.
- On connect (fw ver >= 9), RTFM-EV now reads the device's current client
  repeat state and its allowed repeat frequencies (`get_allowed_repeat_freq`,
  cached per connect) alongside the existing device-info query. Every
  `PATCH /radio/config` radio-settings save now passes the current on-device
  repeat value back to `set_radio` explicitly, then re-queries device info to
  confirm what the firmware actually persisted. Firmware below version 9 is
  unaffected (no repeat byte is sent, as before).
- If client repeat is currently on and the requested frequency is not one the
  firmware allows for repeat, the save is rejected with `409` instead of
  either silently turning repeat off or getting a generic firmware error.
- `GET /radio/config` now includes read-only `client_repeat_enabled` (`null`
  when the firmware does not report support) and `client_repeat_allowed_freqs`
  (kHz ranges, `null` if not queried), for this check and for a future
  gated repeat toggle. No UI is added to enable repeat, and no code path
  reachable from the UI sends `repeat=1`.
## Update 2026-09-23 (Repeater LPP telemetry tracking, fix/repeater-lpp-telemetry-tracking)

### Telemetry (backend + frontend)
- **"Track Telemetry on Interval" works for repeaters.** On a repeater's
  contact info page the LPP telemetry section's tracking button failed with
  "Failed to update tracked contact telemetry", because the contact tracking
  endpoint rejected repeaters with a 400. The endpoint now accepts any contact
  type. This LPP list is separate from the repeater status list (Telemetry
  History in the repeater dashboard), so a repeater on both lists is polled
  once for status and once for LPP per cycle, and counts toward both caps and
  the shared daily ceiling.
- **Telemetry tracking errors show the server's reason.** Failed tracking
  toggles now show the server's message (for example "Limit of 8 tracked
  contacts reached") instead of a generic toast. `fetchJson` now uses
  `detail.message` for structured error details instead of "[object Object]".

### Home Assistant (backend)
- **LPP-only repeater readings no longer blank the status sensors.** An LPP
  reading for an HA-tracked repeater (the manual Request button, or LPP
  interval tracking) sent `null` for battery, noise floor, packet counters and
  the other status fields, which set those HA sensors to unknown until the
  next status sample. Status fields missing from a snapshot are now left out
  of the state payload, so HA keeps the last values. HA may log a template
  warning per missing field.
## Update 2026-09-23 (Communities, feat/communities, plan 28 item 1.3)

### Channels (backend)
- **meshcore-open communities.** New `app/communities.py` ports
  meshcore-open's `models/community.dart`: from a community's 32-byte secret
  it derives the public channel key (`HMAC-SHA256(K, "channel:v1:__public__")`,
  first 16 bytes), community hashtag keys (`"channel:v1:" + tag`, tag
  normalized as in meshcore-open) and the community ID. New endpoints under
  `/api/communities`: join from the QR JSON
  (`{"v":1,"type":"meshcore_community","name":...,"k":...}`), add a hashtag
  channel (`"<name> #<tag>"`), export, forget. Channels are created in the
  database only, like any other channel; nothing is transmitted. Plain
  `#hashtag` channels still use `sha256(name)`.
- **Community secret stored.** Migration `_110` adds a `communities` table
  that keeps the secret so hashtag channels can be added later. The secret is
  never logged, is not in the list endpoint, and is only returned by the
  export endpoint. It is included in database backups.

### Channels (frontend)
- **Communities tab** in Channels > Import / Export: join by pasting the
  JSON, scanning the QR code with a camera, or uploading a QR image; add
  community hashtag channels; export the community as JSON or a QR code (copy,
  JSON download, PNG download). The export is only fetched when you ask for
  it. New dependencies: `uqr` (QR rendering, no dependencies) and
  `zxing-wasm` (QR scanning; its WASM is bundled with the app and loaded only
  when you scan, so no CDN is contacted).
## Update 2026-09-23 (Contact groups, plan 28 item 1.16, feat/contact-groups)

### Sidebar (frontend)
- **User-defined contact/channel groups.** Create, rename and delete named
  groups from the sidebar's Customize panel; a group can hold any mix of
  contacts and channels, and an item can belong to several groups. Each group
  renders as its own collapsible sidebar section (unread counts, new-item
  badges, per-section "mark read" - same as the built-in sections) and slots
  into the existing section reorder/hide/collapse system (drag order, hidden
  overlay), so groups can be reordered alongside Tools/Favorites/Channels/
  Contacts and hidden without deleting them. Membership is edited from the
  contact info pane, the channel info pane, or the group's own checkbox list
  in those panes (which also offers "create a new group and add this item"
  inline). A grouped item drops out of its normal Channels/Contacts/Rooms/
  Repeaters section, the same way a favorite does - the group is its
  "leftover" section unless the item is also a favorite. Stored server-side
  in `app_settings.contact_groups` so all browsers agree; section order,
  hidden-entries and collapse state follow their existing storage (server for
  order/hidden, client-local for collapse). Local only - nothing about groups
  is sent over RF. Migration `_111` adds the `contact_groups` column.
- New pure helpers in `frontend/src/utils/sidebarLayout.ts` for group section
  keys and membership edits (`toggleGroupMember`, `createContactGroup`,
  `renameContactGroup`, `deleteContactGroup`, `groupsContainingContact/
  Channel`), covered directly in `frontend/src/test/sidebarLayout.test.ts`.
## Update 2026-09-23 (Mark unread, plan 28 item 1.6, feat/mark-unread)

### Chat (backend)
- **Mark unread from here.** New `POST /api/contacts/{public_key}/mark-unread`
  and `POST /api/channels/{key}/mark-unread` (`{message_id}`) set
  `last_read_at` to just before the given message's `received_at`, so that
  message and every incoming message after it count as unread again. Read
  state stays server-side and shared across browsers, same as mark-read. The
  message must be an incoming message in that conversation (400/404
  otherwise).

### Chat (frontend)
- **"Mark unread from here" message action.** A new envelope icon next to
  React/Reply on hover marks the conversation unread from that message
  onward. The sidebar badge, unread count and first-unread divider
  (`first_unread_ids`) reflect it on the next refresh, and it persists across
  reloads and other browsers, since it is server-side.
- **Fix: the manual unread mark no longer gets wiped while still viewing the
  conversation.** The app auto-marks the open conversation as read on every
  `/unreads` refresh (WS reconnect, mute toggle, etc.), which would otherwise
  immediately undo a "mark unread from here" done on the currently open
  conversation. That auto re-mark is now suppressed for the conversation just
  marked unread until the user actually leaves and returns to it (a real
  navigation), at which point it reads as normal again, same as any other
  unread conversation.
## Update 2026-09-23 (GIF URL forms, feat/gif-url-forms, plan 28 item 1.4)

### Chat and display (frontend)
- **Giphy URL forms for MeshCore Open GIFs.** A whole-message
  `media.giphy.com/media/<id>/giphy.gif` or `giphy.com/gifs/[title-]<id>` link
  (with or without `https://`) now renders as an inline GIF the same way
  `g:<id>` already does, matching the two extra forms meshcore-open's
  `GifHelper.parseGif` accepts besides its own picker's `g:<id>`. Gated by the
  same Settings > Local > "Render MeshCore Open GIFs & Reactions" toggle
  (off by default); with it off, the message renders as a plain link/URL
  preview as before. No picker, no Giphy API key and no send-side conversion
  (deferred; see plan 28 item 1.4).
## Update 2026-09-23 (GPS toggle on stock firmware, plan 28 item 1.10, feat/gps-toggle-stock-fw)

### Radio settings (backend + frontend)
- **`GET`/`PATCH /radio/gps`.** The GPS on/off toggle no longer requires
  meshcomod DMC/DMC-EV firmware: the `gps` custom var (read/written via the
  generic `CMD_GET_CUSTOM_VARS` / `CMD_SET_CUSTOM_VAR` commands) is part of
  the stock MeshCore companion firmware protocol too, gated at build time by
  `ENV_INCLUDE_GPS` and at runtime by physical GPS detection. Settings > Radio
  now shows a GPS section (enable + interval) for any connected radio that
  reports the var, whether or not it is meshcomod. Meshcomod radios keep
  their existing combined CAD/GPS control in the Meshcomod section unchanged;
  the new section stays hidden for them to avoid showing GPS twice.
- `app/services/meshcomod.py` GPS read/apply logic split into
  `read_gps_settings` / `apply_gps_update`, reused by both
  `GET`/`PATCH /radio/meshcomod` (unchanged behaviour) and the new
  `GET`/`PATCH /radio/gps` endpoints. No migration.
## Update 2026-09-23 (GPX export, feat/map-gpx-export, plan 28 item 1.8)

### Map (frontend)
- **GPX export.** A new Export FAB on the map (download icon) exports the
  nodes the map currently shows under its active filters (role, heard/never-
  heard, time window, hide-wrong-location, blocked) as a GPX 1.1 waypoint
  file, `rtfm-ev-nodes-<date>.gpx`. Each waypoint has the node's name, its
  effective position (advertised, or its manual override when the advertised
  one is missing or invalid, in which case the description notes "manual
  location"), and a description with its type and public key, following
  meshcore-open's `utils/gpx_export.dart`. No tracks, only waypoints; nodes
  with no usable location are skipped.

### Contacts (backend)
- **`POST /contacts/bulk-contact-uris`**: builds `meshcore://` contact links
  for several contacts at once from the most recently retained advert
  transmission per key (`advert_events` joined to `raw_packets`), instead of
  the existing per-contact `GET /contacts/{key}/contact-uri` which asks the
  radio (`CMD_EXPORT_CONTACT`) for each one. Read-only and never touches the
  radio; a key with no stored advert (never heard, or pruned by retention) is
  left out of the response rather than erroring. Used by the GPX export so a
  page of nodes does not cost one radio round trip per node.
## Update 2026-09-23 (Guessed locations map layer, feat/map-guessed-locations, plan 28 item 1.12)

### Map (frontend)
- **Guessed-locations layer.** A new "Guessed locations" section in the map
  Overlays FAB (off by default, remembered per browser, shown from zoom 12+)
  estimates a position for a node with no advertised or manual location: it
  takes the node's own known advert paths, matches the hop nearest the origin
  against located repeaters by 2- or 3-byte public-key prefix (1-byte hops are
  skipped; they collide across too many nodes), drops anchor repeaters more
  than 2x an estimated 15 km LoRa hop range apart from every other anchor, and
  places the guess 330 m off a single anchor or 80-120 m off a weighted centre
  of several, at an angle seeded from the node's public key so it stays put
  across renders. Only nodes heard in the last 24h are guessed. Drawn as a
  hollow "~" marker (never a filled circle, so it cannot be mistaken for a
  real position); clicking it explains the position is a guess and names the
  anchor repeater(s) and confidence. Guessed positions are never persisted,
  never included in an export, and never sent anywhere. Ported in spirit from
  meshcore-open's map screen (`lib/screens/map_screen.dart`, MIT); the
  weighted-centre average is computed as a proper weighted mean (divided by
  the sum of applied weights), fixing a bug in meshcore-open's own version
  (divided by the anchor count instead), which otherwise pulls the estimate
  toward (0, 0) as more anchors are combined. See `frontend/src/map/guessedLocations.ts`.
## Update 2026-09-23 (Trace on a map, plan 28 item 1.14, feat/trace-on-map)

### Map (frontend)
- **Trace results on a map.** The Trace page's results panel now shows a small
  map above the hop list: each hop is placed at its known location (advertised
  or manual override, same as the rest of the map), the route line follows
  the basemap tone like the message-path map (PR #183), and hovering a hop
  marker shows its name and SNR. A hop with no known location is skipped on
  the map (the list still shows it); the line segment bridging the gap to the
  next located hop is drawn dashed instead of implying a direct hop. New
  `TraceRouteMap.tsx` component and `utils/traceMapUtils.ts` (pure location
  resolution and segment building, unit tested). Shared marker/colour helpers
  moved from `PathRouteMap.tsx` into `map/routeMapVisuals.ts` so both map
  embeds draw hops the same way; no behaviour change for message-path maps.
  No backend change: `/radio/trace` already returns per-hop SNR.
## Update 2026-09-23 (New-node notifications, feat/new-node-notifications, plan 28 item 1.5)

### Notifications (backend + frontend)
- **New-node browser notifications.** An optional browser notification for the
  first time this app ever hears a public key: `app/services/new_node_notify.py`
  detects it on the advert packet path (`packet_processor._process_advertisement`)
  and the radio's own NEW_CONTACT auto-add (`event_handlers.on_new_contact`),
  broadcasting a WS `new_node` event. On a busy mesh, nodes heard within a
  3-second quiet window (capped at 15 seconds total) are batched into one
  summary notification instead of one per node. Notifications are suppressed
  for an hour after startup when the contacts table was empty (fresh install
  or restored DB), so the initial catch-up burst does not fire a wall of
  notifications for nodes that are only new to this install, not to the mesh.
- **Settings > Local Configuration > "New node notifications"** (off by
  default): a master enable checkbox plus per-node-type checkboxes (Client,
  Repeater, Room, Sensor - the same type names shown elsewhere in the app),
  gated on the browser's own `Notification` permission. Local-only preference
  (`localStorage`, same model as the existing per-conversation browser
  notification toggle); no server setting or Web Push involved. Clicking a
  single-node notification opens that contact; clicking a batch summary opens
  the default view where the sidebar/contacts are visible.
## Update 2026-09-23 (Structured repeater settings editor, plan 28 item 1.2, feat/repeater-settings-editor)

### Repeater dashboard (frontend)
- **Settings Editor pane.** A new full-width pane on the repeater dashboard
  lists an allow-listed set of repeater settings (name, lat/lon, owner info,
  guest password, radio f/bw/sf/cr, TX power, duty cycle, RX boosted gain,
  interference threshold, AGC reset interval, repeat, allow read-only, max
  flood hops, multi ACKs, loop detection, path hash mode, flood/direct TX
  delay, local and flood advert intervals) with an Edit button per row.
  Current values come from the panes that already read them, or from "Read
  current values" (`get` only). Every change is confirmed on its own: the
  dialog shows the setting, the current value, the new value and the exact
  CLI command before anything is sent. After sending, the result shows the
  read-back and flags a mismatch, a firmware rejection, or a missing
  read-back. Radio f/bw/sf/cr is one `set radio f,bw,sf,cr` command behind a
  strong confirm: its Edit button stays locked until the current radio values
  have been read (so the form never starts from guessed defaults), the user
  must type the repeater name, and the dialog warns
  that a wrong value strands the repeater off-air and that the firmware only
  applies it after a reboot (the editor never reboots). `prv.key` and the
  admin password are not editable. The raw CLI console is unchanged.

### Repeaters (backend)
- `POST /api/contacts/{key}/repeater/settings/set` sends ONE allow-listed
  `set <verb> <value>` and then `get <verb>`, returning the read-back and a
  status (`ok`, `mismatch`, `rejected`, `unverified`). Setting names and
  values are validated server-side (`app/services/repeater_settings.py`,
  ranges from the stock `CommonCLI.cpp`) before the radio is touched;
  anything else is a 400 and nothing is sent.
  `POST /api/contacts/{key}/repeater/settings/read` reads allow-listed
  settings with `get` only. No migration.
## Update 2026-09-23 (Backend map tile cache, plan 28 item 1.13, feat/backend-tile-cache)

### Map (backend + frontend)
- **Backend tile cache.** Settings > Map > Map tile cache (off by default).
  When on, the browser sends map requests for allow-listed sources to
  `/api/tiles/proxy/{source}/{path}`; the server fetches them from the fixed
  upstream, stores the tiles that were viewed on disk under
  `<data dir>/tile_cache/` and serves them to every browser. Cached areas keep
  working when the internet is down (a stale tile is served when the upstream
  cannot be reached); uncached tiles fail as before. Freshness follows the
  upstream `Cache-Control` / `Expires` headers with conditional revalidation,
  size is capped (default 1024 MB, least recently used evicted first) and
  entries expire after a max age (default 365 days). The settings show per
  source stats and a "Clear cache" button.
- **Per-source policy.** OpenFreeMap (vector styles, tiles, sprites, glyphs),
  OpenStreetMap and OpenTopoMap are proxied and cached for viewed tiles only,
  with a contactable User-Agent. Esri stays direct and is never fetched by the
  server (its terms forbid storing basemap data). Area pre-download exists in
  the backend but is off for every current source, because each of their
  terms forbids bulk or automated downloading; the UI says so instead of
  showing the download form.
- **Safety.** The server only ever contacts the fixed upstream host of an
  allow-listed source, and the client-supplied path must match that source's
  path patterns (tile coordinates are range-checked). Fetches are pinned to a
  validated public IP, the same approach as the chat link-preview fetch. No
  migration: settings live in `<data dir>/tile_cache/config.json`.

## Update 2026-09-23 (Shared-locations map layer + MGRS, feat/shared-locations-map-layer)

### Map (frontend)
- **Shared-locations layer.** A new "Shared locations" section in the map
  Overlays FAB (off by default, remembered per browser) shows location shares
  from chat as amber pins (teal for meshcore-open `poi` markers), for the
  map's time window (presets or the custom From/To range). By default only
  the newest share per sender is shown; "Every share" shows all of them. DMs
  and channels both count, and so do your own shares. Clicking a pin opens a
  popup with the label, who shared it, the channel or DM, the receive time,
  the coordinates, the format, the distance from your node, the hop count, a
  Details link for known contacts, "Open in chat" (jumps to the message) and
  an OpenStreetMap link. An MGRS share also shows the text as sent and its
  grid square (outlined on the map from 10 m up).

### Chat and display (frontend)
- **MGRS references in chat.** With coordinate parsing on, an upper-case MGRS
  reference such as `31U FT 45332 73249` (or `31UFT45337324`; 2-5 digits per
  half) becomes a location card like a `lat, lon` pair, showing the original
  reference above the converted position. Conversion uses the `mgrs` npm
  package (proj4js, MIT). Lower case is not matched, since it also matches
  short hex strings.
- **Coordinate format setting.** Settings > Local > Coordinate format:
  Decimal (default, unchanged), degrees/minutes/seconds, or MGRS. It applies
  to the map node/external/focus popups, the shared-location popup, the
  contact info location and telemetry GPS rows, chat location cards and the
  Share location picker. Stored per browser. Shares you send still use
  decimal degrees. The i18n key `contact_gps_coords` is replaced by
  `contact_gps_position`.

### Messages (backend)
- **`GET /api/messages/locations`** (`since`, `until`, `latest_per_sender`,
  default true): location shares in stored DM and channel messages received in
  `(since, until]`, newest first, with the conversation name, sender, format,
  label/flags, MGRS precision and paths. Recognizes meshcore-open
  `m:<lat>,<lon>|<label>|<flags>` markers, upper-case MGRS references, and
  `lat, lon` pairs with at least 4 decimals on both numbers (so "1.5, 2.5"
  is not a location). It does not depend on `chat_parse_coordinates`. Blocked
  keys and names are skipped. At most the newest 20,000 messages in the
  window are scanned (`truncated` says so). For the local map only; nothing
  is forwarded to fanout or MQTT. No migration.
- New `app/location_payloads.py` (share parsing) and `app/mgrs.py` (MGRS to
  lat/lon, a port of the `mgrs` npm package's inverse, tested against vectors
  generated with that package).

## Update 2026-09-23 (Map link age + per-link traffic history, feat/map-link-age-history)

### Map (backend)
- **Per-packet link edge log.** Every received packet copy (duplicates
  included) is resolved into undirected node-pair edges and stored in the new
  `link_edge_events` table (migration `_107`). Only flood paths count, because
  MeshCore forwarders append their hash to a flood path; direct paths are the
  route still ahead and TRACE stores SNR bytes in the path. Only contacts can
  be link endpoints: analyzer-only nodes never are (an analyzer node counts once
  it is a contact, for example after an applied partial resolution), and
  prefix-only placeholder contacts are skipped. Hops are resolved outward from
  our own node, and inward from the origin for adverts from a contact. A hop is
  accepted only when a confirmed soft resolution matches, when exactly one
  contact (with or without a location) has the prefix, or when the nearest
  located contact is at least 2x closer than the next. SNR/RSSI is stored on the last
  hop into our node. See `app/services/traffic_links.py`.
- **One-time backfill** of the edge log from packets stored before the upgrade
  (first-copy path only; later copies were never stored), running in the
  background after startup and resuming across restarts.
- **New retention setting** `link_edge_retention_days` (default 365, `0` = keep
  forever) in Settings > Database > Data retention.
- **New endpoints:** `GET /api/packets/traffic-links?since&until&heard_only&max_km`
  (links aggregated over a window) and `GET /api/links/{a}/{b}/summary`,
  `/timeseries?bucket=hour|day`, `/packets?limit&before` (per-link history).
  `GET /api/packets/advert-links` gains `since`/`until`.

### Map (frontend)
- **Link age selection.** The advert and traffic link modes follow the map's
  node time filter by default; under Overlays > Links you can switch that off
  and pick an own preset or From/To range (remembered per browser).
- **"All traffic" link mode** (third mode next to Liveness and Advert paths),
  drawn in green from the edge log.
- **Clickable links.** Clicking an advert or traffic link opens a popup with the
  endpoints, distance, packets in the window and last seen, plus "Details",
  which opens a full page (`#link/<a>/<b>`) with summary cards, a traffic trend
  stacked by packet type (hour/day buckets, zoom/pan), a signal trend for links
  to your own node, and the recent packets (click one to inspect it). Strings in
  EN/NL/DE.

## Update 2026-09-23 (SMAZ message decode, feat/smaz-decode)

### Messages (backend)
- **SMAZ-compressed messages are decoded on receive.** Another MeshCore
  client (meshcore-open) can send DM and channel text as `s:<base64>` SMAZ.
  These bodies are now decoded before storage (new `app/smaz.py`, a port of
  meshcore-open `lib/helpers/smaz.dart`, MIT), for DMs (packet and
  `CONTACT_MSG_RECV` fallback paths) and channel messages (packet, historical
  decrypt and `CHANNEL_MSG_RECV` fallback paths), so mentions, unread mention
  flags and reaction hashes work on the readable text. Base64 and base64url
  (with or without padding) are accepted. To avoid rewriting ordinary text
  such as `s:test`, a body is only decoded when it is exactly what the
  meshcore-open encoder would send (canonical stream, valid UTF-8, shorter
  than the decoded text); otherwise the original text is stored unchanged.
  Outgoing echoes are not decoded. The backend does not send SMAZ.

## Update 2026-09-23 (meshcore:// contact links, feat/meshcore-contact-uri)

### Contacts (backend)
- **Export and import `meshcore://` contact links.** The link format is
  `meshcore://` plus the lowercase hex of a raw advert packet, the same as
  another MeshCore client (meshcore-open) and the companion firmware's
  CMD_EXPORT_CONTACT use. New endpoints: `GET /api/radio/contact-uri` (this
  node), `GET /api/contacts/{key}/contact-uri` (a contact; needs an advert
  stored on the radio) and `POST /api/contacts/import-uri`. Imported links are
  checked (hex, ADVERT packet, Ed25519 signature) before the radio sees them.
  Export and import are local radio commands; nothing is transmitted.
  `share_contact` (which transmits) is not used.

### Contacts (frontend)
- **Contact link in contact info and Settings > Radio.** "Show contact link"
  reads the link from the radio and shows it with a copy button. The
  new-conversation dialog has a "Contact link" tab to import a pasted
  `meshcore://` link. No QR code (the frontend has no QR dependency). Strings
  in EN/NL/DE.

## Update 2026-09-23 (Path route map line contrast, fix/path-route-map-line-contrast)

### Map (frontend)
- **Path route line follows the basemap, not the app theme.** The single-route
  line in the Path Route Map was near-white whenever the app theme was dark,
  so it was hard to see on light or coloured basemaps (Liberty, Positron,
  OSM, topo). It now uses the selected basemap's tone: dark line on light
  basemaps, the existing light line on dark basemaps (Nova, OFM Dark, Fiord,
  dark gray, satellite). It updates live when the basemap is switched from
  the Layers FAB. `MapSurface` / `MiniMap` gain an `onBasemapTone` callback.
  Multi-route overlays keep their per-route colours.

## Update 2026-09-23 (Per-contact telemetry permissions, feat/per-contact-telemetry-perms)

### Contacts (backend)
- **Contact flags are no longer wiped by adverts.** Every advert, DM
  placeholder, discovery and manual-create upsert wrote `flags = 0`, because
  `ContactUpsert.flags` defaulted to 0 and the upsert SQL did
  `flags = excluded.flags`. `ContactUpsert.flags` is now optional and `None`
  keeps the stored value. A radio contact snapshot still writes the radio's
  flags.
- **Per-contact telemetry permissions.** New
  `POST /api/contacts/{key}/telemetry-permissions` (`{base, location,
  environment}`) stores the choice in the new nullable
  `contacts.telemetry_perms` column (migration `_106`). The bits follow the
  companion firmware: `contact.flags` bit 0 is the radio favourite bit and the
  `TELEM_PERM_*` bits sit at `flags >> 1`. The app value wins: it is pushed with
  `change_contact_flags` when the contact is loaded on the radio (the contact
  is never added just for this), `Contact.to_radio_dict()` applies it whenever
  the contact is loaded later, and each radio contact snapshot re-pushes it if
  the radio's bits differ (for example after the radio auto-adds the contact
  with default flags).

### Contacts (frontend)
- **Telemetry sharing toggles in contact info** (Battery / Location /
  Environment, under Radio residency). These only take effect for categories
  set to Per-Contact in Settings > Radio, which the hint says. Strings in
  EN/NL/DE.
## Update 2026-09-23 (Shared node_modules in worktrees, fix/vite-shared-node-modules)

### Tooling / CI
- **A worktree whose `frontend/node_modules` is a junction or symlink to a
  shared checkout now works with Vite and Vitest.** Vite resolved the link to
  its real path, outside the worktree, and denied the maplibre
  `maplibre-gl-worker.mjs?worker&url` import (`Denied ID`), so 17 test files
  failed to load and the dev server errored. `vite.config.ts` and
  `vitest.config.ts` now add the real `node_modules` path to `server.fs.allow`
  (next to the workspace root, which stays allowed). No effect on a normal
  in-place install or the production build.

## Update 2026-09-23 (Browser tab and PWA follow branding, feat/tab-branding-rtfm-ev)

### Chat / UI
- **The browser tab title and favicon now follow the custom branding.** A set
  brand name becomes the tab title (unread form `(3) My Mesh`); a set brand
  icon replaces the favicon, with the green/red unread badge drawn over it.
  Hiding the navbar name does not change the tab title.
- **The default name is now "RTFM-EV"** instead of "RemoteTerm for MeshCore" /
  "RemoteTerm" / "MCTerm", in the tab title, the navbar wordmark, the
  branding name placeholder and the iOS home-screen title.

### Backend
- **The served `index.html` and `site.webmanifest` use the brand name.**
  `app/frontend_static.py` rewrites `<title>` and `apple-mobile-web-app-title`
  in `index.html` when a brand name is set (so the tab shows it before the app
  loads and "Add to Home Screen" picks it up), and uses it for the manifest
  `name`/`short_name` and screenshot labels. Without a brand name, or when
  settings cannot be read, both fall back to `DEFAULT_APP_NAME` ("RTFM-EV").
  Manifest icons are unchanged (the built-in PNGs).

## Update 2026-09-23 (Map links: heard-only, max distance, fullscreen)

### Map links (backend)
- **Advert-path links no longer resolve through never-heard nodes.**
  `GET /api/packets/advert-links` gains `heard_only` (resolve hops only against
  contacts with `last_seen` set, skipping never-heard contacts and analyzer-only
  `external_map_nodes`) and `max_km` (a hop candidate farther than this from the
  previous hop is not a match, so the chain breaks; direct and tail edges to self
  longer than this are dropped). Both default off, so the API is unchanged for
  other callers. Fixes links drawn from the Netherlands to the UK.

### Map (frontend)
- The map link layer requests `heard_only=true` plus the user's max distance.
  The wrong-location filter keeps its own unfiltered fetch, so its detection is
  unchanged.
- Liveness links resolve hops only against heard contacts (the packet overlay
  keeps the full contact set) and drop links longer than the max distance.
- New **Max link distance (km)** field in Overlays > Links (per browser, empty =
  no limit), usually the RF range of your frequency and preset.
- New **Fullscreen** FAB that toggles browser fullscreen for the whole map
  surface; hidden where the Fullscreen API is unavailable (iPhone Safari). The
  compact bottom sheet portals into the fullscreen element so panels stay
  visible.
- **Fix: map links now draw on page load.** With links remembered on, the edge
  fetch could resolve before the map finished loading, and nothing re-painted
  the link layer once it was created, so no links showed until a link option
  was changed. A basemap swap (including the initial vector-basemap upgrade)
  also re-added the advert-links layer empty. `MapView` now paints the current
  links as soon as the layers exist and again after every basemap re-apply.

## Update 2026-09-23 (Protocol and messaging fixes, fix/protocol-messaging-bugs)

### Security
- **Remote CLI secrets no longer reach the logs.** `password <pw>`,
  `set guest.password <pw>` and `set prv.key <hex>` are masked in the command
  log lines. Replies to secret-bearing commands are logged as `***`; the
  firmware echoes the new admin password back in its reply. The meshcore
  library's own `send_cmd` debug line is filtered too. The log ring buffer is
  served by `/api/debug`, which users paste into bug reports.
  (`app/log_redaction.py`)

### Repeaters and rooms
- **CLI replies are matched to the command that caused them.** Each command is
  sent with a rotating `XX|` tag. Repeater/room firmware and OpenHop reflect it
  back, so a late reply to an earlier command is dropped and no longer shown as
  the answer to the current one. Untagged replies from older firmware are still
  accepted.
- **Room status no longer shows a meaningless RX airtime.** Room firmware
  reports two counters in that slot: posts, and post pushes to members. The
  Telemetry pane now shows those for room servers. Tracked room telemetry
  stores them the same way.

### Messaging
- **Same text to two contacts in the same second no longer shares a delivery
  code.** The firmware DM ACK code does not include the recipient, so the
  second DM overwrote the first's pending ACK. The first DM then never showed as
  delivered. DM timestamps are now unique per text across all recipients.
- **Reactions no longer count as @mentions.** A channel reaction names its
  target (`@[Name]👍` plus a hash line). The mention badge, sound, ticker and
  server unread-mention flag now skip reactions in both dialects.
- **React and reply from the chat.** Hovering a message shows React (quick
  emoji set) and Reply. Both use the plaintext format other MeshCore clients
  already send, so they read correctly there:
  - a reaction is `@[Sender]emoji` plus a hash line on channels, `emoji` plus
    the hash in DMs; it goes out through the normal send path (new
    `POST /messages/{id}/react`);
  - Reply fills the composer with `@[Name]`, a `>` line quoting the first 10
    characters, and a new line for your text.
- **Received reactions link to the message they are for.** The 8-character
  hash is resolved to the target message: SHA-256 of the target's body and
  sender timestamp, checked against real channel traffic (new
  `GET /messages/{id}/reaction-target`). The reaction shows a quoted snippet
  that jumps to that message. If it never reached this radio, the reaction
  says so and links to the channel on the first configured analyzer with a
  channel link. Builds on the reaction display from #38. This works for
  meshcore-open reactions too: the current `r:<hash>:<index>` form (Dart
  `String.hashCode`, 16-bit, so the newest match wins) and the older
  `r:<millis>_<nameHash>_<textHash>:<emoji>` form, which used to show as raw
  text and is now recognised as a reaction.
- **Web Push respects the block lists.** Blocked contacts and blocked channel
  sender names no longer trigger push notifications.
- **Composer warns earlier on long channel messages.** Above 139 bytes of
  `name: text`, the message needs another encryption block. The radio then
  stops forwarding repeats of it to the app after about 4 path bytes (region
  scoped) or 8 (unscoped). The red zone now starts there with "repeats of this
  message may not show up here".

### Radio
- **Contacts evicted by the radio are reloaded.** With overwrite-oldest on
  (`MESHCORE_LOAD_WITH_AUTOEVICT` or set by another client), the radio's
  "contact deleted" push now removes the contact from the library cache, so the
  next sync or send loads it again instead of assuming it is still there.

### Database
- **Startup warns when the database is newer than the app.** After a
  downgrade, or a restore of a backup from a newer build, the migration runner
  now logs a warning instead of silently continuing.

## Update 2026-09-23 (Configurable data retention, feat/data-retention-policy)

### Retention (backend)
- **Every stored history class now has its own retention setting.** Migration
  `_105` adds `retention_prune_interval_hours` (24), `telemetry_retention_days`
  (30), `telemetry_max_rows_per_node` (1000), `link_signal_retention_days` (30),
  `advert_paths_per_contact` (10), `noise_floor_retention_days`,
  `battery_retention_days`, `airtime_retention_days` and
  `message_retention_days` (all 0 = keep forever). The existing
  `raw_packet_retention_days` and `advert_retention_days` now both accept 0-3650
  (advert `0` now means keep forever instead of "treated as 30"). The defaults
  are the caps that were hard-coded before, so an upgrade deletes nothing new.
- **One prune service replaces the scattered prune points.** New
  `app/services/retention_pruner.py` (SQL in `app/repository/retention.py`)
  replaces `advert_pruner.py` and `raw_packet_pruner.py`, the prune-on-insert in
  the two telemetry repositories and the hourly `link_signal` prunes in
  `packet_processor.py` / `radio_sync.py`. It ticks every minute, runs when the
  configured interval has elapsed, isolates failures per class, and calls
  `PRAGMA incremental_vacuum` after a run that deleted rows. Limits are now
  enforced per run instead of per insert.
- **Message retention deletes the message's raw packet too**, in the same
  transaction, so historical decryption cannot bring a pruned message back.
- **Noise floor, battery and airtime history can now be pruned.** Before this
  nothing ever deleted them.
- New `GET /api/retention/stats` (row count and oldest entry per class, last /
  next run, preview of messages a given retention would delete) and
  `POST /api/retention/prune` (run now).

### Settings > Database (frontend)
- **"Mesh health history" is replaced by a "Data retention" section**
  (`SettingsRetentionSection.tsx`): one row per data class with row count, oldest
  entry and its limit input(s), the prune interval, a "Prune now" button, and
  "Keep everything (analyzer)" / "Restore defaults" buttons (both confirm first).
  Enabling or lowering message retention asks for confirmation and shows how
  many messages the next run deletes. New `settings_retention_*` i18n keys in
  EN/NL/DE; the five old mesh-history retention keys are removed.

### Documentation
- README: the per-class retention roadmap item moved to "Shipped".
  README_ADVANCED: new "Data retention" section. `app/AGENTS.md` and root
  `AGENTS.md`: retention settings, service, and endpoints.

## Update 2026-09-23 (Map: Chrome blackout, neon nodes, 3D buildings)

### Map
- **Chrome: the map no longer goes black for a few seconds with packet
  visualization on.** `MapSurface` ran its WebGL availability probe on every
  render (`useRef(isWebglAvailable())`), and each probe created a new WebGL
  context. The live packet overlay re-renders several times a second, so Chrome
  hit its per-page WebGL context limit. It then force-lost the oldest context,
  which was the map's, roughly every 6 seconds. The probe now runs once per
  mount and releases its context straight away (`WEBGL_lose_context`).
- **Neon nodes and packet visualization now work together.** deck.gl's
  `MapLibreOverlay` allows one interleaved overlay per map. The packet overlay
  and the neon nodes each created their own, so whichever attached second threw
  and was silently dropped. Neon only showed up by chance while the map kept
  losing its WebGL context, and stopped showing once that was fixed. Both now
  draw through one shared overlay per map (`map/layers/sharedDeckOverlay.ts`),
  neon under the packets. The shared overlay also re-adds its MapLibre layer
  group once the style has loaded: deck skips that step while a basemap style
  is still loading and never retries. After a WebGL context restore, every
  slot's layers are rebuilt fresh, so neon nodes come back too.
- **Nodes inside a 3D building's footprint are no longer hidden by it.** With
  3D buildings on, the building extrusions were inserted above the node
  layers. The anchor list assumed `rt-external` was the lowest overlay, but it
  is re-added last on every basemap switch. The extrusion now goes below
  whichever node overlay is lowest in the actual layer order. Neon nodes were
  hidden for a second reason: deck.gl 9 ignores the legacy
  `depthTest`/`depthMask` layer parameters, so they were depth-tested against
  the buildings. They now use `depthCompare: 'always'` (same for packet pulses
  and glow).
- **Neon nodes and packet arcs land on the roof.** A node inside a building
  footprint is lifted to that building's roof height (plus 1 m), and packet
  arcs, pulses and glows that start or end there follow it, so arcs land on
  the node instead of disappearing into the building. Heights come from the
  rendered building layer (`map/engine/buildingHeights.ts`), so they apply once
  the buildings for that area are drawn (zoom 12 and up). The flat node
  circles cannot be raised in MapLibre; they stay at ground level but draw
  above the buildings.

## Update 2026-09-23 (Chat: full emoji library)

### Chat (frontend)
- **The composer's emoji picker now has the full emoji library.** All Emojibase
  categories (Smileys & emotion through Flags), replacing the fixed set of 40.
  Built on `frimousse` (a small React picker with no built-in styling) and
  `emojibase-data`, styled with the app's theme tokens.
  - Search, with category names and search terms in the app language (EN/NL/DE).
  - Skin tone selector, remembered per browser.
  - A "Recent" row with the last 16 emojis used, per browser. It is hidden while
    searching.
  - A footer with the hovered emoji's name and UTF-8 byte cost, since LoRa
    messages are byte-limited (e.g. 👍 = 4 bytes, 👍🏽 = 8, a flag = 8).
- **No wasted bytes on emoji.** Emojibase spells ~500 emojis with a trailing
  U+FE0F variation selector (3 bytes). For the 152 whose base character already
  renders as emoji by default (👍 👎 ✋ ⛳ …) it is redundant and is now dropped,
  so 👍 costs 4 bytes instead of 7. It is kept where it matters: text-default
  characters such as ❤️ and keycap/ZWJ sequences.
- **No CDN requests.** frimousse loads its data from jsDelivr by default. A small
  Vite plugin now serves the en/nl/de data files from the installed package in
  dev and copies them into `dist/emojibase-data/` at build time. Only the active
  language is fetched (~100 KB gzipped), the first time the picker opens.
- **Country flags on Windows.** frimousse's own flag-support check uses a font
  stack without the app's "Twemoji Country Flags" polyfill, so on Windows
  Chromium it dropped all 259 country flags. When the polyfill is active the
  flags are now added back, and the picker's emoji font includes the polyfill
  font so they render as flags.
- **The picker can never send a message.** Emoji buttons are explicitly
  `type="button"`, and the composer ignores form submits while focus is inside
  the picker (Enter in the search box with no results or while loading would
  otherwise trigger implicit form submission). Regression tests cover clicking
  an emoji, Enter with and without a search match, and Enter while loading.

## Update 2026-09-23 (Repeater and room avatars no longer depend on emoji fonts)

### Contact avatars (frontend)
- **Repeater and room-server avatars are now SVG icons, not emoji (fixes
  #63).** Repeaters used 🛜 (Unicode 15, 2022) and rooms 🛖 (Unicode 13). On a
  system whose emoji font predates Unicode 15, every repeater avatar showed a
  missing-glyph box with the hex code `01F6DC` in it. The avatars now draw
  lucide's `RadioTower` (repeaters) and `House` (rooms) icons, on the same grey
  and brown backgrounds as before, so they look the same on every OS.
  `getContactAvatar` returns a new `icon` field (`'repeater'` / `'room'`) that
  `ContactAvatar` renders. Other contacts keep their initials or emoji, since
  those come from the contact's own name. No backend change, no migration.

## Update 2026-09-23 (Docs refresh, docs/refresh-2026-09-22)

### Documentation
- **README: restored the "OpenHop node management" section.** It was added in
  #122 and dropped by accident in #123 (whose branch predated #122). Restored
  as written, plus a note that the My Node airtime chart reads TX/RX airtime
  from OpenHop's REST API when it is configured (#127).
- **README roadmap no longer lists the packet-history browser as planned.** It
  shipped in #143. The closing line no longer calls the history-browsing UIs
  unbuilt, and the retention item notes that only raw packets have a
  configurable retention setting so far.
- **README Packet History description corrected.** It still claimed live-append
  and a pause button, both of which #156 removed. It now describes the Refresh
  button and says only the Raw Packet Feed can be paused.
- **README feature lists:** added the Date & Time Format setting (#164), the
  Mesh Health view (Adverts, Requests, and Prefix Collisions tabs; #145, #148,
  #157, #158, #162), and the My Node directly-heard radar (#159).
- **`app/AGENTS.md`:** documented the undocumented `/packets/*` routes
  (`recent`, `history`, `timeseries`, `historical-stats`, `mesh-health`,
  `prefix-collisions`, `snr-rssi-scatter`, `hourly-heatmap`,
  `reachability-rings`, `relay-pairs`, `advert-links`). Brought the
  `app_settings` field list up to date with the `AppSettings` model. Noted
  which files a new settings field has to touch.
- **Root `AGENTS.md`:**
  - The doc map now lists `docs/parity-audit.md` and `docs/agents/`.
  - `MapView` is described as MapLibre, no longer Leaflet.
  - The API table gained Packet History, prefix-collisions and
    partial-resolution rows, plus a note that the table is a subset.
  - Added the missing `MESHCORE_UPDATE_CHECK_ENABLED` env var.
  - The settings note now points to the full field list.
- **`README_ADVANCED.md`:**
  - Corrected the Customisation settings path (it sits under Local
    Configuration).
  - Added a note on raw-packet retention next to the backup docs.
- **`README_HA.md`:**
  - Updated the setup path (Settings > MQTT & Automation).
  - Completed the local-radio sensor list: battery, uptime, RSSI/SNR, airtime,
    packet counts.
  - Added the repeater RX Errors sensor and LPP sensors for repeaters.
  - Corrected the telemetry-tracking location (Radio-App Management).
- **`docs/sources-of-truth.md`:** added OpenHop (`openhop_repeater` /
  `openhop_core`) and the EU analyzer's role as the default external-map and
  partial-node source.
- **`docs/parity-audit.md`:** reconciled to `3481d9f8`. N2 and X1 are now
  marked shipped (they still said "PR open"). No other backlog item changed
  status in #124-#170.
- Refreshed the commit counts in this changelog's header.
## Update 2026-09-23 (Mesh Discovery moves to Tools)

### Mesh Discovery view (frontend)
- **Mesh discovery is now its own page under Tools instead of a block in
  Settings > Radio.** New `MeshDiscoveryView` (sidebar row "Mesh Discovery",
  route `#mesh-discovery`, reorderable/hideable like the other tool rows) holds
  the Discover Repeaters / Sensors / Both buttons and the last-sweep results,
  unchanged in behaviour. The block is removed from Settings > Radio; region
  discovery there still prefers repeaters from the last sweep, because the sweep
  state stays in `useRadioControl`. New i18n keys `nav_mesh_discovery` and
  `common_loading_mesh_discovery` in EN/NL/DE; the unused
  `settings_radio_mesh_discovery_heading` is removed. No backend change, no
  migration.

## Update 2026-09-22 (Map settings FAB, trail fade-out, remembered toggles)

### Map controls (frontend)
- **The map's size and colour settings now have their own cogwheel FAB
  ("Size & colors").** Node size, neon nodes, packet-arc (trail) width, link
  width and per-role node colours moved out of the Display (layers) FAB into a
  new `style` group in `MapControls`, placed directly below Display. Display
  keeps the basemap, labels and legend. New i18n key `map_group_style`.
- **New "Trail fade-out" slider for live packet arcs** (in the cogwheel panel).
  Presets 1, 2, 5, 10, 30s and 1, 2, 5, 15, 30, 60 min; default 15 min is the
  previous fixed lifetime. The full-opacity window scales with it (1/15 of the lifetime, i.e.
  60s at 15 min, as before). `packetTimeline.stateAsOf` takes a `fadeMs`
  option. Arcs older than the replay look-back are still pruned regardless.
  Stored per-browser (`remoteterm-map-arc-fade`). New i18n keys
  `map_arc_fade_label`, `map_arc_fade_value_s`, `map_arc_fade_value_min`.
- **Overlays FAB: link mode and confidence options are hidden while "Show
  links" is off.**
- **Map toggles are now remembered per-browser** (new
  `usePersistedMapSetting` hook, JSON in localStorage, validated on read):
  pinned legend and its dragged position, pulses, glow, smoothing, sound +
  volume, discover nodes, replay look-back, links on/mode/confidence, external
  nodes, 2D/3D tilt and 3D buildings. A remembered 3D buildings toggle is
  re-applied on map load. A remembered legend position is clamped back inside a
  smaller map. "Visualize packets" is remembered too.

### Map filters (frontend)
- **Fixed: "Heard by server: All" hid never-heard nodes.** The time filter was
  applied to nodes with no `last_seen`, which always failed it, so "All" showed
  the same set as "Hide never-heard". Never-heard nodes now skip the time window
  whenever the heard filter admits them ("All" and "Only never-heard").

### Map engine (frontend)
- **MapLibre GL upgraded 4.7.1 -> 6.10.0** (latest). MapLibre 6 loads its tile
  worker from a file beside its own module, which Vite's hashed chunks do not
  provide (no tiles or GeoJSON ever loaded: blank map). `MapSurface` now bundles
  the worker via `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` and calls
  `setWorkerUrl` (type shim in `src/types/vite-worker-url.d.ts`; test mock gains
  `setWorkerUrl`).
- **Fixed a basemap reload loop.** The vector-style watchdog only accepted
  MapLibre's `idle` event; with the packet overlay animating, the map is never
  idle, so it fell back to raster after 8s and the next overlay re-apply swapped
  back to vector, forever (layers flashing, then black). A rendered frame with
  the style and all tiles loaded now also counts as healthy.
- **Fixed a second basemap loop:** `MapSurface` re-applied the preferred
  basemap whenever the overlay re-apply callback changed identity (every few
  seconds with live packets on). After a raster fallback this retried the vector
  style, timed out again and looped. The callback is now held in a ref, so only
  a real basemap/theme/buildings/tint change re-applies the basemap.

### Packet overlay (frontend)
- **The live packet overlay uses deck.gl's `MapLibreOverlay` (interleaved).**
  `@deck.gl/mapbox`'s `MapboxOverlay` cannot be used with MapLibre 6: it reads
  `map.transform.height`, which MapLibre 6 removed, and the exception stops
  MapLibre's render loop (black map).
- **Self-heal after a WebGL context loss:** the overlay is rebuilt when the
  map's context is restored. Before that, luma.gl's hooks are removed from the
  shared context (`resetLumaOnContext`): luma.gl installs caching wrappers for
  GL state setters/getters and `useProgram` directly on the context object, and
  after a loss that stale cache made it skip MapLibre's own GL calls too, so the
  whole map rendered transparent. Verified by forcing a loss with
  `WEBGL_lose_context`: map and arcs recover.
- The playback bar no longer uses `backdrop-blur` (it measurably increased GPU
  resets in Chrome while the map animates).
- **Chrome black-map loop resolved.** The loop (layers flashing, then black)
  came from the two basemap reload loops above plus the stale luma.gl cache
  after a context loss. Verified in Chrome (GTX 1080 Ti, ANGLE/D3D11): 60s with
  packets on, ~60 fps, 0 context losses, 0 GL errors, live arcs drawn.

## Update 2026-09-22 (Map custom range: start + end)

### Map time filter (frontend)
- **The map's "Custom" time filter now takes a start and an end date instead of
  a single "heard since".** The custom panel shows two fields, `From` and `To`
  (reusing the existing `time_range_from` / `time_range_to` strings), each
  optional: a `From` alone behaves like the old "heard since", a `To` alone
  bounds the window above ("up to"), and both together select a window. Empty
  means unbounded on that side. The node filter now applies both bounds to each
  node's `last_seen` (`> From` and `<= To`); presets remain open-ended. The end
  value persists per-browser (`remoteterm-map-since-custom-until`). New i18n key
  `map_since_custom_until_input_aria` in EN/NL/DE.
  Verified: build + `mapView`/i18n-parity tests green; live in the rebuilt
  container via Chrome - both fields render and persist, and setting `To` to a
  past date correctly clears the map (empty window shows no nodes).

## Update 2026-09-22 (Date-field layout + native picker theming)

### DateTimeField follow-ups (frontend)
- **Channel-registry edit modal: the Last Heard / Added labels no longer sit
  jammed against their inputs.** `DateTimeField` renders an inline field, so in
  the modal's block layout the label flowed onto the same line. Added a
  `fullWidth` prop that renders it as a block, full-width form field (label
  above), matching the sibling inputs; the channel-registry date fields use it.
- **Native date/time picker popups now follow the theme.** No `color-scheme` was
  ever declared, so the browser's native calendar/spinner popups rendered as a
  white panel on dark themes. `applyTheme` now sets
  `document.documentElement.style.colorScheme` from `isDarkTheme()` (which reads
  the computed `--background` lightness), so native controls match every theme.
- **Map "Custom" range field: fixed being unable to pick a date.** The field was
  wrapped in a native `<label>`, which wraps a single control - here it wrapped
  the composite field (text input + calendar button + hidden native input) and
  mis-routed clicks. Changed to a `<div>` (the field keeps its `aria-label`) and
  made it full-width.
  Verified: `tsc` build + `dateTimeField` tests green; live in the rebuilt
  container via Chrome - channel-registry labels stack above full-width fields,
  `color-scheme: dark` computed on the dark theme, the map field's wrapper is a
  `<div>` and a picked value commits (`20/03/2026 09:15`).

## Update 2026-09-22 (Date input contrast across themes)

### DateTimeField styling (frontend)
- **The custom date/time inputs now render in full-contrast text in every
  theme** (reported by Richard: the map's "Custom" range field looked "very
  white" and felt like the date could only be set via the calendar, and the same
  washed-out look appeared on the channel-registry edit modal). Root cause: the
  shared `DateTimeField` applied only the caller's `className` to its visible
  text field with no base styling, so callers under-styled it inconsistently -
  the map field inherited `text-muted-foreground` from its filter label (low
  contrast, and near-invisible typed text on the light themes), while the
  channel-registry and bulk-delete fields had no border/background/text-color at
  all. `DateTimeField` now applies a theme-aware base (`text-foreground`,
  `bg-background`, `border-input`, muted placeholder, focus ring) merged via
  `cn(BASE, className)` so callers still control layout (width/height/padding).
  No behaviour or value-format change; the fix is in one shared component and
  covers the map filter, channel registry, bulk-delete filters and
  `TimeRangeSelector`.
  Verified: eslint + prettier + `tsc` build + `test:run` (1797) green; live in
  the rebuilt container across all themes (original/light/ios/paper-grove/the
  four CRT phosphors/high-contrast/monochrome/windows-95) - computed field text
  is now the `--foreground` token, not `--muted-foreground`, on both the map
  "Custom" field and the channel-registry Last Heard / Added fields, with typed
  values clearly visible.

## Update 2026-09-22 (Map home location + zoom)

### Map startup view (frontend + backend)
- **New "Map" settings section to control where the map opens.** A `When the
  map opens` dropdown offers three modes: `Automatic` (the historical
  geolocate-then-fit-all-nodes behaviour), `Start at a fixed home location`, or
  `Remember my last position`. In fixed-home mode a small interactive map panel
  lets you click (or drag the marker) to set the home coordinates, with the
  panel's own zoom captured as the starting zoom; editable latitude / longitude
  / zoom fields stay in sync, and a `Save home location` button persists them.
- The mode + home coordinate/zoom are stored server-side in `app_settings`
  (migration `_104_add_map_home_view.py`: `map_home_mode`, `map_home_lat`,
  `map_home_lon`, `map_home_zoom`), so they apply wherever you sign in. The
  frequently-updated "last position" is saved per-browser in `localStorage`
  (`remoteterm-map-last-view`), written on the map's `moveend`.
- The startup decision is a pure `resolveHomeView(settings, lastView)` helper
  (`frontend/src/map/homeView.ts`) wired into `MapView.fitInitialView` after the
  explicit node/coordinate focus branches and before the geolocate + fit-all
  fallback, so a deep-link to a node still wins and `auto` mode is unchanged.
- New i18n keys `settings_section_map` + `settings_map_*` in EN/NL/DE.
  Verified: backend ruff + pyright + full pytest (2219) green; frontend eslint,
  prettier, `tsc` build and `test:run` (1797) green, including new unit tests for
  `resolveHomeView` / last-view round-trip and a `SettingsMapSection` component
  test (mode switch, home-camera save, map-click sets coordinates).

## Update 2026-09-22 (Fix zoom crash on the remaining My Node charts)

### Charts (frontend)
- **Fix the crash that blanked the whole page when zooming/panning the Bytes
  Received, Packets Received, Noise Floor or Battery charts on My Node after
  hovering.** This is the same stale-hover-index bug that #138 fixed for the
  Airtime and Request-volume charts, but three sibling charts were missed. Each
  chart keeps its hovered index in state; a zoom/pan hands it a shorter sliced
  array (via `ZoomableBinChart`), so the retained index pointed past the new end
  and `bins[hov].time` (a `TypeError`) or `fmtTime(timestamps[hov])` (a
  `RangeError: Invalid time value` from `new Date(undefined)`) threw and
  unmounted the app. `BarChart`, `NoiseFloorLineChart` and `BatteryLineChart`
  now read the hovered item defensively (`hov < length ? arr[hov] : null`) and
  skip the tooltip when the index is stale, matching the guard the already-fixed
  charts use. Added a regression test
  (`myNodeChartsStaleHover.test.tsx`) that hovers the last bucket then shrinks
  the array. Verified: new test red before the fix / green after; full gates
  green (eslint / prettier / vitest 1782 / build); runtime-verified in the
  browser against the running backend (hover + repeated wheel-zoom on the Bytes,
  Noise Floor and Battery charts, no crash, no console exception).

## Update 2026-09-21 (Airtime chart x-axis dates)

### My Node airtime chart (frontend)
- **The Airtime utilization chart now shows an x-axis date/time scale like the
  other My Node charts** (reported by Richard). The chart alone omitted the
  bottom axis line and time labels, and it derived its tooltip time format from
  the visible data span instead of the selected window, so at wider ranges it
  had no dates and formatted times inconsistently with the sibling charts.
  `AirtimeLineChart` now takes the same `windowSeconds` prop the noise-floor /
  battery charts use and renders the baseline plus three `fmtTime` labels, so
  the axis matches across ranges. No backend or data change.
  Verified: eslint + prettier + `tsc --noEmit` clean; live in the browser via
  the dev server against the running backend (labels present and correctly
  formatted at 12h "Mon 10:09 AM", 24h "Sun 10:18 PM", 7d "Fri 12:06 PM").

## Update 2026-09-21 (Date pickers follow the date/time format setting)

### Date/time inputs (frontend)
- **The date-picker inputs now follow the date/time format setting.** Native
  `<input type="date"/datetime-local">` widgets always render in the browser
  locale (mm/dd/yyyy + AM/PM on a US browser) and can't be reformatted by the
  page, so the Node-map "Custom" range filter, the channel-registry Last Heard /
  Added fields, the shared `TimeRangeSelector` (Packet History / Mesh Trends
  custom range) and the bulk-delete filters ignored `date_time_format`
  (reported by Richard/Mike). New dependency-free `DateTimeField` component: a
  text field formatted and parsed per the setting (dd/mm/yyyy vs mm/dd/yyyy,
  24h vs 12h) with a calendar button that opens the native picker via
  `showPicker()` and a hidden native input holding the canonical value, so the
  value contract is unchanged (`YYYY-MM-DD` / `YYYY-MM-DDTHH:mm`). The field
  subscribes to format changes (`useSyncExternalStore`, new
  `subscribeActiveDateTimeFormat`) so it reflows without a reload. New i18n key
  `date_field_open_calendar` in EN/NL/DE.
  Verified: frontend vitest (`dateFieldFormat` 11 + `DateTimeField` 5; full
  suite 1779) + build + eslint/prettier; and live in the browser under
  `24h_dmy` (registry Added shows `21/09/2026`, map Custom placeholder
  `dd/mm/yyyy HH:mm`).

## Update 2026-09-21 (Date & time format setting)

### UI date/time format (backend + frontend)
- **New "Date & Time Format" setting** (requested by Richard) with three
  choices: `auto` (follow the UI language: EN -> 12-hour + mm/dd/yyyy, NL/DE ->
  24-hour + dd/mm/yyyy), `12h_mdy` (force 12-hour + mm/dd/yyyy), and `24h_dmy`
  (force 24-hour + dd/mm/yyyy). Default `auto`. Lives in Settings -> Local and
  persists in a new `app_settings.date_time_format` column (migration `_103`,
  TEXT, default `'auto'`), validated in the settings router (unknown values
  ignored). `LATEST_SCHEMA_VERSION` bumped to `103`.
- **Unified all ad-hoc date/time formatting** behind one central formatter,
  `frontend/src/utils/dateTimeFormat.ts` (`formatDateTime(value, options)`).
  Date/time rendering was previously scattered across ~17 files that mixed
  hardcoded 24-hour, browser-locale, and inconsistent date order; ~32 `toLocale*`
  date calls now route through the central formatter so the single setting
  governs the whole UI. `App.tsx` keeps the active format in sync (a pure
  derivation from the setting + UI language, done in render); number formatting
  (counts/bytes) is left untouched. New i18n keys `settings_date_time_format_*`
  in EN/NL/DE.
  Verified: backend CI gate in the Linux container (ruff, ruff format, pyright
  0 errors, pytest 2201) incl. a settings round-trip test, a router test, and
  `test_migration_103`; frontend `tsc` clean, full vitest suite (1757, incl. new
  resolver/formatter tests) + build, eslint clean; and live in the browser
  (switching the UI language flips the same packet timestamps between
  "06:12:56 PM" and "18:12:56", both directions; the Settings control fires
  `PATCH /settings {"date_time_format":"24h_dmy"}`).

## Update 2026-09-21 (Packet filters: remember "Group repeats by content")

### Packet filters (backend + frontend)
- **The "Group repeats by content" packet-filter toggle is now remembered**
  across sessions (requested by Richard). Previously it was session-only and
  reset to off on every reload; the other filter toggles already default on and
  are unchanged. The last selection persists server-side in a new
  `app_settings.packet_group_by_content` column (migration `_102`, INTEGER 0/1,
  default `0`), validated/forwarded through the settings router and threaded
  from `App.tsx` (`packetGroupByContent` + `onSaveAppSettings`) →
  `ConversationPane` → both the Raw Packet Feed and Packet History views, which
  share one `usePacketFilters` hook. The hook now takes an initial value (synced
  once app settings load) and a change callback that persists the toggle,
  mirroring `packet_feed_sort`. `LATEST_SCHEMA_VERSION` bumped to `102`.
  Verified: backend CI gate in the Linux container (ruff, ruff format, pyright
  0 errors, pytest 2199 pass) incl. a settings round-trip test, a router
  round-trip test, and `test_migration_102`; frontend vitest (new
  `usePacketFilters` init/persist tests, 5 AppSettings fixtures updated; full
  suite 1752) + build; and live in the browser (toggling the control issues
  `PATCH /settings {"packet_group_by_content": true/false}`).

## Update 2026-09-21 (Mesh Health: contacts table above alerts + search)

### Mesh Health (frontend)
- **Moved the "All Advertised Contacts Heard" table above the Flooding Adverts
  alerts** (reported by Richard): the HIGH/MEDIUM flood-advert alert lists can
  grow very long and pushed the contacts table far down the page. The alert
  blocks (and their "no alerts" empty state) now render *after* the contacts
  table, so the table stays reachable regardless of alert volume. The
  analytics charts above the table are unchanged.
- **Added a search box to the advertised-contacts table.** Free-text filter
  over the contact name and public key (case-insensitive); the summary count,
  pagination and page-size dropdown all follow the filtered set, and a
  no-matches message shows when nothing matches. New i18n keys
  `mesh_health_contacts_search_placeholder` / `mesh_health_contacts_no_matches`
  in EN/NL/DE.
  Verified: frontend vitest (`meshHealthView.test.tsx` 15/15 incl. new search,
  no-matches, and table-above-alerts DOM-order tests; full suite 1753),
  eslint/prettier/build clean, and live in the browser on the 7d window (real
  HIGH+MEDIUM alerts render below the table; typing a contact name filters
  50 rows to 1; gibberish shows the no-matches message).

## Update 2026-09-21 (Packet History: fix the "Request" type filter)

### Packet ingest + Packet History (backend)
- **Fixed REQUEST packets being stored as `"Unknown"`**, which made the Packet
  History "Request" type filter return no rows while the "Unknown" bucket
  surfaced them (reported by Richard). `raw_packets.payload_type` is written
  from `PayloadType.name` guarded on `if payload_type`, but
  `PayloadType.REQUEST` is `0x00` (falsy), so every request was labelled
  `"Unknown"`; the guard is now `is not None`. REQUEST is the only value-0 type,
  which is why no other type was affected. Adds migration `_101`, which
  re-decodes existing `"Unknown"` rows with the same ingest parser and relabels
  the ones that decode to REQUEST (genuinely unparseable rows stay `"Unknown"`),
  so historical requests become filterable too. `LATEST_SCHEMA_VERSION` bumped
  to `101`.
  Verified: backend CI gate in the Linux container (ruff, ruff format, pyright
  0 errors, pytest 2197 pass), incl. a new `process_raw_packet` REQUEST test
  and `test_migration_101` (relabel-only-requests + idempotent + skip-when-
  absent).

## Update 2026-09-21 (Rooms: keep the chat view on desktop)

### Rooms (frontend)
- **Fixed a regression from #151** where opening a room on desktop routed it to
  the full-page contact-info view, which has no message composer and no
  favourite star. After logging into a room you could neither see nor use the
  message input, and the header star was gone (DMs were unaffected, and mobile
  was fine because the diversion was desktop-only). Rooms are group chats, so
  they now stay on the normal chat path on desktop too (login panel → message
  list → composer, plus the `ChatHeader` favourite star); repeaters still
  converge onto the full-page dashboard as before, and a room's full-page
  contact-info page is still reachable via the explicit info action. One-line
  change in `ConversationPane` (`showContactInfoView` no longer diverts rooms)
  plus a desktop-room regression test.
  Verified: frontend vitest (`conversationPane.test.tsx` 13/13 incl. the new
  desktop-room test), eslint/prettier/build clean, and live in the browser
  (desktop room opens the chat view with the favourite star, not the info page).

## Update 2026-09-21 (Mesh Health contacts table: page-size dropdown)

### Mesh Health (backend + frontend)
- **"Show max rows" page-size dropdown** on the "All Advertised Contacts Heard"
  block (10/25/50/100/All, default 50). The table already had a client-side
  pager that only appeared past 50 rows; the dropdown drives it and `All`
  (value `0`) shows every contact on one page with the pager hidden. The choice
  persists server-side in a new `app_settings.mesh_health_page_size` column
  (migration `_100`, `int`, `0` = all, default `50`), validated in the settings
  router (unknown values ignored) and threaded from `App.tsx`
  (`meshHealthPageSize` + `onSaveAppSettings`) → `MeshHealthView` →
  `MeshAdvertsPanel`, mirroring `packet_feed_sort`/`packet_history_sort`. New
  i18n keys `mesh_health_page_size_label`/`_all` in EN/NL/DE.
  Verified: backend pytest (new migration `_100` test, settings round-trip +
  router validation tests; 215 pass across api/settings/migrations), frontend
  vitest (new dropdown test + 5 updated AppSettings fixtures; 141 pass across the
  touched suites), i18n parity, ruff/pyright/eslint/prettier/build all clean.

## Update 2026-09-21 (Signal-audio: make packet-feed sound work in Firefox, sound-behavior-localhost)

### Packet-feed sound (frontend)
Follow-up to #154 (which added a 20 ms scheduling lead but was never verified in
Firefox). Packet-feed sound was still silent/erratic in Firefox on all three
themes; now fixed and verified live in Firefox. Root causes, each Firefox-specific
(Chrome tolerated all of them, which is why it always worked there):
- **Main-thread stall dropped clicks.** A packet arrives over the WebSocket and is
  played from inside a React re-render of the feed, which stalls the main thread.
  Firefox does not commit a scheduled `AudioBufferSource`/`AudioParam` event until
  the JS task yields; if the scheduled time has already passed by then, it silently
  drops the click. The 20 ms lead was far too small to survive a render stall.
  `MIN_LEAD_S` is now **250 ms** (and `MAX_LEAD_S` 600 ms for burst headroom) — the
  tick lands ~250 ms after the packet, imperceptible for an ambient sound, and
  survives the stall. This is why the standalone reference app (plain JS, no heavy
  re-render) worked with near-zero lead but this one did not.
- **Context created at page load was delivered silent.** When sound was persisted
  on, the engine created its `AudioContext` at load (no user gesture); Firefox
  keeps such a context silent even after it later resumes. `setEnabled()` no longer
  creates the context; a new `resume()` method creates + resumes it, called only
  from a real user gesture (the Sound toggle, the "click to enable sound" hint, or
  the first pointer/key event). The hint is now an actual button, and clicking the
  Sound button while it is on-but-suspended resumes rather than toggling off.
- **NaN SNR threw and aborted the click.** A non-finite `snr` produced a non-finite
  bandpass frequency; Firefox throws on assigning a non-finite `AudioParam.value`
  (Chrome ignores it), aborting the click. `snrNorm` now treats any non-finite SNR
  as the floor, covering geiger/sonar/waterdrip.
- **No scheduling into a suspended context.** `onPacket` drops the click (and nudges
  a resume) when the context is not `running`, instead of queuing against a frozen
  clock and flushing a "machine-gun" burst when it resumes.

The geiger tick keeps its original sharp envelope (exponential ~11 ms decay,
matching DutchMeshCore-Observers); the ramps render reliably once scheduled the
250 ms ahead. No backend change, no migration, no new i18n strings.
Verified live in Firefox on `http://127.0.0.1:8000/#raw`: all three themes tick
per packet; isolated each root cause with in-page Web Audio measurements (master
output peaked at ~0 under a simulated stall with 20 ms lead, ~1.7 with 250 ms).
61 signal-audio vitest cases plus lint, prettier, and build clean.

## Update 2026-09-21 (Discord issues: Packet History refresh, manual location surfaces, map role filter + label priority)

### Packet History (frontend)
- **Removed pause/resume; the view is now query + manual refresh, like Mesh
  Health.** The type/path filters were applied *before* the pause snapshot gate
  while "group repeats" was applied *after* it (inside `RawPacketList`), so
  changing type/path while paused had no visible effect but group-repeats did.
  Pause is gone entirely: the view queries the selected time window and a
  **Refresh** button (`repeater_refresh`, spinner while loading) re-anchors preset
  windows to "now" and re-queries. Live WebSocket auto-append was dropped, so
  filter changes always re-apply immediately. `usePacketHistory` lost its
  `isLive` / `livePackets` / `channels` inputs and gained a `refreshToken`; the
  live **Raw Packet Feed** keeps its Pause button unchanged. No backend change,
  no migration, no new strings (`packet_pause` / `packet_resume` remain in use by
  the Raw Packet Feed).

### Manual location display (frontend)
- **A manual location override now shows on the message-path screen, the route
  map, and the contact header**, not only the node map. Those three surfaces read
  the raw advertised `lat`/`lon` (null for a manual-only node, so the node was
  dropped); they now use the existing `getEffectiveLocation` resolver.
  `resolvePath` projects effective coordinates onto each hop match, `getSenderInfo`
  resolves the sender endpoint's coordinates, and `ContactStatusInfo` renders the
  effective location. Precedence is unchanged (advertised wins; manual only fills
  gaps), so the node map is unaffected.

### Node map (frontend)
- **Role filter.** A new "Node roles" toggle in the map Filters panel shows/hides
  local nodes by role (repeater / room / companion / sensor), mirroring the
  existing "heard" filter; the focused node is exempt. Persisted per browser
  (`remoteterm-map-hidden-roles`). New strings `map_roles_label` / `map_roles_help`
  (EN/NL/DE).
- **Label priority.** The node-label symbol layer had no `symbol-sort-key`, so a
  clustered companion could win the label over a nearby repeater. Labels now sort
  repeater < room < sensor < companion, so repeaters keep their name in a cluster.

Verified: full frontend gate green (`tsc`, `eslint` 0 errors, `prettier` on
changed files, `vite build`, 1725 vitest incl. new coverage for each fix).
Live-verified on the local container (`http://127.0.0.1:8000`): Packet History
has no pause control and re-queries on Refresh, with a type-filter change
applying to the list immediately; the map Node roles filter hides nodes by role
(unchecking Repeater + Client left only Room/Sensor); a temporary manual
override showed in the contact header (`52.457, 4.765`) and was then reverted;
the live map's `rt-node-labels` layer carries `symbol-sort-key: ['get','sortKey']`
with `text-allow-overlap` off, so repeaters win label collisions.

## Update 2026-09-21 (Mesh Health contacts table: Mode column + clickable names)

### Mesh Health (backend + frontend)
- **Mode column now shows the real hop-address width** in the "All Advertised
  Contacts Heard" table instead of always `?`. The `/api/packets/mesh-health`
  endpoint hardcoded `hash_mode=None`; it now derives it from
  `advert_events.hop_width` (already recorded per transmission as bytes-per-hop).
  `AdvertEventRepository.mesh_health_rows` aggregates `MAX(hop_width)` per contact
  (hop width is a mesh-wide per-node setting, so any non-null observation is
  representative), and the endpoint maps byte-count (1/2/3) to the frontend's
  0-based `hash_mode` (0/1/2). Direct-only contacts carry no path, so their Mode
  stays `?` (honest: hop width is unknown without a flood path).
- **Contact names in the table are now clickable**, opening the node's detail
  page, matching the Prefix Collisions tab. `MeshAdvertsPanel` takes the existing
  `onOpenNode` handler (already wired through `MeshHealthView`) and renders the
  name as a link button when provided. No schema change, no migration, no new
  strings.
  Verified: 14 backend pytest (2 new: `hop_width` surfaced/None-for-direct,
  `hash_mode` on endpoint), 11 frontend vitest (1 new: name click calls
  `onOpenNode`); ruff check/format, pyright, eslint, prettier, and build all
  clean. NOT VERIFIED at runtime in the live container.

## Update 2026-09-21 (Directly-heard radar on My Node)

### My Node radar (frontend + backend)
- **Added a "Directly heard radar" card to the My Node page.** A dependency-free
  Canvas 2D polar plot of the directly-heard (0-hop) located nodes, placed by
  great-circle bearing (N = up) and log-scaled distance from the radio's own
  position (`config.lat`/`config.lon`). Dot colour encodes best SNR
  (green high to red low, grey when unknown), dot size scales with reception
  count, with log rings + km labels, an N/E/S/W compass, a hover tooltip
  (name, best SNR, receptions, distance @ bearing), and a legend. Ported and
  trimmed from the DutchMeshCore-Observers link-quality radar; the
  source/neighbour-topic filter, neighbour halo, and relayed-fade were dropped
  because every plotted node is directly heard.
- **Two-level zoom.** A range-zoom (data scale, 1x to 8x) via +/- buttons or
  Shift+wheel, plus a viewport pan/zoom (drag to pan, wheel to magnify about the
  cursor, double-click to reset). Wheel-zoom is bound as a native non-passive
  listener (React's `onWheel` is passive, so `preventDefault` there is ignored and
  the page would scroll on every zoom step). New modules under
  `frontend/src/components/mynode/radar/` (`signalCore.ts`, `radar.ts`,
  `radarData.ts`, `DirectRadar.tsx`); the pure geometry/helpers are unit-tested,
  the canvas draw path is browser-verified.
- **Data source.** Reuses the existing `/api/packets/historical-stats`
  `neighbors_by_count` (already 0-hop), which the page fetches for every window
  (the live 20m window refreshes on the page clock), so there is no extra
  request. The endpoint now also returns `best_snr` on `neighbors_by_count`
  (surfacing the existing `contact_advert_paths.best_snr` column, no migration)
  so the radar can colour by SNR.
- **Theme-aware.** The canvas palette is resolved from the app's theme tokens at
  render time and repaints on theme change; SNR colours stay theme-independent.
  New i18n keys added to en/nl/de.
- Verified: backend `ruff check` / `ruff format --check` / `pyright` clean and
  `pytest tests/test_packets_signal_endpoints.py` (7 passed, incl. new `best_snr`
  assertion); frontend `lint` / `prettier` / `build` clean and `test:run`
  (1727 passed, incl. new radar unit tests and i18n parity). Runtime-verified
  live on `http://127.0.0.1:8000/#node` after rebuilding the local container:
  the radar rendered 11 real directly-heard neighbours coloured by SNR, the +
  range-zoom rescaled the rings (1.0x to 2.3x), the hover tooltip showed the
  per-node stats, and the canvas repainted correctly when switching between the
  dark and light themes. Wheel over the canvas was confirmed to zoom without
  scrolling the page (scroll position unchanged). Drag-pan, double-click reset,
  and the live 20m auto-refresh were NOT explicitly click-tested in the browser
  (the underlying view-transform helpers are unit-tested).

## Update 2026-09-20 (Signal-audio Firefox playback fix, sound-behavior-localhost)

### Packet-feed sound (frontend)
- **Fixed inconsistent packet-feed sound in Firefox.** Each incoming packet's
  click was scheduled at exactly `AudioContext.currentTime` (zero lead) whenever
  packets arrived sparsely (one at a time, the common case). A click laid down at
  `currentTime` races the audio render quantum: by the time the audio thread
  processes it, `currentTime` has advanced past it and its whole gain envelope is
  in the past. Chrome recomputes the ramp and plays it anyway; Firefox collapses
  the envelope and drops the click, so playback was intermittent. `onPacket` now
  floors the scheduling time at `currentTime + MIN_LEAD_S` (20 ms, inaudible), so
  every click's envelope stays in the future. Applies to all three themes
  (geiger/sonar/waterdrip), which share the same scheduling path. No backend
  change, no migration, no new strings.
  Verified: Chrome baseline instrumented live on `http://127.0.0.1:8000/#raw`
  (context running, clicks fired per packet, scheduling lead measured at 0 ms
  before the fix); 15 vitest cases pass (new guard on the minimum lead); lint,
  prettier, and build clean. NOT VERIFIED in Firefox (no Firefox automation
  available).

## Update 2026-09-20 (Partial-node resolution: promote on apply, contact-info-desktop-layout follow-up)

### Partial-node resolution (backend + frontend)
Follow-up to #152.
- **Applying a resolution now promotes the node to a full contact** so its
  resolved name/location apply live across the app (sidebar, map, paths), instead
  of only showing on the contact info page. `POST /api/partial-resolutions/apply`
  records the soft link (provenance / map disambiguation), creates the full
  contact from the external-map node, runs `promote_prefix_contacts_for_contact`
  to merge the placeholder in, and broadcasts `contact` / `contact_resolved` WS
  events (live, no restart). Returns `{applied, promoted}`.
- **Resolved name/location go in the advertised fields**, so once the node is
  heard advertising over RF with a different name, the normal radio-sync path
  overwrites the guess. An already-existing full contact is never overwritten.
- **Review modal**: a row is now pre-checked when its best candidate is within
  15 km of the prefix's located path-neighbours (a close, likely-correct match),
  in addition to unambiguous single-candidate rows.
- `ExternalMapRepository.get(pubkey)` added.

## Update 2026-09-20 (Full-page desktop contact info, contact-info-desktop-layout)

### Contact info (frontend)
- **Full-page contact info on desktop.** Opening a contact's info on a desktop
  viewport (`min-width: 769px`) now navigates to a routed full-page view
  (`#contact-info/<pubkey>/<label>`) instead of the narrow 400px right-side
  panel, which wasted most of a wide screen. The page centres in a max-width
  container and lays the sections out in three curated columns: "Identity &
  actions", "Your data & telemetry", and "Network & activity". Mobile
  (`max-width: 768px`) is unchanged and keeps the existing side-panel Sheet.
- **Repeater/room links no longer dead-end on a login screen.** On desktop, a
  shared `#contact/<pubkey>` link for a repeater or room server now lands on the
  combined full-page info view rather than the bare `RepeaterDashboard` /
  `RoomServerPanel` login. The login + dashboard is embedded inline as a
  **minimizable** region at the top of the page (expanded by default; a slim bar
  when collapsed). Regular-client and sensor links are unaffected; their DM chat
  is unchanged.
- Internals: the pane's section stack was extracted into a shared
  `ContactInfoBody` (region-aware) used by both the mobile `ContactInfoPane`
  Sheet and the new desktop `ContactInfoView`; a shared `useContactInfoData`
  hook loads analytics + telemetry for both. The repeater dashboard body was
  extracted into `RepeaterDashboardBody` so the standalone view (mobile) and the
  embedded region share one implementation. New `contact-info` conversation type
  + hash route wired through `urlHash`, `useConversationRouter`, and
  `useConversationNavigation` (which forks on `useIsMobile()`). No backend
  change, no migration. New i18n keys in EN/NL/DE.

## Update 2026-09-20 (Sync node info for partial IDs, node-info-sync-partial-ids)

### Partial-node resolution (backend + frontend)
- **New "Sync partial nodes" tool** in Settings > Radio-App Management. It matches
  nodes we only hold partial info for (prefix-only placeholder contacts, and
  1/2/3-byte hop hashes seen in advert paths but never heard through a full
  advert) against the already-synced external-map cache, and lets the user review
  and edit the proposed matches before anything is saved. Confirmed matches are
  stored as reversible **soft resolution links** (prefix -> full pubkey); the
  authoritative `contacts` table is never written.
- **Review modal** (`PartialNodeSyncModal`): one row per resolvable prefix with a
  confidence badge and "seen as" (placeholder / path / both). Unambiguous
  (single-candidate) rows are checked by default; ambiguous rows show a candidate
  dropdown and are opt-in. Unmatched prefixes are listed in a collapsed group.
  Apply persists only the checked rows.
- **Scoring** (`app/services/partial_resolution.py`, pure): a unique candidate is
  high-confidence (0.8/0.9/1.0 for 1/2/3-byte prefixes); ambiguous candidates are
  ranked and scored by prefix width, candidate count, and distance from the
  prefix's located path-neighbours (the located nodes adjacent to it in the advert
  paths where it appears).
- **Read-time enrichment (soft links shown, never as advert-heard identity):**
  - `ContactInfoBody` (the shared contact-info body used by both the mobile
    `ContactInfoPane` sheet and the desktop `ContactInfoView`) shows the
    soft-resolved node for a prefix-only contact with a "Clear resolution" control,
    and the external-analyzer lookup button (previously hidden for prefix-only
    contacts) now appears once resolved, using the resolved full pubkey.
  - The advert-links map resolver (`resolve_advert_edges`) uses a confirmed soft
    link to disambiguate an ambiguous hop to the chosen node (non-ambiguous).
  - The Mesh Health Prefix Collisions tab badges a group whose prefix has a soft
    resolution.
- Backend: migration `_099_create_partial_node_resolutions` (new
  `partial_node_resolutions` table, keyed by `prefix_hex`; `LATEST_SCHEMA_VERSION`
  -> 99), `PartialResolutionRepository`, router
  `app/routers/partial_resolution.py` (`GET /api/partial-resolutions/preview`,
  `POST /apply`, `GET`, `DELETE /{prefix_hex}`), plus
  `ExternalMapRepository.all_identities` and `ContactRepository.prefix_only_keys`.
- i18n: new `partial_sync_*` keys in EN/NL/DE.

## Update 2026-09-20 (Mesh Health prefix-collisions tab, feat/mesh-health-prefix-collisions)

### Mesh Health (backend + frontend)
- **New "Prefix Collisions" tab on the Mesh Health page.** Lists local contacts
  that share the same public-key prefix at 1-byte, 2-byte, and 3-byte widths (a
  hop hash in an advert path is a prefix of a node's public key, so a shared
  prefix makes that hop ambiguous to resolve). A width sub-selector pill (1b/2b/3b)
  switches the view. The tab is contacts-only and point-in-time, so the shared
  time-range selector is hidden while it is active. Layout follows the
  ON8AR/CoreScope analyzer's collision view.
- **First-byte usage matrix.** A 16x16 grid of the 256 possible first bytes, each
  cell coloured by the worst collision within it at the selected width (available
  / one node / possible conflict / collision). Clicking a cell filters the list
  below to that first byte. Summary tiles show full-key node count, prefix space
  used (distinct prefixes over 256^width), colliding prefixes, and nodes in
  collisions.
- **Collapsible collision list.** Each colliding prefix is a collapsed row (prefix
  + node count) that expands to the clashing contacts and their coordinates. Each
  contact is a link that opens its node detail page (contact conversation).
- **Distance / risk assessment.** Each colliding prefix shows the farthest-apart
  distance between its located nodes and a Local/Regional badge (a collision only
  matters over RF when the nodes are physically close; heuristic threshold 50 km).
  Nodes at exact (0,0) "null island" are treated as unlocated so they do not
  inflate distances. Uses the effective location (manual override wins).
- Backend: new read-only endpoint `GET /api/packets/prefix-collisions`
  (`app/routers/packets.py`) backed by a pure grouping function
  (`app/services/prefix_collisions.py`, returns per-width groups + a 256-entry
  first-byte severity matrix + distinct-prefix count) and
  `ContactRepository.full_key_identities` (full 64-hex keys only, so prefix-only
  placeholder contacts do not create phantom collisions). Severity is count-based
  (this fork does not track a node's configured hash size). No schema migration.
- Frontend: new `MeshPrefixCollisionsPanel`; tab wired into `MeshHealthView`, node
  navigation threaded through `ConversationPane` (`onOpenNode`), new i18n keys
  (EN/NL/DE). Gates green (backend ruff / ruff-format / pyright / pytest incl. new
  prefix-collision tests; frontend eslint / prettier / vitest incl. i18n parity /
  build) and runtime-verified in the local container.

## Update 2026-09-20 (Packet pages: autoscroll hold, pause, fold repeats, packet-pages-auto-scroll)

Applies to both packet tabs (Raw Packet Feed and Packet History), which share
the `RawPacketList` component.

### Raw Packet Feed + Packet History (frontend)
- **Autoscroll off now holds your place.** With newest-first sort, new packets
  are prepended at the top; the browser left `scrollTop` unchanged, so the rows
  you were reading kept getting pushed down (the newest packet kept appearing in
  view even with autoscroll off). `RawPacketList` now compensates `scrollTop` by
  the height the list grew, in a `useLayoutEffect`, so the same rows stay put.
  Oldest-first was already stable (new rows append below the fold) and is
  unchanged.
- **Pause button** on both tabs. Pausing freezes the visible list to a snapshot;
  incoming packets keep buffering in the background and are counted behind a
  "N new" badge, then revealed on Resume. On Packet History the button is only
  active in a live preset (a fixed custom range never streams) and any snapshot
  is dropped when leaving live mode. Session-only, not persisted. EN/NL/DE
  strings added (`packet_pause`, `packet_resume`, `packet_paused_new`).
- **"Group repeats by content" now works.** The Filters-modal toggle was
  previously inert (state + badge only, never applied). It now collapses packets
  that share content (the same packet heard across different paths) into one row,
  badged with the number of copies (`×N`). The fold key is the path-independent
  payload (header/path stripped via `analyzeStructure`), cached per packet;
  undecodable frames only group with a byte-identical twin. New util
  `utils/rawPacketContent.ts` (`getRawPacketContentKey`, `foldPacketsByContent`)
  and a `groupByContent` prop on `RawPacketList`. EN/NL/DE `packet_fold_copies`.
## Update 2026-09-20 (Telemetry overlay fix + node battery/temperature block, fix/telemetry-layer-map)

### Node Map telemetry overlay (frontend)
- **Fixed: the telemetry overlay rendered nothing.** The battery/temperature
  badge layer used a 3-font `text-font` stack (`Noto Sans Regular, Open Sans
  Regular, sans-serif`). MapLibre requests one combined glyph pbf for the whole
  stack, which 404s on the OpenFreeMap/Nova glyph servers, and a missing glyph
  drops the entire symbol (icon included), so no badge ever painted. Now uses the
  single-font `NODE_LABEL_FONT` constant, the same fix already applied to node
  labels in PR #117.
- **Badge repositioned under the node**: the battery glyph now hangs just below
  the node circle with the temperature stacked beneath it (was overlapping the
  node with the text off to the side). Age moved off the badge into the popup;
  staleness is still shown by the faded opacity.
- **Telemetry loads regardless of the overlay toggle** so the popup can show
  known readings even when the overlay is off (fetched once on map load; the
  interval refresh still only runs while the overlay is on).

### Node click popup (frontend)
- **Compact telemetry block** in the node-click popup, shown only when a reading
  is known: battery (percent + volts) and temperature on their own lines, plus a
  relative "telemetry N ago" line.
- **"Show history" toggle** that reveals a compact telemetry history line chart
  (`TelemetryPopupChart`) with a per-metric selector (voltage, temperature, …),
  matching the detail-pane chart style. Fetched read-only via
  `GET /contacts/{key}/telemetry-history` (no radio request); mounted into the
  MapLibre popup via `createRoot` and unmounted on popup close.

### Latest telemetry endpoint (backend)
- **Contact battery now surfaced** from telemetry. `GET /contacts/telemetry/latest`
  read `battery_volts` only from the top-level field, which contacts never set
  (they report battery as an LPP `voltage` sensor), so contact battery was always
  `null`. Added `_extract_voltage` / `_latest_battery_volts` to fall back to the
  LPP `voltage` sensor, mirroring `_extract_temperature`. Repeaters keep their
  existing top-level `battery_volts`.

## Update 2026-09-19 (Signal-audio "click to enable sound" hint, fix/signal-audio-unlock-hint)

### Raw Packet Feed (frontend)
- **"Click to enable sound" hint** on the Raw Packet Feed. Browsers keep the
  AudioContext suspended until the first user gesture, so with sound persisted on
  the per-packet audio stayed silent after a fresh load until the user happened to
  interact (e.g. changing the theme). `useSignalAudio` now reports `needsGesture`
  (sound enabled but context not yet resumed) via a new tested `isRunning()` on
  the audio engine, and the feed shows a small hint next to the sound controls
  until the first interaction resumes audio. EN/NL/DE strings added. No behavior
  change to the audio itself (the #141 geiger makeup-gain fix is unchanged).

## Update 2026-09-19 (Packet History search + scroll controls, feat/packet-history-scroll-search)

Builds on the Packet History browser (feat/packet-history-browser).

### Packet History (frontend)
- **Message search box** in the Packet History header, distinct from the
  existing hex-on-bytes filter. Matches decrypted message content
  (message text, sender name, channel name), case-insensitive, across the whole
  queried range via a new `search` param on `GET /api/packets/history`. Live
  presets also match appended live packets on the same fields (their WS
  `decrypted_info`), so live and historical rows behave identically. Search
  state is ephemeral (not persisted) and kept out of the Filters-modal badge.
- **Floating "scroll to top / bottom" buttons** over the packet list, shown only
  while the list overflows (each end hides when already there). Opt-in via a new
  `showScrollToEnds` prop on `RawPacketList`, so the live feed is unaffected.
  Buttons are one-shot scrolls and do not change the autoscroll checkbox.
- **"All time" range option** (next to Custom) so search reaches the whole
  database, not just a rolling window. Reuses the existing `time_range_all`
  string and the resolver's no-lower-bound support (`ALL_TIME_RANGE`,
  `startTs: 0`); scoped to the Packet History view via `extras`.
- **Each row now shows the calendar date** alongside the time (the history view
  can span days). Opt-in via a new `showDate` prop on `RawPacketList`, so the
  live feed stays time-only.
- **Row selection + CSV export.** A checkbox per row plus a Select all /
  Deselect all toggle and a selected-count; an "Export CSV" button downloads the
  selected packets (timestamp ISO + Unix, payload/route type, SNR, RSSI,
  decrypted, decoded summary, resolved path, raw hex) via a new pure
  `buildPacketCsv` helper (UTF-8 BOM, mirrors the telemetry CSV pattern).
  Selection covers currently-loaded rows.

### Packet History (backend)
- **`GET /api/packets/history` gains a `search` param**: joins the linked
  `messages` row (and `channels` for the channel name) and matches
  `text` / `sender_name` / channel `name` (case-insensitive substring). Only
  packets linked to a decrypted message can match; existing time-window, cursor
  paging, and payload-type / hop-width / hex filters are preserved. No schema
  change.

## Update 2026-09-19 (Mesh Health warnings count flood adverts only, feat/mesh-health-flood-adverts)

### Mesh Health (backend + frontend)
- **Mesh Health advert warnings now count flood-routed adverts only.** Previously
  the HIGH (> 8/window) / MEDIUM (> 2/window) thresholds were evaluated against a
  contact's total advert count (direct + flood). Direct adverts (heard at zero
  hops) are expected and happen far more often by default, so they no longer
  raise a warning. `get_mesh_health` (`app/routers/packets.py`) now tests the
  `flood` count against the same thresholds, and each `MeshHealthAlert`'s
  `advert_count` / `adverts_per_hour` report the flood-advert figure that
  triggered it (direct and total counts are still returned per contact for
  context). In `MeshAdvertsPanel`, the alert-row highlight is driven by
  `flood_count` and moved onto the Flood column; the Total column is now plain.
  Threshold/alert wording updated to say "flood adverts" (EN/NL/DE). No schema
  change. Gates green (backend pytest incl. mesh-health endpoints / ruff;
  frontend tsc / eslint / prettier / vitest / build).
- **The HIGH / MEDIUM alert headings now show the active time window** (e.g.
  "· last 24h"), reusing the existing `mesh_health_stat_sub_last_window` string.
  The alert counts and adverts/hour are computed over the window selected at the
  top of the page, but that window was only echoed in the summary tiles, not next
  to the alerts, so users could not tell what span a rate like "0.1/hr" covered.
  Frontend-only, no new i18n keys.

## Update 2026-09-19 (Basemap picker as a dropdown, feat/map-layer-dropdown)

### Node Map (frontend)
- **The Display FAB's basemap picker is now a dropdown instead of a vertical
  radio list.** With 13 basemaps the list dominated the Display panel; the
  `layers` section in `MapControls` now renders a native `<select>` (styled like
  the playback-bar lookback control) in place of the `radiogroup` of buttons.
  Selecting an option calls the same `onSelectBasemap` and switches the basemap;
  no state, persistence, or basemap definitions changed. The picker no longer
  auto-closes the panel on selection (native select behavior). Runtime-verified
  in-browser (Nova to Satellite (Esri) switches the map). Gates green (tsc /
  eslint / prettier / vitest 18 in mapControls / build).

## Update 2026-09-19 (Packet History browser + raw-packet retention, feat/packet-history-browser)

Closes #86.

### Packet History (frontend)
- **New "Packet History" tool under the Tools sidebar group** for browsing the
  full persisted `raw_packets` history, styled like the live packet feed.
  Preset windows (1 / 3 / 6 / 12 / 24 h, and the other shared presets) plus an
  explicit date-to-date custom range via the shared `TimeRangeSelector`. New
  `PacketHistoryView` + `usePacketHistory` hook; routing, sidebar row, and
  EN/NL/DE i18n added mirroring the Mesh Trends / Analyze Packet views.
- **Cursor paging** ("Load older") walks backward through history by `id`;
  **server-side filters** (payload type, hop-byte width, hex substring) reuse
  the feed's `usePacketFilters` + `PacketFilterModal` and apply across the whole
  queried range. Presets are **live** (new packets append); a closed custom
  range is a static historical view.
- **Path-hex hops now resolve to contact names** (unique-prefix match only, raw
  hex when ambiguous/unknown) in the packet feed, the history browser, and the
  packet detail dialog via a shared `resolvePathHopNames` helper.
- **Sort order control (Oldest / Newest first)** in the Packet History header,
  mirroring the Raw Packet Feed's, server-persisted independently via a new
  `packet_history_sort` setting (migration `_098`).

### Raw-packet retention (backend)
- **New `raw_packet_retention_days` setting** (Settings > Database), `0` = keep
  forever (default). A positive value prunes `raw_packets` older than the window
  daily (`raw_packet_pruner`, mirroring the advert pruner) and bounds how far
  back the Packet History browser can reach. Migration `_097` adds the column.
- **New `GET /api/packets/history`** endpoint: inclusive time window, `before_id`
  cursor, and server-side `payload_types` / `hop_widths` / `hex` filters mapped
  to the stored columns; leaves the feed-seeding `/packets/recent` untouched.

## Update 2026-09-19 (Packet feed sort order, feat/packet-feed-sort)

### Raw Packet Feed (frontend + backend)
- **The Raw Packet Feed has a Sort order control (Oldest first / Newest first).**
  The feed previously always rendered oldest-first (newest at the bottom);
  `RawPacketList` now takes a `newestFirst` prop and orders accordingly, and
  autoscroll sticks to the newest packet's edge in either direction (bottom for
  oldest-first, top for newest-first). A `<select>` in the feed header, next to
  the Filters button, drives it. The choice is persisted server-side in
  `app_settings.packet_feed_sort` (migration `_096`, `LATEST_SCHEMA_VERSION` 96;
  defaults to `oldest`, preserving prior behavior) so it survives refreshes and
  syncs across devices, following the `sidebar_favorite_sort_orders` pattern.
  Unknown values are ignored on PATCH so a stale client can't corrupt the
  setting. New i18n keys `packet_sort_label` / `packet_sort_oldest` /
  `packet_sort_newest` (EN/NL/DE). Gates green (backend pytest incl. migration
  096 + API round-trip / ruff; frontend tsc / eslint / prettier / vitest 1626 /
  build).

## Update 2026-09-19 (Make the packet-feed Geiger sound audible, fix/geiger-sound-packet-feed)

### Signal audio (frontend)
- **The Geiger sound theme on the raw packet feed was effectively silent while
  Sonar and Water drip were clearly audible.** The Geiger click is a short
  band-passed white-noise burst; the band-pass filter (`Q = 1.6` at 1800 Hz) on
  unit-variance noise attenuates the click to roughly a fifth of its envelope
  target, so although the gain envelope aimed at `PEAK * level ≈ 0.8`, the actual
  output peaked near 0.08 (vs ~0.48 for the oscillator themes) and was inaudible
  at normal volume. `playGeiger` (`lib/signalAudioEngine.ts`) now applies a
  `GEIGER_MAKEUP_GAIN` of 5 to the envelope target, bringing the click's peak to
  ~0.50, matching Sonar/Water drip. Root cause and both levels measured by
  rendering the exact node graph in an `OfflineAudioContext`; the pre-fix
  live-injection path was verified in-browser (real WebSocket `raw_packet` frames
  produce Geiger buffer-source clicks). New regression test asserts the Geiger
  envelope target is lifted above 1. Gates green (tsc / eslint / prettier /
  vitest 1623 / build).

## Update 2026-09-19 (Persist Mesh Health sub-tab, fix/mesh-health-tab-persist)

### Mesh Health (frontend)
- **Refreshing the Mesh Health page now keeps the Adverts/Requests sub-tab you
  were on instead of snapping back to Adverts.** `MeshHealthView` held the
  active tab in un-persisted `useState`; it now restores the last-used tab from
  `localStorage` (`rtfm-meshhealth-tab`), mirroring how the time-window selector
  already persists. A `focusKey` navigation (jump to a specific advert node)
  still forces the Adverts tab. Runtime-verified in-browser (switch to Requests,
  reload, stays on Requests); gates green (tsc / eslint / prettier / vitest 1623
  / build).

## Update 2026-09-19 (Fix chart-hover crash on zoom, fix/chart-hover-stale-index)

### Charts (frontend)
- **Fix a crash that blanked the whole page when zooming/panning the Request
  volume chart (Mesh Health) or the Airtime chart (My Node) after hovering.**
  Both charts keep the hovered index in state; zoom/pan hands the chart a shorter
  sliced array, so the retained index pointed past the end and `series[hov]` /
  `samples[hov]` was `undefined`, throwing `Cannot read properties of undefined`
  and unmounting the app. Both now read the hovered item defensively (`hov <
  length ? arr[hov] : null`) and skip the tooltip when the index is stale, the
  same guard the sibling charts already use. Runtime-verified in-browser
  (hover + repeated zoom in/out + drag-pan + double-click reset, no crash);
  gates green (tsc / eslint / prettier / vitest 1623 / build).

## Update 2026-09-19 (Chart hover tooltips + Mesh Health zoom, claude/airtime-graph-hover-info-c79e8b)

### Charts (frontend)
- **Airtime utilization chart (My Node) now shows a hover tooltip.** It was the
  only My Node chart without one; `AirtimeLineChart` (`components/MyNodeView.tsx`)
  gained per-sample hover zones + a tooltip showing `RX x% / TX y%` and the
  sample time, with RX/TX marker dots, matching the sibling charts. Zoom already
  worked (it was already wrapped in `ZoomableBinChart`).
- **Mesh Health "Request volume over time" chart is now hoverable and
  zoomable.** `VolumeChart` (`components/MeshRequestsPanel.tsx`) gained per-bucket
  hover zones + a tooltip (bucket time + Flood/Direct/Resp counts), and the call
  site now wraps it in the existing `ZoomableBinChart` for per-graph wheel-zoom /
  drag-pan / dbl-click reset (index-window, same as the My Node charts).
- **Mesh Health "SNR vs RSSI" scatter is now hoverable and 2-D zoomable.**
  `ScatterPlot` (`components/MeshAdvertsPanel.tsx`) gained nearest-point hover
  (highlight + `RSSI r / SNR s` tooltip) and true 2-D zoom/pan (wheel zooms both
  axes about the cursor, drag pans, dbl-click resets), clamped to the full data
  extent and clipped to the plot rect.
- **New shared zoom primitives** (the existing 1-D index-window core cannot
  express a point-cloud zoom): pure `lib/chartZoom2d.ts` (domain box +
  `clampBox` / `zoomBoxAtPoint` / `panBox`, composing the tested 1-D
  `chartZoom.ts` per axis) and a React wrapper `components/charts/SvgZoomBox.tsx`
  (the 2-D analogue of `SvgZoomFrame`).
- i18n: new tooltip keys in EN/NL/DE (`mesh_health_scatter_tooltip`,
  `mesh_health_req_tooltip_flood` / `_direct` / `_responses`); the Airtime
  tooltip reuses `node_chart_airtime_stat`.
- Tests: `src/test/chartZoom2d.test.ts` (6) and `src/test/svgZoomBox.test.tsx`
  (4). Gates green: eslint (0 errors) / prettier / tsc / vitest (1623) / build.
  Runtime-verified in the browser: hover tooltip on all three charts, 2-D zoom
  on the scatter, index zoom on the volume chart.
## Update 2026-09-19 (Mesh Trends page consolidates stats, feat/mesh-trends-page)

### New Mesh Trends Tools view (frontend, closes #83 and #84)

- **Added a "Mesh Trends" view to the Tools sidebar** with two tabs, Live and
  Historical (default Historical, remembered per-device in localStorage under
  `rtfm-mesh-trends-tab`). It consolidates the two previously separate stats
  surfaces:
  - **Historical tab** hosts every block relocated from the removed Settings >
    Statistics section (`MeshTrendsHistoricalPanel`): network / message / activity
    counts, packet totals, per-broker MQTT stats, packets-per-hour (72h),
    path-hash width (24h), region-scope adoption (24h), busiest channels, and the
    noise-floor chart. Data still comes from `GET /api/statistics` (unchanged).
  - **Live tab** hosts the session stats that used to be built into the raw packet
    feed (`PacketFeedStatsPanel`): coverage, time-range selector, per-minute /
    unique-source / decrypt-rate / path / neighbour tiles, the traffic timeline,
    and the ranked type/route/hop/RSSI and neighbour lists. It reads the app-wide
    `rawPacketStore` session, so it stays populated regardless of which view is
    open.
- **Removed the Statistics section from Settings** (`SettingsStatisticsSection`
  deleted; `statistics` dropped from `SettingsSection`, the section order, labels,
  icons, and the URL-hash settings-section list). Old `#settings/statistics`
  deep-links now fall back to the default settings section.
- **Slimmed the raw packet feed**: the Show/Hide stats drawer and the stats
  `<aside>` are gone, and the recharts dependency and stat sub-components moved out
  with them. The feed keeps its list, hex/hop-width Filters modal, per-packet
  inspector, and signal audio.
- **Promoted "Analyze Packet" to its own Tools view** (`AnalyzePacketView`),
  placed after the packet feed. The paste-a-hex inspector body was extracted into
  a shared `RawPacketPasteInspector` reused by both the standalone view and the
  existing packet-detail dialog; the feed's Analyze button was removed.
- Charts keep interactive zoom/pan/hover: the historical noise-floor and
  packets-per-hour charts retain their `ZoomableChart` wrapping; ranked/categorical
  bars keep hover only (no zoom).
- Sidebar: two new reorderable/hideable tool rows (`mesh-trends`, `analyze`);
  routing (`#mesh-trends`, `#analyze`) restores on refresh and back/forward.
- i18n: added `nav_mesh_trends`, `nav_analyze_packet`, `mesh_trends_tab_live`,
  `mesh_trends_tab_historical`, `common_loading_mesh_trends`,
  `common_loading_analyze_packet` (EN/NL/DE); removed the now-unused
  `settings_section_statistics`.
- Tests: new `meshTrendsView`, `packetFeedStatsPanel`, and `analyzePacketView`
  suites; the raw-feed and settings-modal suites were trimmed of the relocated
  behaviour; startup-hash restore cases added for both new views.
- Gates green (rebased on #137): frontend tsc / eslint (0 errors) / prettier /
  vitest (1622) / build. No backend changes and no migration.

## Update 2026-09-19 (Manual location overrides show in paths, fix/manual-location-in-paths)

### Map + advert-links (backend + frontend)
- **A manual location override now places a node in the map's link/path layers,
  not just as a marker.** A repeater/node with only a manual override (no
  advertised GPS) already showed as a map marker (via `getEffectiveLocation`)
  but was dropped from every path/link, because both link resolvers still read
  the raw advertised `lat`/`lon`.
- Backend: `AdvertLinksRepository.located_nodes()`
  (`app/repository/advert_links.py`) now resolves the effective location
  (advertised-wins, manual-fallback, `(0, 0)` treated as unset) via a new
  `_effective_latlon` helper, so a manual-only contact is a valid advert-link
  edge endpoint and `GET /packets/advert-links` draws edges to it.
- Frontend: `MapView`'s link-coordinate resolver now delegates to a new pure
  `resolveNodeCoord` in `utils/pathUtils.ts` (uses `getEffectiveLocation`
  instead of raw `lat`/`lon`), so the liveness-links layer and packet-path
  pulses include manual-only nodes.
- Frontend: the "Discover nodes" packet-reveal path (`resolvePacketContacts` in
  `MapView`) now gates on the effective location via a new `hasEffectiveLocation`
  helper, so a manual-only node is revealed by packet playback in discovery mode
  too (was advertised-only).
- Tests: 4 new backend cases (`tests/test_advert_links_endpoint.py`, incl. an
  endpoint test asserting a manual-only node is a drawn path edge endpoint) and
  11 new frontend cases (`src/test/effectiveLocation.test.ts` for
  `resolveNodeCoord`, `src/test/resolvePacketContacts.test.ts` for discovery
  reveal).
- Gates green: backend ruff / ruff format / pyright / pytest (2123); frontend
  eslint (0 errors) / prettier / vitest (1613) / build.

## Update 2026-09-18 (Interactive chart zoom/pan, feat/chart-zoom-scaling)

### Time-series charts (frontend)
- **Charts now zoom and pan like the DutchMeshCore-Observers charts.** Scroll
  (wheel/trackpad) zooms the visible x-window toward the cursor, drag pans it,
  and double-click resets to the full range. Ported from
  `DutchMeshCore-Observers/web/js/lib/svgchart.js` (`barViewClamp` +
  `bindTimeZoom`), generalized to an arbitrary `[min,max]` domain.
- The interaction math lives in one pure, unit-tested module
  (`frontend/src/lib/chartZoom.ts`: `clampWindow` / `zoomAtFraction` /
  `panByFraction`), driven by two adapters so both chart systems behave
  identically:
  - `useChartZoom` hook + `ZoomableChart` wrapper for the Recharts charts
    (controls a numeric `XAxis` `domain` + `allowDataOverflow`).
  - `SvgZoomFrame` for MyNodeView's custom inline SVG charts (index-space
    window; slices `bins` to the visible range).
- **Each graph has its own independent zoom window** (`ZoomableBinChart` for the
  custom-SVG charts): zooming one chart no longer moves the others.
- Applied to: repeater telemetry history and neighbor-signal charts, the
  contact activity + telemetry-history charts, the Settings > Statistics area
  charts, and **all** My Node charts - bytes / packets / packets-by-type / SNR /
  RSSI / noise-floor / airtime / battery (the line charts included).
- **Airtime utilization chart now auto-scales its Y axis** to the visible peak
  (nice 1/2/5x10^k bound, capped at 100%) instead of always showing a full
  0-100% range, so low utilization is readable (`niceCeilPct`).
- New i18n key `chart_zoom_hint` (EN/NL/DE) shown as the chart tooltip.
- Gates green (tsc, eslint 0 errors, prettier, 1600 vitest incl. new
  `chartZoom` + `SvgZoomFrame` tests, vite build). Runtime-verified in the live
  build: wheel-zoom narrows a chart toward the cursor while its neighbours stay
  put (independent windows), drag pans, double-click resets, the line charts
  (SNR/RSSI/noise/airtime/battery) zoom, and the Airtime axis auto-scales
  (e.g. 0-5% instead of 0-100%).
- Not included (follow-up): the radar view (tracked separately).

## Update 2026-09-18 (Per-favorite-group sort, feat/favorites-per-group-sort)

### Sidebar favorites (frontend + backend)
- **Each favorite sub-group now has its own sort toggle.** Previously the
  Favorites section had a single recent/alpha toggle applied to every group.
  That toggle is removed from the parent Favorites header; instead each visible
  sub-group header (Favorite Channels / Companions / Repeaters / Rooms / Sensors)
  gets its own recent (⏱) / alpha (A-Z) toggle, and each group's rows are sorted
  independently by that group's order
  (`frontend/src/components/Sidebar.tsx`: per-group sorting in the favorites
  memo, `handleFavoriteGroupSortToggle`, generalised sort control in
  `renderSectionHeader`). Reuses the existing `chat_sort_*` i18n keys, so no new
  strings.
- **Per-group sort orders persist server-side** in `app_settings` so they sync
  across devices, matching how the favorites drag-order and hidden overlay moved
  server-side (migrations `_093`/`_094`). New column
  `sidebar_favorite_sort_orders` (migration **`_095`**, `LATEST_SCHEMA_VERSION`
  bumped 94 → 95), a typed `SidebarFavoriteSortOrders` model (mirrors
  `SidebarHidden`), repository read/parse + update passthrough, and the
  `PATCH /api/settings` request field. Empty object / unknown values reconcile to
  all-`recent` on the client (`resolveFavoriteSortOrders` in
  `frontend/src/utils/sidebarLayout.ts`).
- Gates green: backend `ruff check`/`ruff format --check`, migration + settings
  API tests (119 passed); frontend tsc, eslint, prettier, `vitest run` (1588
  passed incl. new per-group-sort and resolver tests) and `vite build`. Runtime
  against the live app NOT observed.

## Update 2026-09-16 (Analyzer channel help text + neon-node parity, feat/analyzer-channel-help-text)

### Settings > Database (frontend)
- The "External Analyzers" description now documents the channel-URL placeholders
  `{name}` and `{channel}` alongside the existing `{pubkey}` and `{hash}`, as the
  same `<code>` chips, so all three template fields are explained
  (`frontend/src/components/settings/SettingsDatabaseSection.tsx`; new i18n keys
  `settings_db_analyzer_desc_channel_mid` / `_channel_or`, reworded prefix/mid/suffix
  in EN/NL/DE). Follow-up to the per-channel analyzer link feature (#132).

### Map neon nodes (bugfix)
- **Neon nodes are clickable again.** Enabling "Neon nodes" replaced the flat GL
  circle layer's visuals with a deck.gl overlay, but it did so by setting the
  circle layer to `visibility:'none'`, which also removes it from hit-testing, so
  clicking a neon node no longer opened the info popup. The flat `rt-nodes` layer
  is now kept rendered (transparent, `circle-opacity`/`circle-stroke-opacity` 0)
  instead of hidden, so it still hit-tests and node clicks work in neon mode
  (`frontend/src/map/layers/nodesLayer.ts`).
- **Neon nodes honour the node-colour picker / legend.** The neon core drew a
  fixed dark rim and ignored the per-type role colours, so it didn't match the
  legend or the "Node colors by role" picker. The core ring now encodes node type
  via `roleColors` (same source as the flat layer's stroke and the legend); the
  overlay gained `setRoleColors`, wired in `MapView` on create and on change
  (`frontend/src/map/layers/neonNodesLayer.ts`, `frontend/src/components/MapView.tsx`).
- Gates green (tsc, eslint, prettier, 1586 vitest incl. new neon unit tests).
  Runtime-verified on the live map: clicking a neon node opens its info popup, and
  nodes render with recency-tier fill + type-coloured rings.

## Update 2026-09-16 (Per-channel analyzer link, claude/channel-analyzer-links)

### Channel info panel (frontend + backend)
- The per-channel info/stats panel now shows an **"Open channel on <site>"**
  button for each configured analyzer that has a channel URL template, opening
  the channel on that external analyzer in a new tab
  (`window.open(..., '_blank', 'noopener,noreferrer')`). Mirrors the existing
  per-contact "Look up on <site>" action
  (`frontend/src/components/ChannelInfoPane.tsx`, wired via
  `channelInfoPaneProps.analyzerSites` in `frontend/src/App.tsx`).
- Added an optional **`channel_url_template`** to analyzer sites. It supports a
  `{name}` placeholder (channel display name, incl. leading `#` for hashtag
  channels) and/or a `{channel}` placeholder (channel key); the value is
  URL-encoded. New helper `buildChannelLookupUrl()`
  (`frontend/src/utils/analyzerLink.ts`).
- The six built-in analyzer presets ship with verified channel templates: the
  four DMC-analyzer sites (meshcore-analyzer.eu, Cornmeister, MeshCoreNetz,
  MeshDresden) use `#channels?channel={name}`, on8ar uses `#/channels/{name}`,
  and MC-Radar uses `/group-messages?channel={name}`
  (`frontend/src/components/settings/handyInfo.ts`). All six address channels by
  name; none use the key.
- Both analyzer-site editors gained a Channel URL template field: the Handy Info
  Configure dialog (`SettingsHandyInfoSection.tsx`) and the Settings > Database
  analyzer-sites editor (`SettingsDatabaseSection.tsx`, which now also preserves
  an existing channel template when other fields are edited).
- Backend: `AnalyzerSite`, `HandyInfoOverride`, and `HandyInfoCustomEntry` gain
  `channel_url_template`; the settings router validates it is an http(s) URL
  containing `{name}` or `{channel}` (`app/models.py`, `app/routers/settings.py`).
  No DB migration: `analyzer_sites` is a JSON column.
- Gates green: 1584 vitest, backend settings suite (incl. 3 new tests), tsc,
  eslint, prettier, ruff check/format, vite build. Runtime-verified against a
  throwaway backend on a copied live DB: the button renders in the real Public
  channel panel and opens `https://meshcore-analyzer.eu/#channels?channel=Public`.

## Update 2026-09-16 (Favorites always split by type, feat/favorites-always-grouped)

### Sidebar Favorites (frontend)
- The Favorites section is now **always** split into its type groups (Channels,
  Companions, Repeaters, Room Servers, Sensors), at every sort level - not only in
  the former "by type" sort modes. The Favorites sort toggle is now a plain
  recent <-> alpha 2-way cycle (like every other section) that orders items
  *within* each group; the `type-recent`/`type-alpha` modes are retired and any
  persisted value is normalised to recent/alpha
  (`frontend/src/components/Sidebar.tsx`, `frontend/src/utils/conversationState.ts`
  `FAVORITES_SORT_CYCLE`). Frontend gates green (lint, prettier, tsc, 1563 vitest,
  build).

## Update 2026-09-15 (Favorites type separation + reorderable groups, sidebar orders in DB, claude/favorites-separation-ordering-df44aa)

### Sidebar Favorites (frontend)
- Split the Favorites section (in "by type" sort mode) into five type groups:
  Channels, Companions, Repeaters, Room Servers, and a new **Sensors** group.
  Classification now uses the shared `contactPillFor()` helper instead of the
  ad-hoc `favoriteTypeRank`, so favorited sensors are no longer folded into
  Companions (`frontend/src/components/Sidebar.tsx`).
- Added a **Favorites Order** drag list to the Customize-sidebar panel; the five
  favorite groups render in the user's chosen order.
- Added a per-entry **show/hide toggle** (eye icon) to every Customize-sidebar
  list (sections, tools, favorite groups). Hidden entries are omitted from the
  sidebar but stay listed (greyed) in the Customize panel so they can be
  re-shown; visibility persists server-side in `app_settings.sidebar_hidden`
  (migration `_094`).

### Sidebar order persistence (backend + frontend)
- Moved the three sidebar drag orders (section, tool, favorites-group) from
  localStorage to `app_settings` so they sync across devices, reversing migration
  `_051`. New migration `_093` adds `sidebar_section_order`, `sidebar_tool_order`
  and `sidebar_favorites_order` (JSON-array TEXT). A one-time client shim migrates
  any existing localStorage orders to the server. Rail-collapse, per-section sort
  mode, and collapse states remain client-local
  (`app/migrations/_093_add_sidebar_orders.py`, `app/repository/settings.py`,
  `app/routers/settings.py`, `app/models.py`, `frontend/src/hooks/useAppSettings.ts`,
  `frontend/src/utils/sidebarLayout.ts`).
- Hidden-entry visibility (above) shares the same server-persistence path; the
  DragList component gained an optional eye/eye-off toggle reused by all three
  lists (`app/migrations/_094_add_sidebar_hidden.py`,
  `frontend/src/components/sidebar/DragList.tsx`).

## Update 2026-09-15 (Restore My Node / Mesh Health / Channel Registry on refresh, claude/page-refresh-navigation-713850)

### Navigation (bugfix)
- Refreshing the page (or using browser back/forward) while on **My Node**,
  **Mesh Health**, or **Channel Registry** no longer drops the user back to the
  Public channel. These views already wrote their URL hash (`#node`,
  `#mesh-health`, `#channel-registry`), but the startup resolver
  (`useConversationRouter` phase 1) and the popstate handler
  (`resolveConversationFromHash`) had no cases for those hash types, so they fell
  through to the Public-channel default. Added the three missing cases in both
  places (`frontend/src/hooks/useConversationRouter.ts`). Frontend gates green
  (lint, prettier, tsc, build, vitest incl. new App-startup and popstate tests in
  `frontend/src/test/appStartupHash.test.tsx`).

## Update 2026-09-15 (My Node RX airtime via OpenHop REST, claude/node-rx-tx-zero-rx-feaaa3)

### My Node airtime chart (backend)
- Fixed RX airtime always reading 0 on OpenHop nodes. Root cause is upstream:
  OpenHop's companion `STATS_RADIO` frame hardcodes `rx_air_secs = 0` (it tracks
  RX airtime internally but never reports it over that frame), so the local
  cumulative-counter path never sees RX. When the connected node is detected as
  OpenHop **and** the OpenHop REST API is configured, `/statistics/airtime/range`
  now sources TX/RX from OpenHop's `/api/airtime_chart_data` (real per-packet
  time-on-air from its packet DB, RX included), mapping the pre-bucketed
  `rx_ms`/`tx_ms` to the existing `{timestamp, tx_pct, rx_pct}` chart shape. Any
  failure, an unconfigured API, unknown radio params, or a non-OpenHop node fall
  back silently to the local `airtime_history` computation, so nothing changes
  for other radios (`app/routers/statistics.py`,
  `app/services/openhop_api.py::airtime_chart_data`,
  `app/services/airtime_util.py::map_openhop_airtime_buckets`).
- Corrected the chart's caption (`node_chart_airtime_note`, EN/NL/DE): it claimed
  RX airtime was "estimated per parsed packet" (there was no such estimation) and
  now states airtime is reported by the radio (per-packet time-on-air), not
  carrier-sense.
- Tests: mapper unit tests, `OpenHopClient.airtime_chart_data` transport test, and
  endpoint tests for the OpenHop path plus fall-back-to-local on error /
  unconfigured / non-OpenHop. Backend gates green (ruff check + format, pytest);
  frontend i18n parity + build green.

## Update 2026-09-14 (Time-range selector ordering, claude/time-selection-swap-7a724e)

### Time-range selector (UI)
- The shared `TimeRangeSelector` now always renders its main window buttons
  shortest-to-longest by duration, regardless of which slot (`extrasBefore` /
  base / `extrasAfter`) an option came from. This fixes Mesh Health, where the
  `30m` extra was placed before the `20m` base window and read `30m 20m 1h ...`;
  it now reads `20m 30m 1h ...`. Other consumers (Raw Packet Feed, My Node) were
  already ascending and are unchanged. `null`-duration windows sort last
  (`frontend/src/components/TimeRangeSelector.tsx`). Frontend gates green (lint,
  prettier, tsc, vitest); runtime-verified on Mesh Health.

## Update 2026-09-14 (Raw Packet Feed filter modal, claude/filter-modal-bar-declutter-51125e)

### Raw Packet Feed (UI)
- Decluttered the feed header: the payload-type and hop-byte-width checkboxes (and
  their per-item "only" links) moved out of the inline bar into a **Filters** modal
  opened from a single button that shows an **active-filter count** badge. The bar now
  keeps only the hex search, the Filters button, and Autoscroll. The separate mobile
  "Show filters" expand path is gone; mobile opens the same modal.
- Added a **Group repeats by content** toggle to the Filters modal (state + control
  wired here; the grouped-row rendering that collapses the same packet seen across
  different relay paths lands in the follow-up phase).
- Refactor: filter state extracted into a reusable `usePacketFilters` hook and the UI
  into a `PacketFilterModal` component, so a later Packet History view can reuse both
  (`frontend/src/hooks/usePacketFilters.ts`, `frontend/src/components/PacketFilterModal.tsx`).
  New EN/NL/DE strings; frontend gates green (lint, prettier, 1527 vitest, build).

## Update 2026-09-14 (Handy info: links refresh, manual update check, user-managed entries, feat/handy-info-links-refresh)

### Settings > Handy info
- The Handy info section is now split into two tabs: **Configure** (apply-capable
  analyzer presets and region/registry sync sources) and **Links** (open-only
  reference links grouped by category: Community sites, Monitoring & data, Tools,
  Technical, Fun). Requested by Richard.
- Added community/monitoring/tool/technical/fun links: meshcore.io, meshcore.nl,
  dutchmeshcore.nl, meshwiki.nl, mc-spamdetector.nl, analyser.meshwiki.nl,
  observers.dutchmeshcore.nl, triangulator.dutchmeshcore.nl, rx.mesh-hunter.eu,
  the MeshCore protocol spec (swaits.github.io/meshcore-spec), and zweerbericht.nl.
- **User-managed entries**: add, edit, hide, and delete both built-in and custom
  entries (links or apply-capable presets). Built-ins stay defined in code and are
  layered with a persisted overlay (per-id overrides + hidden flag + custom list),
  so a released change to the built-ins still reaches users who have customized;
  "Reset to defaults" clears the overlay. Persisted server-side in a new
  `handy_info` app-settings column (migration `_092`), mirroring `analyzer_sites`.

### Settings > About
- Added a manual **refresh update-check** button next to the commit hash. The
  `/update-status` endpoint gained a `?force=true` that bypasses the 6-hour
  in-memory cache and re-queries the GitHub compare API; the button toasts the
  result (up to date / update available) and is disabled while in flight.

### Backend / migrations
- New `HandyInfoSettings`/`HandyInfoOverride`/`HandyInfoCustomEntry` models and
  `AppSettings.handy_info` field, validated in the settings PATCH handler (http(s)
  URLs; analyzer templates require `{pubkey}`/`{hash}`; category/group/apply-kind
  consistency; duplicate-id rejection). Migration `_092_add_handy_info`
  (`TEXT NOT NULL DEFAULT '{}'`); `LATEST_SCHEMA_VERSION` bumped to 92.

## Update 2026-09-14 (OpenHop management panes: Update, CAD, System, Transport, MQTT, feat/openhop-remaining-mgmt)

### OpenHop (Surface B management)
- Completes the OpenHop REST-management surface begun in PR #108. The
  detection-gated OpenHop settings section now uses a two-row sub-nav: a **Node**
  row (Config, System, Update, CAD) and a **Mesh** row (Policy, Plugins,
  Transport, MQTT). All new panes are additive REST proxies through
  `/api/openhop/*`; no database migration, no config change (the API URL + token
  from migration `_087` are reused). Every route is fail-closed via
  `_require_client` (409 unless the node is detected as OpenHop and a URL + token
  are configured).
- **Update (OTA)** pane: installed/latest version, release-channel selector,
  changelog, and an install that is **confirm-gated** (it triggers a real pip
  upgrade + service restart on the node). Install progress streams live over SSE
  (`/api/openhop/update/progress`).
- **CAD calibration** pane: manual CAD checks with detection metrics, a live
  calibration stream (SSE), and a **confirm-gated** save of calibrated
  peak/min thresholds. Meaningful detection metrics require real LoRa RF
  hardware; against a no-radio node the checks report no detections.
- **System / Hardware** pane: CPU, memory, disk, and uptime tiles from the
  node's psutil stats (auto-refreshed), with a collapsible read-only analytics
  section (packet, packet-type, and noise-floor stats). Requested by Richard.
- **Transport keys + neighbour scopes** pane: list/create transport keys
  (delete is **confirm-gated**), view this node's served scopes and per-neighbour
  learned scopes, and query one neighbour's scopes on demand.
- **MQTT config** pane: MQTT runtime status (read-only), a **confirm-gated**
  write of the whitelisted MQTT observer fields (owner, email, IATA code, status
  interval), and a **confirm-gated** "publish neighbours now" (an outward RF
  cycle that takes minutes).
- Backend: new `OpenHopClient` methods per endpoint (`app/services/openhop_api.py`)
  and gated proxy routes incl. two new SSE passthroughs
  (`app/routers/openhop.py`), all tested with `httpx.MockTransport`. Frontend:
  new panes under `frontend/src/components/settings/openhop/{update,cad,system,transport,mqtt}/`
  with vitest coverage. New `openhop_*` strings translated in EN/NL/DE.

## Update 2026-09-14 (Map: neon nodes, line/arc thickness)

### Map
- New **Neon nodes** toggle in the map Display panel. When on, nodes render as a
  deck.gl halo + bright core (the "neon" look), replacing the flat GL circles;
  the existing packet glow supplies the per-node activity pulse. The flat circle
  layer is hidden while neon is on and the node labels stay on top either way.
  Off by default, per-device (`frontend/src/map/layers/neonNodesLayer.ts`,
  wired through `MapView`; the flat layer gains `setCirclesVisible`).
- New **Packet arc width** and **Link line width** sliders (0.5-4x) in the same
  panel. Arc width multiplies the deck.gl packet-arc width; link width scales the
  liveness and advert link line widths. Both persist per-device
  (`packetDeckOverlay.setArcWidthScale`, `linksLayer`/`advertLinksLayer`
  `setWidthScale`). New strings `map_neon_nodes_label`, `map_arc_width_label`,
  `map_link_width_label` (EN/NL/DE).

## Update 2026-09-14 (Map node labels fixed on vector basemaps)

### Map
- Node name / ID-tag labels now render on the default Nova (and other
  OpenFreeMap vector) basemaps. The label layer requested a multi-font stack
  (`Noto Sans Regular,Open Sans Regular,sans-serif`); MapLibre asks the basemap
  glyph server for that whole comma-joined stack as one key, and the servers we
  use (OpenFreeMap for vector, openmaptiles for raster) only serve pre-generated
  single fonts, so the request 404'd and the labels silently vanished. The layer
  now requests the single font `Noto Sans Regular`, which both servers provide
  (`frontend/src/map/layers/nodesLayer.ts`, exported as `NODE_LABEL_FONT` with a
  regression test).

## Update 2026-09-14 (CRT phosphor themes + universal screen effects)

### Chat / UI
- The four CRT phosphor colours are now first-class themes in the theme picker
  (both the navbar "Color Scheme" dialog and Settings > Customisation): **CRT
  Green**, **CRT Amber**, **CRT White**, **CRT Blue**. Selecting one applies its
  monochrome phosphor palette.
- The CRT screen effects (scanlines, phosphor glow, screen curvature, flicker)
  became a theme-independent overlay shown as toggles beneath the theme grid.
  They now work on top of any theme, not only the CRT ones. Defaults follow the
  active theme: on under a CRT theme, off otherwise; an explicit toggle persists
  across themes. The phosphor glow tints to `--crt-phosphor`, which CRT themes
  set to their hue and other themes fall back to `--primary`.
- The "tint the map to the CRT colour" toggle moved into the same panel; it acts
  only while a CRT theme is active (it needs a phosphor hue) and Nova Dark is the
  chosen basemap.
- The retired single `crt` theme + separate phosphor picker are gone. A saved
  `crt` theme is migrated once to the matching `crt-<phosphor>` theme id.
- Files: `frontend/src/utils/{crt,theme}.ts`, `frontend/src/themes.css`,
  `frontend/src/index.css`, `frontend/src/components/settings/CrtEffects.tsx`
  (replaces `CrtSettings.tsx`), `frontend/src/components/StatusBar.tsx`,
  `frontend/src/components/settings/SettingsLocalSection.tsx`,
  `frontend/src/map/MapSurface.tsx`. i18n: dropped the CRT enable/phosphor keys,
  kept the effect/map keys (EN/NL/DE).

## Update 2026-09-14 (Node icons on top of 3D buildings, claude/node-icon-building-layer)

### Map
- With the 3D building layer enabled, a node icon whose position falls inside a
  building footprint is no longer hidden behind the extrusion. The buildings
  layer is now inserted (or re-seated) just below the node/overlay layers so
  node circles, labels, and external-node markers always draw on top
  (`frontend/src/map/engine/buildings3D.ts`). Buildings still render above the
  basemap; only the map overlays are lifted above them.

## Update 2026-09-14 (Hide nodes reporting wrong location, fix/hide-wrong-location-nodes)

### Map
- New opt-in map toggle "Hide nodes reporting wrong location" (its own FAB
  panel, off by default, stored per-device). When on, it hides any node whose
  nearest resolved advert-link neighbour is more than 300 km away, since mesh RF
  range cannot realistically span that distance. Nodes with no resolvable
  neighbour to measure against are kept visible (fail-open), and the
  focused/searched node is always exempt. Hidden nodes also drop their advert
  arcs so no dangling link remains. New pure helper
  `frontend/src/map/wrongLocation.ts` (`computeWrongLocationKeys`,
  `WRONG_LOCATION_MAX_NEIGHBOR_KM = 300`); wired into `MapView.tsx`
  `mappableContacts`. New strings `map_hide_wrong_location_label` /
  `map_hide_wrong_location_help` translated in EN/NL/DE.

### Backend
- `AdvertLinksRepository.located_nodes()` now excludes the `(0, 0)` sentinel
  (unset GPS, Atlantic Ocean) from the advert-links graph for both contacts and
  external analyzer nodes, so those nodes no longer create bogus RF edges. This
  applies unconditionally, independent of the map toggle
  (`app/repository/advert_links.py`).

## Update 2026-09-13 (Sidebar back-to-top button, feat/sidebar-back-to-top)

### Chat / UI
- The expanded sidebar conversation list now shows a floating "back to top"
  button in its bottom-right corner once the list is scrolled down past ~300px.
  Clicking it smooth-scrolls the list back to the top. It stays hidden at the
  top and on lists too short to scroll, and is also available in the mobile
  drawer. New string `nav_back_to_top` translated in EN/NL/DE
  (`frontend/src/components/Sidebar.tsx`).

## Update 2026-09-13 (Mention & DM notification sound, feat/notification-sound-mentions)

### Chat / UI
- New optional notification sound that plays when you are @mentioned in a
  channel or receive a direct message. Off by default; enabled from
  Settings > Local Configuration, which also offers a sound picker (five bundled
  presets plus an uploaded custom sound), a volume slider, and a Test button.
  The sound is suppressed while you are actively viewing that same conversation
  with the tab focused, and respects muted channels. A per-conversation "mute
  mention sound" toggle lives in the conversation header's notification dropdown
  (channels and DMs), stored per-device. New strings are translated in EN/NL/DE.
- Bundled preset sounds ship under `frontend/public/sounds/` (ID3 tags
  stripped). Custom uploads accept mp3/wav/ogg/m4a/aac up to 256 KB.
- Limitation: browser autoplay policy may block the very first sound on a tab
  that has never received a user interaction; any click/keypress (including the
  Test button) unlocks playback for the session.

### Backend
- Migration `_090` adds `mention_sound_enabled`, `mention_sound_choice`, and
  `mention_sound_volume` to `app_settings`, plus a single-row `mention_sound`
  table holding the uploaded custom sound (BLOB + metadata) so the blob stays
  out of the `GET /api/settings` payload (only its metadata is surfaced).
- New endpoints `POST/GET/DELETE /api/settings/mention-sound` upload, stream,
  and clear the custom sound (256 KB cap, audio type validation). Uploading sets
  the choice to `custom`; deleting resets it to a preset (feat/notification-sound-mentions)

## Update 2026-09-13 (airtime chart, unified time selector, raw-feed history)

### My Node
- New "Airtime utilization" chart on the My Node activity grid: two lines (RX %
  and TX %) over the selected window, 0-100%. The companion firmware already
  reports cumulative TX/RX airtime seconds in the `STATS_RADIO` frame; those
  counters are now persisted every 60s (`airtime_history` table, migration 088)
  and served as per-bin utilization from `GET /api/statistics/airtime/range`,
  computed from adjacent-sample deltas so a radio reboot (counter reset) or a
  disconnect gap does not spike the graph (`app/services/airtime_util.py`,
  `app/repository/airtime_history.py`, `frontend` `AirtimeLineChart`). Note: RX
  airtime is the firmware's per-packet estimate for parsed packets, not a
  carrier-sense busy timer.

### Time-range selection (all analytics pages)
- Unified the four independent time selectors behind one shared component
  (`frontend/src/components/TimeRangeSelector.tsx`, options in
  `frontend/src/utils/timeRanges.ts`) with a common base set
  `20m 1h 3h 6h 12h 24h 48h 3d 7d 14d 30d + Custom (From/To/Apply)`. Each page
  keeps its extras: My Node keeps `1y`; Mesh Health keeps `30m`; Map keeps `All`
  (its presets now derive from the shared base set) and its single "since"
  datetime custom; the Raw Packet Feed keeps its short live windows (`1m/5m/10m`)
  and `session`.
- The selected window (and custom range) is now remembered per page in
  localStorage (`frontend/src/utils/timeRangePreference.ts`; keys
  `rtfm-mynode-window`, `rtfm-meshhealth-window`, `rtfm-rawfeed-window`; Map's
  existing `remoteterm-map-since` now also stores the custom value).

### Raw Packet Feed
- The stat breakdowns can now be shown historically from the database for the
  base windows (up to 30d), not just the in-memory session ring. Route type,
  hop count, hop-byte-width, and the path signature are parsed from each packet's
  header at ingest (no decryption) and persisted on `raw_packets` (migration 089,
  populated at ingest and backfilled for existing rows). A new
  `GET /api/packets/raw-feed-stats` computes the payload/route/hop/hop-byte-width
  /RSSI-bucket breakdowns and counts server-side (`app/services/raw_feed_stats.py`,
  `app/services/packet_decoded_fields.py`). Short/live windows and `session`
  still use the in-memory snapshot; neighbor, timeline, and unique-source cards
  remain live-only (they need decryption) and are noted as such in DB mode.
- New i18n keys for the shared selector labels and the raw-feed historical note
  (en/nl/de).
## Update 2026-09-13 (Per-broker MQTT statistics, feat/mqtt-stats-per-broker)

### Chat / UI
- The Statistics page (Settings > Statistics) gains an MQTT Brokers table, shown
  only when at least one MQTT broker is active. Each row reports the broker name
  and type, connection status (with last error), and cumulative counts of
  messages published, publish failures, and reconnects. New strings are
  translated in EN/NL/DE (feat/mqtt-stats-per-broker)

### Backend
- MQTT publishers now track per-broker publish counters. `BaseMqttPublisher`
  counts messages published, publish failures, and reconnects in memory
  (incremented on the existing publish and reconnect paths, no hot-path DB
  writes) and flushes them as cumulative totals (`baseline + session`) to the
  new `fanout_mqtt_stats` table on the ~60s connection wake and on stop, so
  counts survive restarts. `GET /api/statistics` gains an `mqtt_brokers` field
  (per active MQTT module) via `FanoutManager.get_mqtt_stats()`; a broker's stats
  row is removed when its fanout config is deleted (feat/mqtt-stats-per-broker)

### Database
- Migration `_091_create_fanout_mqtt_stats` adds the `fanout_mqtt_stats` table
  (`config_id` PK, `messages_published`, `publish_failures`, `reconnects`,
  `updated_at`); `LATEST_SCHEMA_VERSION` bumped to 91 (feat/mqtt-stats-per-broker)

## Update 2026-09-13 (OpenHop API token hardening, feat/openhop-detection)

### Security
- The OpenHop REST API token is now write-only. `GET /api/settings` (and every
  other endpoint that returns settings) no longer includes `openhop_api_token`;
  it is masked to null on serialisation via a model field serializer, while
  internal reads and column-based storage are unaffected. A computed
  `openhop_api_token_set` boolean reports whether a token is stored without
  exposing it. `PATCH /api/settings` now keeps the current token when the field
  is sent blank and only updates it when a non-empty value is provided; the
  Settings > OpenHop token input is write-only (starts empty, leave blank to
  keep). Clearing the URL still disables management (feat/openhop-detection)

## Update 2026-09-13 (OpenHop Config pane, feat/openhop-detection)

### Chat / UI
- OpenHop settings gain a third sub-nav tab, Config (after Policy and Plugins),
  shown only when the connected node is detected as OpenHop and an API URL +
  token are configured. It mirrors OpenHop's config page: validate the node
  config (errors/warnings), switch operating mode (forward / monitor / no_tx),
  edit radio parameters (frequency/bandwidth/SF/coding-rate/TX-power/node-name)
  with a preset selector that prefills the form, and back up / restore the full
  config. Radio edits and restore are guarded by a confirm; radio and hardware
  changes surface a restart-required notice with a Restart-node button. Backup
  downloads redacted JSON by default with an opt-in full backup that includes
  secrets (warned). New strings are translated in EN/NL/DE (feat/openhop-detection)

### Backend
- New gated proxy endpoints under `/api/openhop/config/*` (export, validate,
  hardware_options, presets, mode, radio, import, restart) delegate to new
  `OpenHopClient` methods. Fail-closed like the other OpenHop panes: 409 unless
  the node is OpenHop and a URL + token are set; the token is never returned.
  All config endpoints return HTTP 200 with a `success` flag, so the proxy uses
  `_relay` (transport failures map to 502). No migration (feat/openhop-detection)

## Update 2026-09-13 (water-drip audio, CRT section, map tint)

### Packet feed / audio
- New "Water drip" theme for the raw packet feed's per-packet signal audio,
  alongside Geiger and sonar. Each drip is a downward sine "ploop"; the drop's
  depth (base resonant frequency) is chosen by packet type, so a TRACE reads as
  a deep plunk and an ACK as a tight, high plink (`WATER_DRIP_TONES` in
  `frontend/src/utils/signalAudioCore.ts`; `playWaterDrip` in
  `frontend/src/lib/signalAudioEngine.ts`). SNR and per-click jitter still nudge
  the pitch so a burst stays organic. Persisted per-browser like the other audio
  settings.

### Customisation / UI
- CRT controls (enable, phosphor colour, screen effects) are now grouped into a
  single bordered section in Settings -> Customisation instead of sitting as
  loose settings between the theme picker and branding
  (`frontend/src/components/settings/CrtSettings.tsx`).
- New CRT option "tint the map to the CRT colour": recolours the Nova Dark map
  basemap to the selected phosphor hue (green/amber/blue) or greyscale (white),
  applied only while Nova Dark is the selected map layer. Off by default, stored
  per-browser (`remoteterm-crt-map-tint`), and updates live when the phosphor or
  the toggle changes. Implemented as a vector-palette recolour keyed per colour
  so overlays (nodes, routes) are not tinted (`recolorNovaTinted` in
  `frontend/src/map/engine/novaRecolor.ts`; `novaBasemap` in
  `frontend/src/map/engine/basemaps.ts`; wiring in
  `frontend/src/map/MapSurface.tsx`).
- New i18n keys (`packet_sound_theme_waterdrip`, `settings_crt_map_legend`,
  `settings_crt_map_tint`, `settings_crt_map_tint_hint`) added to EN/NL/DE.

## Update 2026-09-13 (Mesh Health Requests panel)

### Chat / UI
- Mesh Health page gains an Adverts/Requests pill in the header. "Adverts" is
  the existing view (advert-frequency health); "Requests" is a new single-node
  view of REQUEST / ANON_REQUEST / RESPONSE traffic this node has heard over RF:
  stat tiles (requests, flood, direct, responses heard), a flood-vs-direct and
  a request-type split, a request-volume-over-time chart, and a top
  sender→target pair table (1-byte peer hashes shown as raw hex, not resolved
  to names). Both views share the time-window selector and refresh. Modelled on
  the EU Meshcore Analyzer request-health tab but reframed honestly for one
  connected node: it makes no answered/unanswered ("wasted") judgment, because a
  response routed around this node is never heard here.
- `MeshHealthView` refactored into a shell plus `MeshAdvertsPanel` /
  `MeshRequestsPanel`, with shared primitives in `meshHealthShared.tsx`.

### Backend
- New `GET /packets/request-traffic?start_ts&end_ts` endpoint aggregates
  REQUEST/RESPONSE traffic from `raw_packets` (filtered by `payload_type`,
  parsed for route type and src/dest hash) into totals, a time-bucketed series,
  and top src→dest pairs. Aggregation lives in `app/repository/request_traffic.py`.
- Migration `_086` adds a `(payload_type, timestamp)` index on `raw_packets` for
  the request-traffic window scan.
## Update 2026-09-13 (live packet map with replay)

Branch `feat/visualize-packets-live-map`.

### Map / packet visualization
- The map's "Visualize packets" feature is rebuilt on a deck.gl overlay that
  renders curved arcs, traveling pulses, and a node glow strobe, DMC-Observers
  style, in both flat 2D and tilted 3D (replacing the old 2D canvas overlay and
  the 3D-only arc overlay). Arcs are coloured by SNR (amber to blue to green)
  and fade with age; pulses ride the arc bow and are coloured by packet type.
- Packet paths are now resolved solely through the canonical
  `packetNetworkGraph` (single authority), fixing the previously inaccurate
  ad-hoc path resolver. As a solo observer, the hop we physically heard (the
  segment touching our node) is drawn solid/witnessed and the inferred upstream
  hops are faint; an unresolved hop is bridged rather than dropped to (0,0).
- New VCR-style playback bar: play/pause, speed (0.5x-8x), a seekable/clickable
  timeline, a Live button to re-pin to the newest packet, and a look-back
  selector (15m/1h/6h/all) that backfills history on demand via
  `GET /packets/recent?before_ts=`. Keyboard: space, arrows, L.
- New per-feature controls under the "Visualize packets" panel: Pulses and Glow
  toggles, a smoothing Buffer slider (0-12s) that de-clumps bursty arrivals, and
  an optional Geiger-click sound (off by default, with a volume slider).
- The map legend gains a packet-type colour key, an SNR gradient bar, and a
  witnessed-vs-inferred (solid/dashed) line-style key while packets are shown.
- All live packet rendering is derived as a pure function of a virtual clock, so
  replay can seek anywhere without re-running a forward-only scheduler.

### Notes
- No backend changes; reuses the existing `raw_packet` WS stream and the
  `GET /packets/recent` endpoint. Frontend only.
## Update 2026-09-13 (telemetry map overlay)

### Map / UI
- New opt-in map overlay (Overlays group, off by default) showing each node's
  latest telemetry at a glance: a battery icon coloured by level (green/amber/
  red) as the primary encoding, plus a temperature + relative-age badge.
  Readings older than 24h are faded. The overlay is a separate layer and does
  not change node marker colours or labels. While enabled it refreshes every
  60s. Nodes with only temperature (no battery reading) show a neutral marker
  with the temperature badge.

### Backend
- New read-only `GET /contacts/telemetry/latest` returns the latest stored
  telemetry per node (battery volts + temperature + source), merging the
  repeater and contact history tables (newer reading wins on a key collision).
  Backed by new `get_latest_all()` methods on the repeater and contact
  telemetry repositories. No schema change.
- Telemetry received via the `room/status`, `room/lpp-telemetry`, and
  `repeater/lpp-telemetry` endpoints is now recorded to telemetry history and
  forwarded to fanout (MQTT) on receipt, matching the tracked-interval and
  repeater-status / contact-telemetry paths. Telemetry only; messages are not
  forwarded. Shared helpers `_record_and_forward_lpp_telemetry` /
  `_record_and_forward_status_telemetry` in `app/routers/contacts.py`
  (best-effort; a persistence/forward error never fails the response).

## Update 2026-09-13 (map node labels)

### Map / UI
- Map gains a node-label control in the Display group with three states:
  Off (default, unchanged behaviour), Name (advert name, falling back to a
  12-char public-key prefix), and ID tag. The ID tag shows each node's
  public-key prefix sized to the path-hash width observed for that node
  (`direct_path_hash_mode` 0/1/2 -> 1/2/3 bytes -> 2/4/6 hex chars; unknown
  widths default to 1 byte). Labels render only at/above zoom 11 and are
  decluttered by the symbol layer's collision detection. The selected mode is
  persisted per device (`localStorage`). Frontend-only; no API or DB change.

## Update 2026-09-13 (contact annotations)

### Chat / UI
- Contact info pane gains user-editable, DB-stored annotations: free-text
  notes, a free-text owner-info field, an owner pointer to another contact
  (the operator's companion node), and manual fallback GPS coordinates. The
  owner name links to open a direct message; the referenced contact shows an
  "Owned nodes" list of every node that points to it.
- Map: a node with only manual coordinates now appears on the map (advertised
  GPS still wins when present). The node popup shows a notes snippet, an owner
  link, and a "Details" button that opens the full contact info pane.
- Repeater dashboard: the Owner Info pane auto-saves the repeater's reported
  owner string to the contact when none is set, and prompts to override when a
  different value is already saved.

### Backend
- Migration `_085` adds `notes`, `owner_info`, `owner_key`, `manual_lat`, and
  `manual_lon` columns to `contacts`; these are user annotations preserved
  through radio-sync upserts (COALESCE) and never overwritten by adverts.
- New `POST /contacts/{public_key}/annotations` sets any subset of the
  annotation fields (null clears; `owner_key` must reference an existing
  contact) and broadcasts a `contact` WS event.
- `POST /contacts/{public_key}/repeater/owner-info` now auto-fills the stored
  `owner_info` when empty and returns `stored_owner_info` + `owner_info_updated`.

## Update 2026-09-13 (database backup, issue #85)

### Settings / Data management
- In-app database backup added to the Settings database section. A **Download
  backup** button streams a consistent single-file SQLite snapshot produced with
  `VACUUM INTO` (safe against WAL torn writes, unlike a file copy). An optional
  server-side path toggle plus destination directory writes a timestamped
  snapshot to a configured absolute path via `POST /api/backup/save`
  (`GET /api/backup/download` backs the download). Backup only for this slice;
  restore is a documented manual procedure. Adds migration `_084` with
  `backup_to_path_enabled` / `backup_destination_path` in `app_settings`
  (issue #85)

## Update 2026-09-13 (chat entity parsing)

### Chat / UI
- Chat messages can now parse and act on embedded entities, each gated by a
  new server-side setting (synced across devices), under Settings > Local
  Configuration >
  "Chat parsing":
  - Public keys: a 64-hex key resolves to a known contact (opens contact info)
    or, when unknown, shows a "Look up" link to the first configured external
    analyzer site (`chat_parse_pubkeys`, default off)
  - Coordinates: bare `lat,lon`, `PREFIX:lat,lon` (wardriving), and `geo:`
    forms render as a location card; the existing inline map-preview preference
    still governs whether the card shows a mini-map (`chat_parse_coordinates`,
    default off)
  - Clickable links: URLs render as links; can be turned off
    (`chat_linkify_urls`, default on)
  - Link previews: messenger-style OpenGraph preview cards, fetched lazily via
    a new backend endpoint (`chat_url_previews`, default off)
- Message text rendering was refactored onto a single tokenizer
  (`utils/chatEntities.ts`) that unifies mention / URL / #hashtag / pubkey /
  coordinate handling

### Backend
- New SSRF-guarded `GET /api/unfurl` endpoint fetches a URL server-side and
  returns OpenGraph metadata for link previews; rejects non-http(s) schemes and
  private / loopback / link-local / reserved hosts (incl. redirects), caps
  response size and time, and caches results (`app/services/url_safety.py`,
  `app/services/unfurl.py`, `app/routers/unfurl.py`)
- `app_settings` migration `_083` adds `chat_parse_pubkeys`,
  `chat_parse_coordinates`, `chat_url_previews`, `chat_linkify_urls`

## Update 2026-09-13 (map advert-truth links + FAB declutter, PR #101)

### Chat / UI
- Node Map links can now be drawn from the advert paths actually heard (truth)
  rather than only the client-side liveness graph. The Links control gains a
  Liveness / Advert-truth mode switch and a confidence selector (1b+/2b+/3b,
  default 2b+): a hop hash is a truncated public-key prefix, so 1-byte hops are
  ambiguous and wider hops resolve more uniquely. Advert edges encode confidence
  as line width, recency as opacity, and ambiguous edges are dashed (PR #101)
- Node Map floating buttons decluttered from 11 to 6: grouped into Display,
  Filters, and Overlays category buttons (each opening a panel of sections),
  plus a standalone Search button and the 2D/3D and buildings toggles. On mobile
  the button column shifts clear of the sidebar drawer while it is open so it
  stays visible; tablets and desktops with a persistent sidebar are unaffected
  (PR #101)

### Backend
- New read-only `GET /api/packets/advert-links` resolves stored advert paths
  (`advert_events`) into GPS edges by walking each anchored chain and
  disambiguating multi-match hop hashes by nearest-to-previously-resolved,
  resolving hops against local contacts unioned with analyzer nodes
  (`external_map_nodes`). Returns `hop_width`, `count`, `last_seen`, and an
  `ambiguous` flag. No migration (PR #101)

## Update 2026-09-13 (CRT theme + branding)

### Chat / UI
- CRT theme: a retro phosphor-monitor look with green (default), amber,
  white, and blue (C64) phosphor variants and individually-toggleable
  scanline, phosphor-glow, screen-curvature, and flicker effects. Flicker
  respects `prefers-reduced-motion`. Phosphor and effect choices are
  per-device (localStorage); the theme lives in a dedicated CRT section under
  the renamed "Customisation" settings block (was "Color Scheme") (PR #100)
- Branding: customise the navbar name, hide it, and upload a custom icon.
  Stored server-side so it is shared across every device connected to the
  instance. Icon capped at 128 KB (PNG/SVG/ICO/JPEG). Empty name falls back to
  "RemoteTerm"; empty icon falls back to the built-in logo (PR #100)

### Backend
- Migration `_082` adds `brand_name`, `brand_hidden`, and `brand_icon` columns
  to `app_settings`; `PATCH /settings` accepts and validates them (name capped
  at 64 chars, icon type/size checked) (PR #100)

## Update 2026-09-12 (My Node map link)

### Chat / UI
- "My Node" coordinates now open the internal node map centred on the node
  instead of linking out to OpenStreetMap in a new tab

## Update 2026-09-12 (navbar, PR #98)

### Chat / UI
- Navbar public key is shown truncated to the connected radio's
  `path_hash_mode` byte width (1/2/3 bytes = 2/4/6 hex chars) instead of the
  full 64-char key; hover reveals the full key and click still copies it
  (`7f114ec`) (PR #98)

## Update 2026-09-12 (contacts residency, mesh-health direct/flood, emoji, wordlist selector, PRs #92/#94/#95/#96)

Backfilled entries for four PRs that merged after the `#75-#91` umbrella but were
not recorded when they landed.

### Contacts
- Per-contact radio-residency policy (`auto`/`pinned`/`excluded`) so operators
  control which contacts occupy the bounded radio working set, separate from the
  app's unbounded contact store and from the favorite flag. Pinned contacts are
  always loaded (favorite tier), excluded are never synced (exclude wins over
  favorite). Radio residency is derived (single source of truth, cannot drift),
  exposed at `GET /contacts/radio-residency`; a `ContactRadioResidencyControl`
  (pin/exclude + live on-radio badge) sits in the contact info pane, and a "Radio
  working set" occupancy readout (`GET /radio/contact-occupancy`) sits in the
  radio settings section. i18n EN/NL/DE (`0ca2d5f`) (PR #92)

### Mesh Health
- Adverts split into direct vs flood with dedup and retention. New
  `advert_events` table records one row per unique advert transmission (keyed by
  the primary copy's `raw_packets.id`) so copies flooded over multiple paths
  dedupe to one event; `min_path_len` (0 = direct, >0 = flood) is refined across
  copies. `GET /api/packets/mesh-health` returns `direct_count`/`flood_count` per
  contact and fires alerts on the deduped total; the Mesh Health view gains
  Direct/Flood/Total columns and a direct-vs-flood summary. Retention is
  configurable on the Database settings page (`advert_retention_days`, default
  30) with a daily prune loop. `advert_events` also stores `path_hex`/`hop_width`
  for the later map-links feature (`5c3074a`) (PR #94)

### Chat / UI
- Emoji picker on the message input (`c963ceb`) (PR #95)

### Cracker
- Channel-finder wordlist selector: choose between a bundled English list, a
  bundled Dutch list, or custom uploaded wordlists, with a rebuild flow and
  selection persistence. Adds a canonical wordlist normalizer, a
  `WordlistRepository` with on-disk storage, and upload/list/words/delete API
  (`52ee211`) (PR #96)

### Backend / Database
- Migration `_079` adds `contacts.radio_policy` (PR #92); migration `_080`
  creates `advert_events` with a backfill from `contact_advert_paths` (PR #94);
  migration `_081` creates the `wordlists` table (PR #96)

## Update 2026-09-12 (map / audio / fanout, PRs #75-#91)

Work that landed on `origin/main` after PR #74, up to PR #91 (`b180cc7`),
grouped by area. PRs #83-#86 did not merge. The three "(pending)" items in the
section below merged as PR #91 and now carry that commit ref.

### Map
- Map overhaul Phase 2: MapLibre-GL migration with 2D/3D tilt, 3D buildings, a
  per-link layer, and FAB controls; Leaflet removed (`6b5a104`) (PR #75)
- Per-role node colour picker with a live legend (`b1e9bb3`) (PR #81)
- Fall back to a keyless raster basemap when the vector basemap fails
  (`52c288e`) (PR #80)
- Three-state heard / never-heard node filter (`8ab06ce`) (PR #89)

### Chat / UI
- Chat scope and direct pills, map route + analyzer overlays, and a navbar
  packet graph (`6f0be35`) (PR #77)
- Per-packet signal audio (Geiger / sonar themes) on the raw packet feed
  (`4b8dedb`) (PR #76)

### Sidebar
- Merge Repeaters / Rooms / Companions / Sensors into a single Contacts section
  with type-filter pills (`2a2e3a5`) (PR #88)

### Repeater
- Seed `known_regions` from a repeater's reported regions (`5f4244a`) (PR #79)
- Fall back to stored neighbour history when a live neighbour query is empty
  (`48f8acf`) (PR #78)

### Fanout / MQTT
- Forward remote-node telemetry, neighbors, and regions over MQTT with
  `subject_id` attribution (`d0f392e`) (PR #90)

### Versioning
- Fork build identity: the displayed version now appends `FORK_VERSION_SUFFIX`
  (`-EV.0.1`) to the upstream base, e.g. `3.17.1-EV.0.1` (`b180cc7`) (PR #91)

### Tests / tooling
- Bump `LATEST_SCHEMA_VERSION` to 77 for migrations 076/077 (`4984177`) (PR #82)

### Docs / planning
- Add backlog stubs: data-directory backup [22] and packet-history browser [23]
  (`d3e932d`) (PR #87)

## Update 2026-09-12 (merged after the 2026-09-11 second pass)

Work that landed on `origin/main` after PR #67, up to PR #74, grouped by area.
The previous update's cutoff was `bda40a5` (merge of PR #67).

### Sidebar
- Customisable layout: reorder sections, collapse to a rail, and configure it
  from a settings panel (`0130411`) (PR #72)
- Section total/new counters, a per-row new marker, and per-section clear
  (`bed9c1e`) (PR #71)
- Dim the name of a muted channel row (`f32e92b`) (PR #73)

### Update checker (in-app update indicator)
- New `update_check_enabled` setting, env `MESHCORE_UPDATE_CHECK_ENABLED`
  (`c85abd8`, `0ebb34d`); cached GitHub `main`-compare service (`3a9cadb`) and
  `/api/update-status` endpoint (`8402b01`); shared `useUpdateStatus` hook,
  `UpdateStatus` type and api method (`bb80d7d`, `27bb14d`); update indicator +
  button in About (`b2e05d3`) and an update dot on the StatusBar settings button
  (`b54f0f9`), with i18n strings (`c050e1d`); design spec and implementation
  plan (`1152abe`, `27e036e`) (PR #69)

### Channels / registry
- Batch-delete selected channels from the registry (`bd46a39`) (PR #70)
- New `mention` registry source: #hashtag channels referenced in chat can be
  captured into the Channel Registry, either via an inline "+" on an unknown
  mention or passively through the opt-in `auto_add_mentioned_channels` setting
  (registry-only; no followed radio channel is created) (`b180cc7`) (PR #91)

### Channel finder
- Seed the cracker wordlist from Channel Registry names (with the leading `#`
  stripped) via a "Sync from channels" button; merged alongside the bundled and
  remote-synced lists (`meshcore-wordlist-registry-cache`) (`b180cc7`) (PR #91)

### Chat / UI
- #hashtag channel references in messages are now styled by state: followed,
  in-registry, or unknown (`b180cc7`) (PR #91)

### Tooling / CI
- Enforce LF line endings via `.gitattributes` (`8f90a0a`) (PR #74)

### Docs / planning
- Note the prettier format gate and the CRLF caveat in the frontend docs
  (`93d87b4`)
- Correct plans 06/07 delivery status to shipped (`95ca9bf`)

## Update 2026-09-11 (second pass - merged after the previous update)

Work that landed on `origin/main` after the update below, up to `bda40a5`
(merge of PR #67), grouped by area. The previous update's cutoff was `a3ce6db`.

### Fanout / MQTT
- Community MQTT topic toggles, replacing the standalone DMC observer type with
  per-topic toggles on the community module; includes the design spec and
  implementation plan (`01ecead`, `83a0292`) (PR #60)
- Community MQTT preset picker covering all 37 MeshCore brokers (`1b9833e`)
  (PR #67)

### Channels / registry
- "Add to Channels" action to move channel-registry entries into the app
  (`f0e691f`) (PR #54)
- Guard registry import and allow bulk-delete of monitored channels (`d1fea8d`)
  (PR #61)

### Chat / UI
- Message-list hop-size and unscoped filters (`e2542e9`) (PR #51)

### Meshcomod / CAD
- Show the CAD toggle in DM and room-server headers (`3450f28`) (PR #52)

### Settings
- Handy Info section with endpoint links (`39af6c9`) (PR #64)
- Declare `RadioPresetsStore` under `TYPE_CHECKING` to resolve an F821 lint
  error (`1c2ad73`) (PR #53)

### Branding
- Rebrand About to RTFM-EV and point self URLs at the fork (`510b3df`) (PR #62)

### Tooling / CI
- Auto-publish a rolling `:latest` container image to GHCR on every push to
  `main`, tagged `latest` and `sha-<short>`; point the docs, example compose,
  setup script, and manual release scripts at `ghcr.io/elektr0vodka/rtfm-ev`
  (`995d130`, `b37a105`) (PR #65)
- Apply ruff + prettier formatting and a pyright annotation fix to unblock the
  all-quality workflow (`e6a4399`, `b769c18`) (PR #66)
- Isolate the `radio_stats` module-global in-memory buffers between tests via an
  autouse conftest fixture, fixing a flaky cross-test battery-statistics bleed
  (landed on `main` in `1b9833e`)

### Docs / planning
- Reconcile the plan-backlog delivery table to 2026-09-11, add plans 17-19, and
  mark plans 06 and 07 done (`b4d85c4`, `d862b19`, `b662a4d`, `392fea4`)

## Update 2026-09-11 (merged since the 2026-09-10 generation)

Work that landed on `origin/main` after this changelog was first written,
grouped by area. Older entries below remain as generated.

### MQTT / fanout
- DMC observer MQTT export (parity X1): payload/topic builders, publisher
  (status schema, fixed interval, no LWT), fanout module for the raw/packets
  topics, type registration with validation and scope, and a fanout editor with
  i18n (`4ee1029`, `595e81e`, `a605d58`, `fc6847c`, `3a59ce7`) (PR #41)
- Rename the community fanout client identifier to RTFM-EV (`a3ce6db`) (PR #50)
- Community MQTT preset picker: one region-grouped picker inside the Community
  MQTT editor covering all 37 MeshCore brokers from the Dutch-MeshCore
  `MQTTPresets.h` list (36 upstream + `bsmesh`), replacing the six hardcoded
  preset tiles. USERPASS presets ship editable credentials; `mesh-chaun14`
  authenticates with the radio public key (backend `{pubkey}` substitution)

### Neighbors / signal history
- Per-link signal history, parity X2b (`736df88`) (PR #47)

### Regions
- Offline Dutch region-scope seed for message pills (`7434d0e`) (PR #45)
- Store analyzer scope codes, not display names (`c71d0e7`) (PR #48)

### Map
- Route path lines and theme-aware basemaps (`9398e4a`) (PR #42)

### Chat / UI
- Decode MeshCore One reaction payloads (`9a91d86`) (PR #32)
- Header language switcher and theme modal (`c77916b`) (PR #31)
- Keep mobile header dropdowns within the viewport (`0eb2b77`) (PR #44)
- Keep DarkDutch header dropdowns above page content (`8c6c708`) (PR #43)
- Chat-header layout: stack the channel key below the name and keep the name
  left of the DarkDutch chevron (`a783f4e`, `3d485b7`) (PR #45)
- Stop showing the channel key as the sender key in the path modal (`b66ad53`)
  (PR #46)

### Rooms
- Pass destination type to `send_cmd` for meshcore 2.3.9.1, key RoomServerPanel
  distinctly from the message list, and remount it per room to stop login-state
  bleed (`42025c8`, `6b8971f`, `39c75a9`) (PRs #49, #36)

### Repeater
- Command-history recall and CLI docs link in the console (`f362310`) (PR #33)

### Reliability
- Return 422 for mesh timeouts and stop clients retrying (`a26fd2a`) (PR #37)

## Firmware - meshcomod (DMC-EV)

- Add DMC-EV **CAD toggle** and **GPS** settings panel under Settings → Radio (`b806c5d`)
- Add CAD toggle to the channel header (`6c3dc5b`)
- Document meshcomod (DMC-EV) firmware support in the README (`b1033aa`)

## Internationalization (i18n)

Core:

- Dependency-free translation core (`ea8155d`)
- en/nl/de catalog bootstrap (`726354a`)
- en/nl/de key-parity test (`c4b29ea`)
- React provider, `useT` and `useLocale` hooks (`8d540a8`)
- Mount `I18nProvider` at app root (`a06a7a1`)
- Language selector in settings (`613bd8e`)
- Locale-aware number/date formatters (`48bef09`)
- Key-naming docs and `no-literal-string` guard, warn level (`81faeec`)
- Fall back to the English catalog outside a provider (`a558714`)
- Enforce `no-literal-string` at error, disable for intentional non-translatables (`4bbbc09`)
- Document language support and credit kiekr-i18n (CC-BY 4.0) (`34acc59`)

String migrations:

- App shell (`017f510`)
- Status bar, chat header, sidebar (`d7c35ad`)
- Chat and messaging (`a3d84cf`)
- Contacts and channels (`05b949e`)
- Settings → About (`c25ffdd`)
- Local settings, theme selector, settings modal (`77acc8c`)
- Database and meshcomod settings (`d4bf8a5`)
- Radio and radio-app settings (`c625d64`)
- Fanout/MQTT settings (`0c65249`)
- Statistics settings (`087226e`)
- Repeater dashboard pane (`f0aa7c5`)
- Repeater dashboard, login, room server (`609f1e3`)
- Raw packet feed and detail (`8e71d29`)
- Map and visualizer (`8580d3a`)
- Command palette, search, dialogs, settings nav labels (`ed5e637`)
- Channel registry, import/export, mention ticker (`0ca8e88`)
- Path, route, region-override, location modals (`322658d`)
- Bulk-delete, registry, mention-ticker, telemetry leftovers (`edbfc30`)
- Raw packet feed hop-width filter (`2350676`)
- Contact analyzer lookup (`2511c5e`)
- External analyzer settings (`964895e`)
- My Node and Mesh Health sidebar labels (`13091a2`)
- My Node analytics page (`1880fbf`)
- Mesh Health analytics page (`47bc97b`)
- Region-sync strings in Settings → Radio (`986b80c`)

## Themes & UI

- DarkDutch theme and layout (`9720d03`)
- Render country flag emoji on Windows/Chromium (`1447b4c`)
- Header language switcher and theme modal (`c77916b`)

## Channels

- Channel import/export backend (`4ae91b9`)
- Channel import/export modal and sidebar entry (`31a09a4`)
- Channel Registry with remote sync (`23c8d0e`)

## Map

- Replace CARTO dark basemap with keyless Esri raster layers (`44ee186`)

## Packets, signal & analytics

- Persist signal metadata and add history endpoints (`2020ead`)
- Seed raw packet feed from stored history (`2ae98a3`)
- Persist noise-floor and battery history (`664ccd8`)
- My Node analytics page (`5210223`)
- Direct-only neighbors and node type labels (`32ea26e`)
- Mesh Health analytics page (`6e51c39`)
- Filter raw packet feed by hop-byte width (`be32684`)

## Mentions

- Channel mention ticker with `show_mention_ticker` setting (`f62ed63`)

## Command palette

- Group favorited room-servers in the palette (`f771ce1`)

## External analyzer

- Configurable analyzer sites + contact lookup (`ac394d0`)
- Inline-edit configured analyzer sites (`8876bca`)

## Location

- Copy location to chat for channels and DMs (`fa9f81e`)
- Copy-location-to-chat design spec and plan (`ce490d6`)

## Regions

- Sync region presets from the official MeshCore API (`bde34f2`)
- Renumber `radio_presets` migration to 067 (`cc791f2`)
- Sync region names from an analyzer endpoint (`bdae0d8`)

## MQTT

- Add DMC-1, DMC-2, and MeshCore Analyzer (EU) community MQTT presets (`b1da0e7`)

## Channel-finder (cracker)

- Sync channel-finder wordlist from a remote source (`62c33d6`)

## Repeater

- Disable auto-capitalization on the console input (`1459308`)

## Dependencies

- Bump `meshcore` 2.3.7 → 2.3.9.1 (`c3c78c7`)

## Docs & project

- Agent skills config and house rules (`372c2ea`)
- Parity audit, i18n spec and implementation plan (`c45401e`)
- Feature-planning backlog and sources-of-truth (`b57206a`)
- Record [04] implementation status (`f09ec45`)
