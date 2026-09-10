# [13] Map Overhaul: EU-Analyzer UX Import, Phased Quick-Wins then Engine Migration

Date: 2026-09-10
Status: draft for review
Category: G (Map overhaul), see `docs/plans/README.md`
Model: Opus

Scope: local planning only. No code changes, no migrations, no commits, no PRs
from this document.

Product framing: RTFM-EV is a **MeshCore** server + browser terminal driving a
companion radio. Not Meshtastic, not the official app. The map is a Tertiary,
best-effort quality-of-life surface (`AGENTS.md` "Feature Priority" ->
"Tertiary ... Map view"). This overhaul must not regress the Primary/Secondary
features and must obey the repo rule "smallest change necessary".

---

## 1. Summary

RTFM-EV's map (`frontend/src/components/MapView.tsx`) is a Leaflet +
react-leaflet view over Esri/OSM **raster** tiles with `CircleMarker` nodes, a
canvas particle overlay for packet replay, a "heard since" recency filter, and a
`LayersControl` basemap switcher (`frontend/src/components/MapView.tsx:1-131`,
`:1118-1215`). It works but lags the EU MeshCore Analyzer on three axes: it has
no responsive/mobile map chrome, no node-size / 2D-3D / buildings controls, and
its on-map popups + Leaflet control chrome ignore the app theme (they render in
Leaflet defaults; `frontend/src/styles.css:56-67` only pins z-index).

The EU analyzer (`G:\Github\repositories\Elektr0Vodka\EU-Meshcore-Analyzer`) is a
Go-served vanilla-JS app on **MapLibre GL JS 4.7.1** (vendored) plus **deck.gl**
(lazy-loaded), with OpenFreeMap **vector** basemaps, a shared 3D-buildings
fill-extrusion helper, a 2D/3D lock, a live GL node layer with a node-size
slider, per-link arcs, a draggable legend, and a floating/pinnable control panel
that collapses to a bottom sheet on compact viewports. These are the UX targets.

The plan is **phased**:

- **Phase 1 (quick-wins, ships without any engine change, stays on Leaglet):**
  (1) theme-align on-map panels/popups/controls, (2) node-type legend for
  contact types 1/2/3/4, (3) responsive map chrome + a small controls affordance
  (node-size, since/legend as a bottom sheet on mobile). No new runtime deps.
- **Phase 2 (engine migration, standalone and larger):** evaluate and, if
  approved, add a MapLibre-GL vector renderer (`maplibre-gl` +
  `@maplibre/maplibre-gl-leaflet`), which unlocks vector styling (DMC "Nova"),
  2D/3D tilt, and 3D buildings; then port additional layers/tools (live view,
  per-link lines, triangulation link-out).

