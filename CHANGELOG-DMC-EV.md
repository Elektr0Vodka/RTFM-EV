# Changelog - RTFM-EV (DMC-EV fork)

This changelog covers work done in the **RTFM-EV** fork
(`Elektr0Vodka/RTFM-EV`) since it diverged from upstream
`jkingsman/Remote-Terminal-for-MeshCore`.

- Fork base commit: `33b3b8d` (upstream `main`), 2026-07-26
- Commits since fork: 222 total (152 non-merge)
- Generated: 2026-09-10; updated 2026-09-12

Entries are grouped by area and reference the non-merge commit that introduced
the change. Upstream development is on hold; the fork is the active repository.

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

## Update 2026-09-11 (second pass — merged after the previous update)

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
