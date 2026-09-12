# Changelog - RTFM-EV (DMC-EV fork)

This changelog covers work done in the **RTFM-EV** fork
(`Elektr0Vodka/RTFM-EV`) since it diverged from upstream
`jkingsman/Remote-Terminal-for-MeshCore`.

- Fork base commit: `33b3b8d` (upstream `main`), 2026-07-26
- Commits since fork: 209 total (139 non-merge)
- Generated: 2026-09-10; updated 2026-09-12

Entries are grouped by area and reference the non-merge commit that introduced
the change. Upstream development is on hold; the fork is the active repository.

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
