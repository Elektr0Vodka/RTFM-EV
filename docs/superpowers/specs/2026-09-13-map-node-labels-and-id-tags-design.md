# Map node labels and observed-width ID tags

Date: 2026-09-13
Status: Approved design (pre-plan)
Scope: Feature B of a four-part request (B = map labels). A (telemetry storage + map layer), C (fleet management), D (data-store decision) are separate specs.

## Problem

Map node markers currently render no text label (`frontend/src/map/layers/nodesLayer.ts` — the circle layer `rt-nodes` carries `name` only in feature properties for click/popup, never drawn). Users want, on the map:

1. Advert names shown on markers.
2. A toggle to instead show a short **ID tag**: the node's public-key prefix, sized to the **path-hash width actually observed for that node** in its adverts or in traffic (1 byte / 2 byte / 3 byte → 2 / 4 / 6 hex chars). The width is data-driven per node, not a user-picked length.

## Grounding (verified)

- Path byte packs `[hash_mode:2][hop_count:6]`; `hash_size = hash_mode + 1` → 1, 2, or 3 bytes per hop. `hash_mode` 0/1/2 (3 reserved). Source: `app/path_utils.py:4-5,49-55`, `app/AGENTS.md:129`.
- Contacts persist `direct_path_hash_mode` (learned from the node's observed direct path / advert); `PATH_UPDATE`/advert events carry `path_hash_mode`. Source: `app/event_handlers.py:185`, `app/database.py:21`, `app/AGENTS.md:134`.
- Frontend `Contact` already exposes `public_key` (`frontend/src/types.ts:186`) and `direct_path_hash_mode: number` (`frontend/src/types.ts:192`). `buildNodeFeatures` already receives full `Contact[]` (`frontend/src/map/layers/nodesLayer.ts:63`).

Conclusion: **pure-frontend feature. No backend change, no DB migration.**

## Decisions (from brainstorming)

- **Label control states:** `Off` / `Name` / `ID tag`. Default `Off` (existing users see no change).
- **Unknown width fallback:** when `direct_path_hash_mode` is null / `-1` / out of range, treat as mode `0` → 1-byte (2 hex) tag.
- **Name fallback:** in `Name` mode, a node with no advert name falls back to the existing 12-char pubkey prefix.
- **Density:** labels render only at/above a zoom threshold. Default `minzoom = 11` (tunable).
- **Tag case:** uppercase hex (adjustable).
- **Declutter:** rely on MapLibre symbol-layer collision detection (default on).

## Design

### Approach

Add one MapLibre `symbol` layer (`rt-node-labels`) bound to the existing `rt-nodes` GeoJSON source. `text-field` reads a computed `label` property; a `minzoom` threshold limits density; text halo makes it theme-aware. Chosen over deck.gl `TextLayer` (second render path, no benefit) and DOM overlays (clutter, poor scale).

### Components

1. **Label computation** (`nodesLayer.ts`)
   - New exported helper `observedIdTag(publicKey: string, hashMode: number | null | undefined): string`
     - `const mode = Number.isInteger(hashMode) && hashMode! >= 0 && hashMode! <= 2 ? hashMode! : 0;`
     - `return publicKey.slice(0, (mode + 1) * 2).toUpperCase();`
     - Edge case: pubkey shorter than needed → returns what exists (slice is safe).
   - `buildNodeFeatures(contacts, nowSec, labelMode)` gains a `labelMode: 'off' | 'name' | 'tag'` arg and adds a `label` feature property:
     - `off` → `''`
     - `name` → `c.name ?? c.public_key.slice(0, 12)`
     - `tag` → `observedIdTag(c.public_key, c.direct_path_hash_mode)`
   - Default `labelMode` arg to `'off'` to keep existing callers/tests valid unless updated.

2. **Symbol layer** (`nodesLayer.ts` / `createNodesLayer`)
   - Add `rt-node-labels` (type `symbol`, source `rt-nodes`) after the circle layer.
   - Layout: `text-field: ['get','label']`, `text-size` ~11, `text-offset` below the circle (e.g. `[0, 1.1]`), `text-anchor: 'top'`, `minzoom: LABEL_MIN_ZOOM` (const = 11), `text-allow-overlap: false` (collision declutter), `text-optional: true`.
   - Paint: `text-color` + `text-halo-color` / `text-halo-width` theme-aware (light halo on dark/CRT basemaps, dark halo on light). Empty `label` renders nothing, so `off` mode costs nothing visually.
   - New method `setLabelMode(mode)` on the layer controller that triggers a feature-data rebuild (labels recompute). Mode is also threaded into `setData` so data refreshes carry the current mode.

3. **Control** (`frontend/src/map/controls/MapControls.tsx`)
   - Add a three-state segmented control (Off / Name / ID tag) in the `display` group.
   - Default `Off`, persisted the same per-device way existing map display prefs (basemap, node size) are persisted.
   - Wire through `MapView.tsx` into the nodes-layer ref, mirroring `setNodeScale` / `setRoleColors`.

4. **i18n** (`frontend/src/i18n/locales/{en,nl,de}.json`)
   - New `map_`-prefixed keys: control label + three state labels. All three locales (parity test enforced).

### Data flow

`contacts` (already carry `direct_path_hash_mode`) + current `labelMode` → `MapView` → nodes-layer `setData` / `setLabelMode` → `buildNodeFeatures` computes `label` → `rt-nodes` source updated → circle + symbol layers repaint. No network, no store changes.

### Out of scope

- Backend/DB changes (none needed).
- Changing how `direct_path_hash_mode` is learned or stored.
- Telemetry map layer (Feature A), fleet management (Feature C), data-store migration (Feature D).

## Testing

- **Unit** (`frontend/src/test/map/nodesLayer.test.ts`): `observedIdTag` for mode 0/1/2 → 2/4/6 hex; null / -1 / 3 / undefined → 2 hex; short-pubkey edge case; uppercase. `buildNodeFeatures` `label` per mode incl. name fallback.
- **Control test:** segmented control renders three states and invokes the setter on change.
- **i18n parity** test passes (en/nl/de).
- **CI gates:** `lint`, `format:check` (Prettier), `test:run`, `build` — all green before push (see `docs/agents/ci-checks.md`).
- **Runtime (required before any "works" claim):** on the live instance, toggle Off/Name/ID tag, confirm labels appear only at/above zoom 11, verify ID-tag widths match each node's observed hash mode, and check legibility on at least two themes (a dark/CRT basemap and a light basemap). Mark NOT VERIFIED until observed in the running app.

## Risks / limitations

- `direct_path_hash_mode` reflects the *learned direct route*; a node only ever heard via flood with no direct path may sit at the 1-byte default until a wider hash mode is observed. Accepted (matches "default to 1-byte").
- Dense clusters: collision detection hides overlapping labels; at very high density some labels won't show even above `minzoom`. Accepted; `minzoom` is tunable.
- Theme halo tuning is visual; must be verified at runtime, not by type-check alone.
