# Changelog - RTFM-EV (DMC-EV fork)

This changelog covers work done in the **RTFM-EV** fork
(`Elektr0Vodka/RTFM-EV`) since it diverged from upstream
`jkingsman/Remote-Terminal-for-MeshCore`.

- Fork base commit: `33b3b8d` (upstream `main`), 2026-07-26
- Commits since fork: 301 total (231 non-merge), as of `462f3b8c` (#172)
- Generated: 2026-09-10; updated 2026-09-23

Entries are grouped by area and reference the non-merge commit that introduced
the change. Upstream development is on hold; the fork is the active repository.

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
