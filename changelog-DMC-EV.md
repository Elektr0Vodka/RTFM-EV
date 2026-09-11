# Changelog - RTFM-EV (DMC-EV fork)

This changelog covers work done in the **RTFM-EV** fork
(`Elektr0Vodka/RTFM-EV`) since it diverged from upstream
`jkingsman/Remote-Terminal-for-MeshCore`.

- Fork base commit: `33b3b8d` (upstream `main`), 2026-07-26
- Commits since fork: 147 total (98 non-merge)
- Generated: 2026-09-10; updated 2026-09-11

Entries are grouped by area and reference the non-merge commit that introduced
the change. Upstream development is on hold; the fork is the active repository.

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
