# Settings "Handy Info" section — design

Date: 2026-09-11
State: Approved, ready for planning

## Goal

Add a new collapsible **Handy Info** section to Settings, positioned directly
above **About**, that lists useful external MeshCore endpoints. Some entries are
plain reference links; others carry action buttons that either copy a URL to the
clipboard or apply it into the app's existing sync settings (`analyzer_sites`,
`region_sync_url`, `registry_sync_url`).

The sync mechanisms already exist in the Database section. This section is a
curated, action-enabled catalog so operators do not have to know or hand-type
the endpoint URLs.

## Scope

Frontend only. No backend, migration, or API changes — every value is a static
constant, and the sync endpoints/fields it writes already exist.

## Component

New file `frontend/src/components/settings/SettingsHandyInfoSection.tsx`.

- Presentational + interactive. Props:
  - `appSettings: AppSettings | null` (to read current sync values for the
    append/overwrite decisions)
  - `onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>`
  - `className?: string` (receives `sectionContentClass` from `SettingsModal`)
- Styling matches the existing settings idiom:
  - same container `className`
  - `<Separator />` between groups (from `../ui/separator`)
  - links: `text-primary hover:underline`, `target="_blank"
    rel="noopener noreferrer"`
  - action buttons: `Button variant="outline" size="sm"` (from `../ui/button`)
  - toasts: `toast.success` / `toast.info` / `toast.error` from `../ui/sonner`
  - clipboard: `navigator.clipboard.writeText(...)` then `toast.success`
    (same pattern as `ChannelInfoPane.tsx:105`)
- Layout: left-aligned rows grouped under headings (like the analyzer list in
  `SettingsDatabaseSection`), NOT centered like About, because entries carry
  action buttons. Each row: name · short description · URL
  (`font-mono text-xs break-all`) · action button(s).

## Groups and entries

### Group 1 — External node analyzers

Buttons per row: **Open site** (link), **Copy** (copies node template),
**Apply** (appends to `analyzer_sites`).

Node URL schemes verified: the EU-Meshcore-Analyzer family uses
`#node?id=<pubkey>` (source `EU-Meshcore-Analyzer/web/index.html:555`;
Cornmeister corroborated in `docs/sources-of-truth.md:70`); mc-radar uses
`/node/<pubkey>` (`docs/sources-of-truth.md:71`).

| Display name | Site link | Node template |
|---|---|---|
| Cornmeister | https://cornmeister.nl | `https://cornmeister.nl/#node?id={pubkey}` |
| MC-Radar | https://mc-radar.woodwar.com | `https://mc-radar.woodwar.com/node/{pubkey}` |
| meshcore-analyzer.eu | https://meshcore-analyzer.eu | `https://meshcore-analyzer.eu/#node?id={pubkey}` |
| MeshCoreNetz | https://analyzer.meshcorenetz.de | `https://analyzer.meshcorenetz.de/#node?id={pubkey}` |
| MeshDresden | https://analyzer.meshdresden.eu | `https://analyzer.meshdresden.eu/#node?id={pubkey}` |

No `packet_url_template` presets — `{hash}` schemes are unverified and the field
is optional (stored `null`).

### Group 2 — Sync sources

Buttons per row: **Open** (link), **Copy** (copies URL), **Apply** (sets the
matching sync field, confirm-before-overwrite).

| Label | Target field | URL |
|---|---|---|
| Region scopes | `region_sync_url` | `https://meshcore-analyzer.eu/api/regions/scopes` |
| Channel registry | `registry_sync_url` | `https://meshcore-analyzer.eu/api/channels` |

`region_sync_url` consumer verified: `app/routers/regions.py:45-58` expects a
`{code,name}` array, example endpoint cited in the docstring.
`registry_sync_url` consumer verified: `SettingsDatabaseSection.tsx:333`.

### Group 3 — Reference links (Open only)

| Label | URL |
|---|---|
| Dutch mesh settings | https://settings.dutchmeshcore.nl |
| DMC channel browser | https://toolbox.dutchmeshcore.nl/#/channel-browser |
| Region list (meshwiki) | https://meshwiki.nl/wiki/Lijst_van_regio%27s |

## Apply semantics

- **Analyzer presets** append to `analyzer_sites`:
  - If an entry with the same `node_url_template` already exists, do not add a
    duplicate — `toast.info` "already added" (button may also show a disabled
    "Added" state when present).
  - Otherwise append `{ name, node_url_template, packet_url_template: null }`
    and persist via `onSaveAppSettings({ analyzer_sites: next })`;
    `toast.success`.
- **Sync-URL apply** (`region_sync_url` / `registry_sync_url`):
  - Empty or already equal to the target → set directly, `toast.success`.
  - Non-empty and different → `window.confirm(...)` first; on cancel, no-op; on
    confirm, overwrite and `toast.success`.
- All writes go through `onSaveAppSettings`. On rejection, surface
  `toast.error` (mirrors the Database section's `persistAppSettings` revert/toast
  behavior). Local optimistic state is not required here because the component
  reads from `appSettings` props, which refresh after save.

## Section plumbing

`frontend/src/components/settings/settingsConstants.ts`:
- Add `'handy-info'` to the `SettingsSection` union.
- Insert `'handy-info'` into `SETTINGS_SECTION_ORDER` immediately before
  `'about'`.
- Add `handy-info: 'settings_section_handy_info'` to
  `SETTINGS_SECTION_LABEL_KEYS`.
- Add `handy-info: Lightbulb` (lucide-react) to `SETTINGS_SECTION_ICONS`.

`frontend/src/components/SettingsModal.tsx`:
- Add `'handy-info': false` to the `expandedSections` initial state.
- Render a `shouldRenderSection('handy-info')` `<section>` with its header and
  the new component, positioned immediately before the existing `about` block.
  Pass `appSettings`, `onSaveAppSettings`, and `sectionContentClass`.

## i18n

New `t()` keys in `frontend/src/i18n/locales/{en,nl,de}.json` (parity enforced):
- `settings_section_handy_info` (section label)
- group headings (analyzers / sync sources / reference links)
- per-row short descriptions where helpful
- button labels: open, copy, apply
- toasts: copied, applied, already-added, apply-failed
- overwrite confirm prompt text

Brand names and URLs stay literal with `eslint-disable i18next/no-literal-string`
exactly as `SettingsAboutSection.tsx` does for GitHub/author links.

## Tests

New `frontend/src/test/settingsHandyInfoSection.test.tsx`:
- Renders the analyzer, sync, and reference entries.
- Analyzer **Apply** calls `onSaveAppSettings` with the template appended to
  `analyzer_sites`; a second Apply of the same entry does not duplicate.
- Region/registry **Apply** sets the field when empty
  (`onSaveAppSettings({ region_sync_url: '...' })`).
- Overwrite path: with a different existing value, Apply calls `window.confirm`
  (mocked) — persists on confirm, no-ops on cancel.
- **Copy** calls `navigator.clipboard.writeText` with the expected URL.

Extend `frontend/src/test/settingsModal.test.tsx` (or assert within the new
test) that the Handy Info section renders above About.

## Out of scope / YAGNI

- No packet-lookup (`{hash}`) presets.
- No backend or settings-schema changes.
- No editing/removal UI in this section (analyzers are managed in the Database
  section; this section only seeds them).