**Recommendation up front:** ship Phase 1 first and independently. For Phase 2,
prefer **add-alongside** (a MapLibre vector base layer under the existing Leaflet
map via `maplibre-gl-leaflet`) over a full swap-engine rewrite, because the
particle overlay, `LayersControl`, marker refs, popups, and `mapView.test.tsx`
are all Leaflet-coupled. A full swap to a MapLibre-native renderer (matching the
EU analyzer's `livemap-nodes-gl.js`) is the highest-fidelity option but is a
rewrite, not a slice. Both are assessed in section 4.2.

---

## 2. Current state (cited)

### 2.1 MapView today

- **Engine:** Leaflet `^1.9.4` + react-leaflet `^4.2.1`
  (`frontend/package.json:36,42`). No maplibre/mapbox/deck.gl dependency exists
  (`frontend/package.json:18-49`; `three` `^0.182.0` at `:48` is the visualizer's
  3D lib, not a map lib).
- **Basemaps:** six **raster** tile presets, all keyless (OSM, Esri Dark/Light
  Gray, OpenTopoMap, Esri NatGeo, Esri World Imagery) with per-layer `maxZoom`
  caps and a `MaxZoomByActiveLayer` enforcer
  (`frontend/src/components/MapView.tsx:66-131`, `:178-187`). Selection persists
  to `localStorage` (`remoteterm-map-layer`) and syncs across tabs
  (`:133-149`, `:584-607`). The header comment already notes the DMC Observers
  raster options as the source of the Esri dark basemap (`:75-88`).
- **Nodes:** `CircleMarker` per mappable contact, fixed radius `isRepeater ? 10
  : 7` (`:1163`), recency fill color by `last_seen` age buckets
  (`MAP_RECENCY_COLORS`, `:189-194`, `getMarkerColor` `:252-263`), repeater ring
  via stroke (`MAP_REPEATER_RING`, `:1172-1177`).
- **Popup chrome:** hardcoded Tailwind gray utility classes
  (`text-gray-500`, `text-gray-400`) not theme tokens
  (`frontend/src/components/MapView.tsx:1203-1205`); contact-name link uses
  `text-primary` (`:1190`).
- **Legend today:** a **recency** legend (`<1h`/`<1d`/`<3d`/older + repeater
  ring) rendered inline in the info bar, plus a packet-type legend when
  "Visualize packets" is on (`:940-1027`). There is **no contact-type legend**
  (client/repeater/room/sensor).
- **Filters/controls:** a "Since" chip group + custom datetime, "Visualize
  packets", "Discover nodes" checkboxes, all in one flex info bar that stacks
  `md:flex-row` (`:932-1108`). This is the only responsive handling and it is
  content-reflow only, not map-control chrome.
- **Packet replay:** a `<canvas>` overlay appended to the Leaflet container at
  `z-index:450` drawing animated particles along resolved hop paths, plus faint
  `Polyline` route lines (`ParticleOverlay` `:404-564`; `routeLines` `:903-914`;
  render `:1146-1153`). Reads the out-of-React `rawPacketStore`
  (`useRawPackets`, `:576`; store contract in `frontend/AGENTS.md` "State
  ownership").
- **Fit/focus:** `MapBoundsHandler` fits bounds or geolocates on first mount and
  `setView` on focused contact (`:344-400`).
- **Tests:** `frontend/src/test/mapView.test.tsx` exists
  (`frontend/AGENTS.md` frontend-map listing). jsdom has no layout/WebGL, so
  map runtime behavior is not covered by vitest (same constraint the AGENTS doc
  records for `MessageList` virtualization) - this matters for the Phase 2
  verification plan (section 7).

### 2.2 Theme system (for the Phase 1 quick-win)

- Themes are `data-theme` attribute blocks overriding HSL custom-property tokens
  defined on the default `:root` (`frontend/src/index.css:41+`), with per-theme
  overrides in `frontend/src/themes.css` (light, windows-95, ios, cyberpunk,
  high-contrast, obsidian-glass, solar-flare, lagoon-pop, candy-dusk,
  paper-grove, monochrome, darkdutch). There is also a `follow-os` mode
  (`frontend/src/utils/theme.ts:FOLLOW_OS_THEME_ID`).
- The map has **no** theme integration. `frontend/src/styles.css:56-67` styles
  only `.leaflet-container` / `.leaflet-pane` / `.leaflet-control` z-index. There
  are no rules for `.leaflet-popup*`, the `LayersControl` panel, or attribution.
  Result: Leaflet popups and the layer switcher render white/default regardless
  of the active theme; on dark themes they are jarringly bright.
- Contact-type constants exist only partially:
  `frontend/src/types.ts:482-483` defines `CONTACT_TYPE_REPEATER = 2` and
  `CONTACT_TYPE_ROOM = 3`; there are no named constants for client (1) or sensor
  (4). The canonical type table is `AGENTS.md` "Contact Types": `0` Unknown, `1`
  Client, `2` Repeater, `3` Room, `4` Sensor.

### 2.3 Related surfaces that constrain the design

- `NeighborsMiniMap.tsx` also uses react-leaflet with a hardcoded OSM raster
  `TileLayer` (`frontend/src/components/NeighborsMiniMap.tsx:59-61`), and
  `ContactInfoPane` embeds a Leaflet GPS mini-map (`frontend/AGENTS.md` "Contact
  Info Pane"). Any theme-CSS quick-win for Leaflet chrome benefits these too;
  any engine swap must decide whether these follow.
- Packet decoding on the map goes through `utils/visualizerUtils.ts` /
  `utils/rawPacketIdentity.ts` (`frontend/src/components/MapView.tsx:19-25`).
  Unchanged by this plan.

---

## 3. Reference research: EU analyzer map stack (cited)

All paths below are under
`G:\Github\repositories\Elektr0Vodka\EU-Meshcore-Analyzer\web`.

### 3.1 Engine and libraries

- **MapLibre GL JS 4.7.1**, vendored: `vendor/maplibre-gl-4.7.1.js` +
  `vendor/maplibre-gl-4.7.1.css` (referenced from `web/index.html`). This is the
  core 2D/3D vector renderer.
- **deck.gl**, vendored `vendor/deck.gl.js`, lazy-loaded via
  `js/lib/deck-loader.js` and used only for the 3D trace/arc renderer
  (`js/pages/livemap/livemap-deck.js`, wired in `livemap.js:9-10`). deck.gl is
  NOT required for nodes/links/buildings; those are plain MapLibre layers.
- No `three`/`mapbox-gl` in the map path. (three-like 3D is deck.gl's job.)

### 3.2 Basemaps (vector-first, raster fallback)

- `js/lib/maplibre-basemap.js`: `OFM_BASEMAPS` = OpenFreeMap vector styles
  positron/liberty/dark/fiord (keyless, `https://tiles.openfreemap.org/styles/*`,
  `:19-29`); CARTO vector entries (`cartoVectorEntry`, `:45-51`); `rasterStyle`
  builds an inline v8 style for classic raster tiles with a `maxzoom` cap
  (`:152-166`) - the same cap idea RTFM-EV already applies via
  `MaxZoomByActiveLayer`. `applyBasemap` swaps basemaps and re-applies overlays,
  with a no-op guard `basemapSig` (`:186-257`).
- `js/lib/eua-basemap.js`: `recolorDark(style)` recolours the keyless
  OpenFreeMap dark vector style into a navy "EUA" ground without mutating input,
  passing unknown layers through (`:16-48`); registry entry kind
  `'vector-recolor'` (`:59-61`).
- DMC "Nova" reference: `DutchMeshCore-Observers/web/js/lib/dmcbasemap.js` is the
  same technique - a recolour of the OpenFreeMap dark vector style
  (`tiles.openfreemap.org/styles/dark`) into the "Nova" dark basemap
  (`dmcbasemap.js:1-79`). DMC Observers also runs MapLibre GL (vendored
  `web/css/vendor/maplibre-gl.css`). This confirms the memory note "Nova is an
  OpenFreeMap VECTOR style needing maplibre-gl".

### 3.3 2D / 3D control

- `js/lib/map-2d-lock.js`: `setMapLock2D(map, on)` - on=true flattens the camera
  (`pitch=0, bearing=0` via `easeTo`), disables drag-rotate / two-finger
  rotate+pitch / keyboard rotate, and clamps `setMaxPitch(0)`; on=false restores
  handlers and `maxPitch` (default 60) (`:15-37`). Guarded so a null/stub map
  never throws (unit-testable under Node).
- Wired in `livemap.js` as `lm-2d` / `lm-3d` buttons (`:1252`, `:1317`). Note the
  `lm-3d` toggle in `livemap.js:1580-1584` switches the **trace renderer**
  (canvas <-> deck.gl 3D), which is distinct from map tilt; tilt is what
  `setMapLock2D` governs.

### 3.4 3D buildings

- `js/lib/maplibre-basemap.js:70-147`: `buildingsPaint(theme)` returns the
  fill-extrusion paint (color by light/dark, `fill-extrusion-height` =
  `coalesce(render_height,0)`, base = `render_min_height`, opacity 0.85,
  `:72-80`); `buildingsLayerSpec` is a `fill-extrusion` layer on the OpenMapTiles
  `building` source-layer at `minzoom 12` (`:85-90`); `setBuildings3D(map, on,
  theme)` adds/removes it, reusing the `openmaptiles` source on a vector basemap
  or adding a dedicated `ofm-buildings` vector source over a raster basemap
  (`ensureBuildingsSource` `:116-123`), and eases `pitch` to 45 on enable
  (`:129-147`). Errors swallowed (non-fatal). Buildings therefore work over
  EITHER a vector OR a raster basemap - important, because RTFM-EV's raster
  basemaps could keep buildings without a full vector migration.
- i18n confirms UX copy: `lbl_buildings: '3D buildings'`,
  `wardriving_buildings_hint: 'Show 3D building extrusions (OpenFreeMap); tilts
  the map when on'` (`js/lib/i18n.js:430,1266-1267`).

### 3.5 Node-size control + GL node layer

- `js/pages/livemap/livemap-nodes-gl.js`: a GL `circle` layer over a geojson
  source replacing Leaflet circleMarkers (`:87-116`). `circleRadiusExpr(baseR,
  repeaterR)` makes repeaters slightly larger (`:42-44`); `setNodeScale(factor)`
  multiplies both radii live via `setPaintProperty` (`:121-126`); freshness tier
  drives opacity (`circleOpacityExpr` `:35-39`); role drives color
  (`circleColorExpr` `:27-32`). Reattaches after a basemap `setStyle` drops
  layers (`:185-189`).
- Node-size slider wiring: `livemap.js:1328-1331` builds `lm-node-size` in the
  control panel; `livemap.js:1576-1578` `wireRange('lm-node-size', ...)` calls
  both `traces.setNodeSize(v)` and `nodeLayer.setNodeScale(v)`. i18n:
  `lm_node_size_label: 'Node size'`, `lm_tip_node_size: 'Size of the node
  markers on the map'` (`js/lib/i18n.js:2563-2566`).

### 3.6 Additional layers/tools

- **Live view:** `js/pages/livemap/livemap.js` streams packets into a live feed
  and animated traces (`livemap-feed`, `lm-feed-toggle`, `:562-601`); the
  animated traces are the maplibre/deck twin of RTFM-EV's existing particle
  overlay.
- **Per-link lines:** `js/pages/livemap/livemap-links.js`: `initLinks(map,
  cache)` draws persistent bowed arcs from a `/api/links` edge feed as an
  `lm-links` GeoJSON line layer **below** the node layer; color ramps by
  normalized traffic count `t` (`LINK_COLOR` `:119`), width by `t` (`:120`),
  opacity by edge staleness (`livenessOpacity` `:65-74`); poll every 60s while
  visible (`:176-201`). Explicitly notes there is no SNR field on the edge data,
  so "colour by SNR" is infeasible there (`:12-14`).
- **Legend:** `js/pages/livemap/livemap-legend.js`: a draggable modal with
  PACKET TYPES / NODE ROLES / MARKER STYLES sections (`fillLegend` `:28-60`);
  on compact viewports it becomes a sheet and tap-outside dismisses on <=768px
  (`:69-113`). Node roles listed: repeater, companion, room, sensor, observer,
  unknown (`:37-39`).
- **Triangulation:** separate self-contained app
  `G:\Github\repositories\Dutch-MeshCore\meshcore-triangulator\web-standalone`
  (`index.html` + stdlib `server.py`), Leaflet 1.9.4 for the 2D map plus a
  MapLibre `map3d` likelihood-surface view (`index.html:1382`, `map3d` refs
  `:3814+`). Method: RSSI/SNR-weighted clustering / grid log-likelihood scoring
  of "who heard what from where", observer weighting, optional terrain + LOS
  refinement (`meshcore-triangulator/AGENTS.md` sections 1,3). It resolves live
  against public mc-radar / map.meshcore.io feeds and is deployed at
  `triangulator.dutchmeshcore.nl`. It is NOT a small embeddable widget.

### 3.7 Responsive / mobile map chrome

- `js/lib/mobile.js`: two canonical queries - `MOBILE_QUERY = '(max-width:
  768px)'` and `COMPACT_MAP_QUERY = '(max-width: 1024px), (pointer: coarse)'`
  (`:27-28`). Compact-map covers phones and tablets (and any coarse-pointer
  device) but deliberately not touch laptops with a trackpad primary pointer
  (`:14-22`).
- `js/lib/control-panel.js`: `mountControlPanel(...)` is the shared floating,
  collapsible, pinnable panel for map pages; on `isCompactMap()` it parks and
  opens as a shared bottom **sheet** (`sheet-dock.js`) instead of a floating
  draggable panel, sharing the same section DOM + storage keys across desktop
  and phone (`:1-27`). This is the pattern for RTFM-EV's mobile map controls.
- Terrain/hillshade (optional, config-gated): `livemap.js:805-828` add a
  Terrarium `raster-dem` source only when `window.__ANALYSIS__.terrain_dem_url`
  is configured (`terrainAvailable()`), so terrain is not offered without a DEM
  provider. Out of scope for RTFM-EV unless a DEM URL is provisioned (OPEN
  QUESTION 6.7).

---

## 4. Design

### 4.1 Phase 1 - quick-wins (Leaflet, no engine change, no new deps)

These three ship independently of each other and of Phase 2. Effort is small;
value is high and visible. All obey "smallest change".

#### 4.1.1 Theme CSS alignment for on-map panels/popups/controls (QUICK WIN)

Problem: Leaflet popups, the `LayersControl` switcher, and attribution render in
Leaflet defaults, ignoring `data-theme` (`frontend/src/styles.css:56-67` has no
color rules). MapView popup text is hardcoded gray
(`frontend/src/components/MapView.tsx:1203-1205`).

Design:

1. Add themed CSS for Leaflet chrome in `frontend/src/styles.css` (or a new
   `map.css` imported once), driven by the existing HSL tokens:
   `.leaflet-popup-content-wrapper`, `.leaflet-popup-tip`,
   `.leaflet-popup-close-button` -> `hsl(var(--popover))` /
   `hsl(var(--popover-foreground))` / `hsl(var(--border))`; the
   `.leaflet-control-layers` panel + `.leaflet-bar` buttons ->
   `hsl(var(--card))` / `--card-foreground` / `--border`;
   `.leaflet-control-attribution` -> `--muted` / `--muted-foreground`. These are
   plain global rules; they inherit whatever `data-theme` is on `:root`, so all
   12 themes + follow-os are covered with one block.
2. Replace the hardcoded `text-gray-500` / `text-gray-400` popup classes with
   `text-muted-foreground` (matches the canonical style reference in
   `frontend/AGENTS.md` "Styling"; helper/metadata text convention).
3. Because these rules also style `NeighborsMiniMap` and the ContactInfoPane
   mini-map, verify those two still read correctly (they share `.leaflet-*`
   chrome).

Facts: only z-index rules exist today (`styles.css:56-67`); popup text is
hardcoded gray (`MapView.tsx:1203-1205`). Assumption: token-based Leaflet CSS
covers every theme because themes only swap the tokens (verified pattern across
`themes.css`). No JS change required.

#### 4.1.2 Node-type legend for contact types 1/2/3/4 (QUICK WIN)

Problem: the current legend explains recency and packet type, not node type
(`MapView.tsx:940-1027`). Users cannot tell client vs repeater vs room vs sensor
from the marker.

Design:

1. Add a small legend group (client / repeater / room / sensor), mirroring the
   existing recency legend markup and a11y pattern (`role="group"
   aria-label=...`, `MapView.tsx:945-982`). Labels/order from `AGENTS.md`
   "Contact Types": 1 Client, 2 Repeater, 3 Room, 4 Sensor (0 Unknown optional).
2. Requires the map to distinguish types visually first. Today only repeaters
   are distinguished (ring + radius 10, `MapView.tsx:1156-1177`); client/room/
   sensor all render identically. Two sub-options:
   - **Minimal:** keep marker rendering, make the legend explain the ONE
     distinction that exists (repeater ring) plus a note. Low value.
   - **Recommended:** give each type a marker glyph/shape or ring style (e.g.
     room = square-ish via a small DivIcon, sensor = diamond, client = plain
     dot, repeater = ringed dot), then the legend maps glyph->type. This is a
     rendering change inside the existing `CircleMarker` map (or a switch to
     `L.marker` + `divIcon` for non-clients). Keep recency as fill color;
     type as shape/ring so the two encodings do not collide.
3. Add named constants for types 1 and 4 in `frontend/src/types.ts` (only
   `CONTACT_TYPE_REPEATER=2` and `CONTACT_TYPE_ROOM=3` exist today, `:482-483`)
   so the legend and marker code do not use bare literals.

Facts: type table is canonical in `AGENTS.md`; constants for 1/4 are missing
(`types.ts:482-483`); only repeaters are visually distinct today (`:1156-1177`).
Assumption: shape/ring encoding is legible alongside recency fill color (verify
in browser at both themes, section 7).

#### 4.1.3 Responsive map controls + mobile chrome (QUICK WIN, Leaflet)

Problem: all controls live in one info bar that only reflows
(`MapView.tsx:932-1108`); on a phone the "Since" chips + checkboxes + legends
crowd the top and the map shrinks. There is no collapsible/sheet affordance and
no node-size control at all.

Design (Leaflet-compatible, no maplibre):

1. Adopt the EU analyzer's breakpoint vocabulary as constants (do not hardcode
   768/1024 at call sites): a mobile query `(max-width: 768px)` and a compact-map
   query `(max-width: 1024px), (pointer: coarse)` (from `mobile.js:27-28`). RTFM
   already ships `react-swipeable` (`frontend/package.json:43`) and shadcn Sheet
   primitives (used for the mobile sidebar, `styles.css:50-54`), so a bottom
   sheet needs no new dep.
2. On compact viewports, collapse the info-bar controls (Since filter, packet
   toggles, legends) into a single "Map controls" button that opens a shadcn
   Sheet / bottom drawer; on desktop keep the inline bar (or an optional
   floating collapsible panel). Reuse the existing control state; only the
   container changes, matching `control-panel.js`'s "same section DOM in both
   modes" principle (`control-panel.js:20-27`).
3. Add a **node-size slider** (Leaflet path): CircleMarker `radius` is a plain
   number (`MapView.tsx:1163`), so a `nodeScale` state (persisted to
   localStorage like `remoteterm-map-since`) multiplying `radius` gives the same
   affordance as `setNodeScale` without maplibre. This is the one net-new
   control and it is trivial on Leaflet.
4. Ensure the map fills the viewport minus the collapsed bar; verify Leaflet
   `invalidateSize` fires on sheet open/close and orientation change (Leaflet
   needs a resize kick when its container resizes).

Facts: single reflow-only info bar today (`MapView.tsx:932-1108`); CircleMarker
radius is a literal (`:1163`); shadcn Sheet + react-swipeable already present.
Assumption: a bottom-sheet control host is acceptable UX parity with the EU
analyzer's compact panel; confirm with the maintainer.

2D/3D and 3D-buildings are **explicitly deferred to Phase 2** - they require a
tilt-capable GL renderer. Leaflet cannot tilt or extrude. Do not attempt them in
Phase 1.

### 4.2 Phase 2 - MapLibre vector engine + 2D/3D/buildings + layers/tools

#### 4.2.1 Raster -> vector evaluation (the core decision)

What vector unlocks (all Leaflet-impossible today): map **tilt/rotate** (2D/3D
via `setMapLock2D`), **3D building extrusions** (`setBuildings3D`), live
**client-side restyling** (the DMC "Nova" recolour, `eua-basemap.js` /
`dmcbasemap.js`), crisp high-DPI labels, and data-driven paint expressions for
node color/size/opacity (`livemap-nodes-gl.js`). RTFM-EV's own memory note
records that the DMC "Nova" dark basemap is an OpenFreeMap vector style requiring
`maplibre-gl` + `@maplibre/maplibre-gl-leaflet`.

Two migration strategies:

- **A. Add-alongside (recommended first step).** Add `maplibre-gl` +
  `@maplibre/maplibre-gl-leaflet` and register a MapLibre vector base layer as
  ONE additional entry in the existing `TILE_LAYERS` / `LayersControl`
  (`MapView.tsx:66-140`), leaving all Leaflet markers/popups/particle overlay
  intact. `maplibre-gl-leaflet`'s `L.maplibreGL({ style })` renders a GL vector
  canvas as a Leaflet layer. This delivers the "Nova" vector basemap and keeps
  the whole existing component working.
  - Cost: two runtime deps; `maplibre-gl` is large (hundreds of KB gzipped -
    UNVERIFIED exact size, measure with `npm run build` bundle report).
  - Limitation: a GL layer inside Leaflet does **not** give tilt/3D - Leaflet
    owns the camera and is 2D-only. So add-alongside unlocks vector **styling**
    but NOT 2D/3D tilt or building extrusions. Buildings-3D and pitch need a
    MapLibre-owned camera.
- **B. Swap-engine (full MapLibre-native map).** Replace the Leaflet map with a
  MapLibre `Map` and reimplement nodes as a GL circle layer
  (`livemap-nodes-gl.js` pattern), popups as `maplibregl.Popup`, the particle
  overlay as a canvas/deck layer, and basemap switching via `applyBasemap`. This
  is the only path that delivers 2D/3D tilt + 3D buildings + node-size-as-paint
  at full EU-analyzer fidelity.
  - Cost: a rewrite of `MapView.tsx` (~1200 lines) and its tests; the particle
    overlay's `latLngToContainerPoint` math (`MapView.tsx:461`) must be redone
    against MapLibre's `project()`; `LayersControl`, marker refs, and
    `MapBoundsHandler` all rebuilt. `NeighborsMiniMap` + ContactInfoPane mini-map
    would remain Leaflet unless also migrated (mixed-engine maintenance cost).

Recommendation: do **A first** to land the vector basemap cheaply, then decide
whether the 2D/3D + buildings payoff justifies **B**. If 2D/3D/buildings are the
whole point, B is unavoidable - but scope it as its own plan slice, gated behind
Phase 1 shipping and a bundle-size/mobile-WebGL check (section 6).

#### 4.2.2 2D/3D toggle + 3D buildings (requires strategy B, or B-for-the-map-only)

- Port `setMapLock2D` (`map-2d-lock.js:15-37`) verbatim in spirit: a 2D/3D
  toggle button that flattens/unlocks pitch+bearing and clamps `maxPitch`.
- Port `setBuildings3D` + `buildingsLayerSpec` + `buildingsPaint`
  (`maplibre-basemap.js:70-147`): a "Buildings (3D)" toggle adding the
  `fill-extrusion` layer on the OpenMapTiles `building` source-layer at minzoom
  12, easing pitch to 45 on enable, colored per light/dark theme (feed the
  active `data-theme`'s resolved light/dark into `buildingsPaint`'s `theme` arg).
  Buildings work over a vector OR raster basemap via `ensureBuildingsSource`, so
  once the map camera is MapLibre-owned this does not force a vector basemap.
- Node-size becomes a paint property (`setNodeScale`,
  `livemap-nodes-gl.js:121-126`) instead of a JS radius multiply.

#### 4.2.3 Additional layers/tools

- **Live view:** RTFM already replays live packets via the particle overlay off
  `rawPacketStore` (`MapView.tsx:767-847`). Under MapLibre this becomes a GL/deck
  trace layer (EU analyzer `livemap-deck.js`), or the existing canvas overlay is
  retained. Low new-value; mostly a re-implementation. Keep the canvas overlay
  unless B is adopted.
- **Per-link lines:** port `initLinks` (`livemap-links.js:128-201`) as an
  `lm-links` line layer below nodes, colored by traffic count, faded by
  liveness. BLOCKER / OPEN QUESTION: the EU analyzer draws from a `/api/links`
  edge feed produced by its Go backend; **RTFM-EV has no `/api/links` endpoint**
  (not in the `AGENTS.md` API table). RTFM does build a mesh graph client-side
  in `frontend/src/networkGraph/packetNetworkGraph.ts` (shared with the
  visualizer) and stores advert paths server-side
  (`contact_advert_paths`, `AGENTS.md` "Contact Advert Path Memory"). A links
  layer must derive edges from one of those, not invent an endpoint. Scope the
  edge-source decision before building this.
- **Triangulation:** the triangulator is a separate, self-contained app with its
  own SNR-weighted grid-likelihood engine, terrain/LOS refinement, and 3D
  surface view, resolving against public feeds (section 3.6). Realistic options,
  cheapest first: (a) a deep-link "Triangulate on triangulator.dutchmeshcore.nl"
  action from a node popup (mirrors plan [04] analyzer-lookup's deep-link
  pattern), (b) embed the standalone app in an iframe/tab, (c) a from-scratch
  port of the estimator. Recommend (a); (c) is a separate large plan, not part
  of this map overhaul.
- **Basemaps to add:** DMC "Nova" (recolour of OpenFreeMap dark,
  `dmcbasemap.js`), plus the OpenFreeMap positron/liberty/dark/fiord vector
  styles (`maplibre-basemap.js:24-29`). All keyless. Keep the existing keyless
  raster presets as fallbacks (they already carry `maxZoom` caps,
  `MapView.tsx:66-131`).

---

## 5. Phasing and first slice

Order (each slice independently shippable, smallest first):

1. **Slice 1a - theme CSS (4.1.1).** Add themed `.leaflet-*` rules + swap popup
   grays for `text-muted-foreground`. No JS logic change. Verify all themes.
2. **Slice 1b - node-type legend + type glyphs (4.1.2).** Add type constants,
   type-distinguishing markers, and the legend group.
3. **Slice 1c - responsive controls + node-size slider (4.1.3).** Breakpoint
   constants, mobile sheet host for controls, Leaflet node-size multiply.
4. **Slice 2a - vector basemap add-alongside (4.2.1-A).** Add `maplibre-gl` +
   `@maplibre/maplibre-gl-leaflet`, one "Nova / OpenFreeMap" vector entry in
   `LayersControl`. Measure bundle. Decision gate on strategy B.
5. **Slice 2b (gated) - MapLibre-native map (4.2.1-B) + 2D/3D + buildings +
   node-size-as-paint (4.2.2).** Rewrite scope; own review.
6. **Slice 2c (gated) - per-link lines (needs edge-source decision) and
   triangulation deep-link (4.2.3).**

**Recommended first slice to implement: Slice 1a (theme CSS).** It is the
lowest-risk, highest-clarity win, touches only CSS + three JSX class names, has
no dependency on any other slice, and immediately fixes the most jarring current
defect (white popups/controls on dark themes). It also de-risks
`NeighborsMiniMap` / ContactInfoPane mini-map theming for free.

---

## 6. Risks and open questions

1. **Engine swap vs add-alongside.** Add-alongside (A) gives vector styling but
   NOT tilt/3D/buildings (Leaflet owns a 2D camera). Full 2D/3D/buildings needs a
   MapLibre-native camera (B), which is a `MapView.tsx` rewrite (~1200 lines) +
   test rewrite + particle-overlay reprojection (`MapView.tsx:461`). Decide the
   appetite before Slice 2b.
2. **Bundle size (UNVERIFIED).** `maplibre-gl` is large; deck.gl (if used for
   3D traces) is larger. RTFM has no map GL dep today
   (`frontend/package.json:18-49`). Measure with `npm run build` before
   committing to Phase 2. Consider lazy-loading the GL layer only when the map
   route is opened (the app already code-splits surfaces via `ConversationPane`).
3. **WebGL on mobile.** MapLibre + tilt + building extrusions are GPU-heavier
   than raster tiles; low-end phones may stutter or hit WebGL context limits.
   The EU analyzer gates compact chrome via `(pointer: coarse)` but still runs
   GL. Verify on a real phone (section 7). Provide a raster fallback basemap and
   keep buildings/tilt off by default on compact.
4. **Mixed-engine maintenance.** If B migrates only the main map, `NeighborsMiniMap`
   and the ContactInfoPane mini-map stay Leaflet - two map engines to maintain.
   Decide whether they follow.
5. **Per-link edge source (BLOCKER for the links tool).** RTFM-EV has no
   `/api/links`. Edges must come from `packetNetworkGraph.ts` or
   `contact_advert_paths`; the EU analyzer's `initLinks` cannot be ported as-is.
6. **Triangulation scope.** A from-scratch estimator port is a large separate
   plan; recommend a deep-link/iframe to the standalone app instead.
7. **Terrain/hillshade.** EU analyzer gates these on a configured DEM URL
   (`livemap.js:805-828`); RTFM has no DEM provider. Out of scope unless one is
   provisioned. OPEN QUESTION: is a keyless Terrarium DEM acceptable?
8. **OpenFreeMap dependency.** Vector basemaps fetch styles/tiles from
   `tiles.openfreemap.org` (third party, keyless). Adds a runtime external
   dependency the current keyless-raster set also has, but confirm the offline/
   air-gapped posture is acceptable (RTFM is often run on a trusted LAN).
9. **Theme -> basemap coupling.** Should the basemap auto-follow light/dark
   `data-theme` (e.g. Nova on dark, positron on light)? EU analyzer keeps them
   independent (a saved basemap pick). Recommend independent + a manual picker;
   confirm.

---

## 7. Verification plan (runtime, browser-observed)

Per `AGENTS.md` "Never claim it works without proof": jsdom/vitest cannot render
Leaflet or WebGL, so map behavior MUST be observed in a real browser. Two
independent checks minimum per slice, output captured.

Phase 1:

1. `cd frontend && npm run build` (tsc + vite) passes; `npm run test:run`
   (including `mapView.test.tsx`) green.
2. Browser observation at three viewports (desktop ~1440px, tablet ~820px,
   phone ~390px) AND in at least a dark theme (Original/DarkDutch) and a light
   theme (Light/Paper Grove):
   - 1a: open a node popup and the `LayersControl`; confirm popup wrapper, tip,
     close button, layer switcher, and attribution use theme tokens (not white)
     in both themes. Repeat on `NeighborsMiniMap` and the ContactInfoPane
     mini-map.
   - 1b: confirm each contact type is visually distinguishable and the legend
     matches; confirm recency fill still reads independently of the type glyph.
   - 1c: confirm controls collapse to a sheet on phone/tablet, the map fills the
     remaining space (Leaflet `invalidateSize` fires on sheet open/close +
     rotate), and the node-size slider scales markers live and persists across
     reload.

Phase 2 (additional):

3. Bundle-size delta from `npm run build` output, before vs after adding
   `maplibre-gl` (+ `maplibre-gl-leaflet`); record the number.
4. Vector basemap ("Nova"/OpenFreeMap) renders and is selectable; markers/
   popups/particles still work over it.
5. If B: 2D/3D toggle tilts and flattens; 3D buildings extrude at zoom >= 12 and
   recolor with theme; verify frame rate is acceptable on a real low/mid phone
   (risk 3), with a raster fallback confirmed working when WebGL is unavailable.

Confirm each check is on this branch's build and the URL/route under test is the
map view (`#map`, `frontend/AGENTS.md` "URL Hash Navigation").

---

## 8. Effort estimate (rough, relative)

- Slice 1a (theme CSS): **S** (CSS + 3 class swaps; hours). Lowest risk.
- Slice 1b (type legend + glyphs): **S-M** (marker rendering change + constants +
  legend + a11y).
- Slice 1c (responsive + node-size): **M** (sheet host, breakpoint constants,
  `invalidateSize` handling, localStorage persistence).
- Slice 2a (vector add-alongside): **M** (2 deps, one LayersControl entry,
  bundle measurement, cross-check overlays still render).
- Slice 2b (MapLibre-native + 2D/3D + buildings): **L** (MapView rewrite + test
  rewrite + particle reprojection + camera controls). Own plan-sized review.
- Slice 2c (links + triangulation link-out): **M-L**, blocked on the edge-source
  decision (risk 5) for links; triangulation is **S** as a deep-link, **L** as a
  port.

Phase 1 total: **S-M**, no new deps, ships now. Phase 2 total: **L**, gated on
maintainer appetite for a GL rewrite and a bundle/mobile-WebGL check.

---

## 9. Reconciliation with existing artifacts

- `docs/plans/README.md` entry **[13]** already scopes this exactly ("quick-wins
  (theme CSS + legend + responsive) before the engine migration", "Opus",
  "Partial", references `EU-Meshcore-Analyzer`, `Meshcore-Analyzer`,
  `DutchMeshCore-Observers`, `MapView.tsx`, maplibre). This plan fills that slot;
  the dependency graph there already marks quick-wins independent and the engine
  migration standalone/larger.
- `docs/sources-of-truth.md`: EU MeshCore Analyzer is the map/mobile-layout
  reference (local path confirmed); DMC Observers is the basemap reference. Both
  verified present locally on 2026-09-10 (this research). NOTE: the README lists
  `Meshcore-Analyzer` as a reference, but the local
  `G:\Github\repositories\Meshcore-Analyzer` contains only
  `meshcore-mqtt-broker/` (no map/web client) - it is NOT a usable map-UX
  reference; the usable references are `EU-Meshcore-Analyzer`,
  `DutchMeshCore-Observers`, and `meshcore-triangulator`. Flag this in the README
  if it matters.
- Independent of the other plans; can slot alongside the [03]/[04]/[06]/[07] UX
  wins per the README build order ("Map: [13] quick-wins early ... engine
  migration last").
- The theme-CSS quick-win complements, and does not conflict with, the DMC
  `darkdutch` theme already in `themes.css` (a themed Leaflet popup will inherit
  DarkDutch tokens automatically).
