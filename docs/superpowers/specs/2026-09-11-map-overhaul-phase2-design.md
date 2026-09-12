# Map Overhaul Phase 2: MapLibre-native engine, 2D/3D + buildings, node-size, per-link, floating controls

Date: 2026-09-11
Status: DESIGN APPROVED (gates decided). Not started.
Master plan: `docs/plans/13-map-overhaul.md` (strategy + cited reference research).
Category: G (Map overhaul).
References (local, verified present): `G:\Github\repositories\Elektr0Vodka\EU-Meshcore-Analyzer`
(MapLibre + deck.gl UX target), `DutchMeshCore-Observers` (Nova basemap).

Scope note: this spec covers only Phase 2. Phase 1 quick-wins already shipped
(theme-aware basemaps, route path lines, node-type legend, responsive info bar).
Per `CLAUDE.md`: no commits/PRs are created from this document without explicit
instruction. Product framing unchanged: the map is a Tertiary quality-of-life
surface and must not regress Primary/Secondary features.

---

## 1. Decisions made (the gates)

Confirmed with the maintainer before design:

1. **Engine:** full **MapLibre-native rewrite** of `MapView.tsx` in ONE PR (not
   an add-alongside Leaflet layer). 2D/3D tilt and 3D buildings require MapLibre
   to own the camera; Leaflet cannot tilt or extrude. Commits inside the PR are
   sliced so the diff is reviewable piece by piece.
2. **Per-link edges:** derived **client-side from
   `frontend/src/networkGraph/packetNetworkGraph.ts`** (already built for the
   visualizer). No `/api/links` endpoint, no backend change, no migration.
3. **All Leaflet surfaces migrate:** `MapView`, `NeighborsMiniMap`, the
   ContactInfoPane GPS mini-map, `PathRouteMap`, and `LocationPickerModal` all
   move to MapLibre. Leaflet is then removed entirely (one engine everywhere).
4. **Controls UI:** the floating **FAB stack** (Layers / Info-Legend / Search
   plus 2D-3D, buildings, node-size) shows on **all viewports**. Desktop opens
   popovers/panels; compact viewports open bottom Sheets.
5. **FAB layer controls on every map:** every migrated surface gets the FAB
   controls, at minimum the **Layers** (basemap picker) FAB. Which FABs appear is
   configured per surface: the main map shows the full stack; the mini-maps /
   route map / location picker show Layers (and any control that makes sense for
   that surface). This is delivered by a shared controls component, not
   duplicated per surface.
6. **deck.gl:** **included**, lazy-loaded, for the 3D trace/arc renderer only.
   Packet replay stays the reprojected canvas overlay in 2D and switches to a
   deck.gl arc/trace layer in 3D, toggled by the 2D/3D control.

Consequence: Leaflet, react-leaflet and @types/leaflet are **removed** from the
frontend once all five surfaces are migrated. `maplibre-gl` and `deck.gl` are
added. No `maplibre-gl-leaflet` (that is the rejected add-alongside path).

---

## 2. Module decomposition

The current monolith (`frontend/src/components/MapView.tsx`, 1210 lines) is
split into focused units. Each has one job; the pure logic is unit-testable
under jsdom without WebGL. Paths are proposals, adjust to match existing folder
conventions during planning.

### 2.1 `frontend/src/map/engine/`

- **`basemaps.ts`** - basemap registry + `applyBasemap(map, id)` with a no-op
  signature guard (port of `maplibre-basemap.js applyBasemap`). Entries:
  - Vector: Nova (dark default), OpenFreeMap positron (light default), plus
    OpenFreeMap liberty / dark / fiord (keyless,
    `https://tiles.openfreemap.org/styles/*`).
  - Raster fallbacks: the existing keyless raster presets (OSM, Esri Dark/Light
    Gray, OpenTopoMap, Esri NatGeo, Esri World Imagery) rebuilt as inline v8
    raster styles, each keeping its `maxZoom` cap (the cap idea RTFM already
    applies via `MaxZoomByActiveLayer`).
  - Selection persists to the existing `remoteterm-map-layer` localStorage key
    (with the current `dark` -> `darkgray` migration preserved) and syncs across
    tabs, matching today's behaviour.
- **`novaRecolor.ts`** - pure port of `dmcbasemap.js` recolour (OpenFreeMap dark
  vector style -> Nova navy), no input mutation, unknown layers passed through.
  Unit-testable.
- **`mapLock2D.ts`** - port of `setMapLock2D(map, on)`: flatten pitch/bearing via
  `easeTo`, disable drag-rotate / two-finger rotate+pitch / keyboard rotate,
  clamp `setMaxPitch(0)`; restore on off. Guarded against null/stub map.
  Unit-testable under Node.
- **`buildings3D.ts`** - port of `buildingsPaint(theme)` / `buildingsLayerSpec`
  / `setBuildings3D(map, on, theme)`: `fill-extrusion` on the OpenMapTiles
  `building` source-layer at `minzoom 12`, height from `render_height`, base from
  `render_min_height`, opacity 0.85, color per light/dark theme; ease pitch to 45
  on enable; `ensureBuildingsSource` so buildings work over a vector OR raster
  basemap. Errors swallowed (non-fatal). Spec builders unit-testable.

### 2.2 `frontend/src/map/layers/`

- **`nodesLayer.ts`** - GL `circle` layer over a geojson source (port of
  `livemap-nodes-gl.js`): `circleRadiusExpr(baseR, repeaterR)` (repeaters
  larger), `setNodeScale(factor)` multiplying both radii live via
  `setPaintProperty`, `circleOpacityExpr` by freshness tier, `circleColorExpr`
  by role. Reattaches after a basemap `setStyle` drops layers. Repeater ring via
  `circle-stroke-color` / `circle-stroke-width` paint on the same circle layer.
- **`linksLayer.ts`** GL line layer added **below** the node layer. Edges
  derived from `packetNetworkGraph.ts` (client-side), not `/api/links`. VERIFIED:
  `PacketNetworkLink` is `{ sourceId, targetId, lastActivity }` only, with no
  traffic-count and no SNR field. So links encode **liveness only**: opacity fades
  by `lastActivity` recency, with a fixed line width and color. Endpoints map to
  contact `lat`/`lon`. Refresh when the projection updates. (A per-edge count
  derived from `state.observations` is a possible later enhancement, out of scope.)
- **`particleOverlay.ts`** - the existing canvas packet-replay overlay,
  reprojected against MapLibre `map.project(lngLat)` instead of Leaflet
  `latLngToContainerPoint`. Reads the out-of-React `rawPacketStore`
  (`useRawPackets`). Active in 2D mode.
- **`tracesDeck.ts`** - lazy-loaded deck.gl arc/trace layer (port of
  `livemap-deck.js` pattern) for 3D mode. Loaded only when the user switches to
  3D; the 2D/3D control swaps canvas overlay <-> deck layer.

### 2.3 `frontend/src/map/controls/`

- **`MapControls.tsx`** the floating vertical FAB stack. It is **configurable per
  surface** via a prop selecting which FABs to render (e.g.
  `{ layers, legend, search, tilt, buildings, nodeSize }`). Available FABs:
  Layers (basemap picker), Info/Legend, Search, 2D/3D lock, Buildings toggle,
  Node-size slider. Desktop: FABs open popovers/anchored panels. Compact
  (`COMPACT_MAP_QUERY`): FABs open shadcn bottom **Sheets** (`sheet` primitive +
  `react-swipeable`, both already in the app). Same control state and section DOM
  in both modes (the EU analyzer's "one vocabulary, two hosts" principle). The FAB
  button style ports `.map-fab` (44px circle, `--surface` bg, `--border`, shadow,
  20px stroke SVG) into the RTFM design tokens.
- **`breakpoints.ts`** (or reuse an existing util) shared constants
  `MOBILE_QUERY = '(max-width: 768px)'` and
  `COMPACT_MAP_QUERY = '(max-width: 1024px), (pointer: coarse)'`. No hardcoded
  768/1024 at call sites.
- **`legend/`** node-type legend (client / repeater / room / sensor), recency
  legend, and the packet-type legend (shown when Visualize-packets is on),
  reusing the existing `role="group" aria-label` a11y pattern.

### 2.4 Shared surface, orchestrator, and the five consumers

- **`MapSurface.tsx`** the shared MapLibre wrapper every map surface uses. It
  owns the map lifecycle (create once, `resize` on container change), the basemap
  registry + `applyBasemap` (with the persisted basemap pick), WebGL-absent raster
  fallback, and hosts `MapControls` with a per-surface FAB config. Consumers pass
  children/callbacks to add their own sources/layers/markers. This is what makes
  "FAB layer controls on every map" a single implementation, not five copies.
- **`MapView.tsx`** the main-map orchestrator built on `MapSurface`: owns React
  state (focused contact, since-filter, packet/discover toggles, 2D/3D, buildings,
  node scale), wires nodes + links + particle/deck overlays, subscribes to
  `rawPacketStore` and contacts, fit-bounds/geolocate on mount and `flyTo` on
  focused contact (port of `MapBoundsHandler`). Enables the **full** FAB stack.
- **`MiniMap.tsx`** a thin preset of `MapSurface` for small embeds (fixed center
  or fit-to-markers, no packet overlays). Enables the **Layers** FAB (and any
  other that fits). Used by `NeighborsMiniMap` and the ContactInfoPane GPS
  mini-map, which keep their own marker/polyline drawing.
- **`PathRouteMap.tsx`** and **`LocationPickerModal.tsx`** re-based on
  `MapSurface`: PathRouteMap draws the hop route as a GL line + markers and
  enables the Layers FAB; LocationPickerModal keeps its click-to-pick handler over
  `MapSurface` and enables the Layers FAB.
- **`types.ts`** add `CONTACT_TYPE_CLIENT = 1` and `CONTACT_TYPE_SENSOR = 4`
  (only `CONTACT_TYPE_REPEATER = 2` and `CONTACT_TYPE_ROOM = 3` exist today) so
  legend and marker code use named constants, not bare literals.

---

## 3. Behaviour and defaults

- **Basemaps:** Nova is the dark default, OpenFreeMap positron the light default;
  the rest are selectable. Basemap is **independent** of the app theme (a saved
  manual pick), matching the EU analyzer. Keyless raster presets remain as
  fallbacks.
- **Camera:** **2D-locked by default.** Buildings **off by default.** On compact
  viewports, tilt and buildings stay off by default (mobile-WebGL cost). If WebGL
  is unavailable, fall back to a raster basemap and disable tilt/buildings/deck.
- **Nodes:** color by role, opacity by recency, repeaters larger and ringed.
  Node-type legend maps color/shape -> type using the `CONTACT_TYPE_*` constants.
- **Node-size:** a GL paint property via `setNodeScale`, persisted to
  localStorage (new key, e.g. `remoteterm-map-node-scale`).
- **Preserved controls:** the Since-filter presets + custom datetime,
  Visualize-packets, and Discover-nodes move intact into the new panel/sheets.
  No behaviour change to the filter or packet decoding
  (`utils/visualizerUtils.ts` / `utils/rawPacketIdentity.ts` untouched).
- **2D/3D toggle:** flips `mapLock2D`; in 3D, packet replay uses the deck.gl
  trace layer; in 2D, the canvas overlay.

---

## 4. Cross-cutting concerns

- **Bundle size:** `maplibre-gl` and `deck.gl` are large. Lazy-load the whole map
  module (and deck.gl only on first 3D switch) so the GL dependency is not in the
  initial bundle. The app already code-splits surfaces. **Record the
  `npm run build` bundle-size delta** (before vs after) as a verification
  artifact. Note: the mini-maps also pull `maplibre-gl`, so it loads on first
  ContactInfoPane / Neighbors render too; still one shared lazy chunk.
- **i18n (enforced):** new user-facing strings need `t()` keys in EN/NL/DE
  (2D/3D, buildings, node-size, layers, links, search, legend labels). eslint +
  the i18n parity test block hardcoded strings. Mirror the EU analyzer copy where
  it fits (`lbl_buildings`, `lm_node_size_label`, etc.).
- **Third-party posture:** OpenFreeMap vector tiles/styles are keyless but
  third-party (`tiles.openfreemap.org`), the same class of external dependency as
  today's keyless raster tiles. Keep raster fallbacks so an air-gapped/LAN
  deployment still has a working map. Flag this in the PR description.
- **Leaflet removal:** after ALL FIVE surfaces are migrated (`MapView`,
  `NeighborsMiniMap`, ContactInfoPane mini-map, `PathRouteMap`,
  `LocationPickerModal`), remove `leaflet`, `react-leaflet`, `@types/leaflet` from
  `frontend/package.json`, delete the Leaflet-only CSS in
  `frontend/src/styles.css:56-67`, and drop `import 'leaflet/dist/leaflet.css'`
  everywhere. A final `grep -r leaflet frontend/src` must return zero before the
  removal commit.

---

## 5. Slicing inside the single PR (reviewable commits)

Ordered so each commit is coherent and, where possible, independently sensible:

1. Add deps (`maplibre-gl`, `deck.gl`), lazy-load wiring, `map/engine/basemaps.ts`
   registry + raster fallbacks + persistence. No UI wired yet.
2. `novaRecolor.ts` + Nova/OpenFreeMap vector basemaps, with unit tests.
3. `mapLock2D.ts` + `buildings3D.ts` spec builders, with unit tests.
4. `nodesLayer.ts` (color/size/opacity expressions, `setNodeScale`), with unit
   tests for the expression builders and the graph-to-geojson mapping.
5. `MapSurface.tsx` shared wrapper (map lifecycle, basemap apply, WebGL fallback)
   + `MapControls.tsx` FAB stack (configurable per surface) + `breakpoints.ts` +
   legends + i18n keys. This lands the "FAB layer controls on every map" host.
6. `MapView.tsx` main-map orchestrator on `MapSurface`, replacing the Leaflet
   render tree: nodes, themed popups, fit/geolocate/focus, since-filter and
   packet/discover toggles moved into the controls. Rewrite `mapView.test.tsx`.
7. `particleOverlay.ts` reprojection (2D) + `tracesDeck.ts` (3D) + the 2D/3D and
   buildings toggle wiring.
8. `linksLayer.ts` from `packetNetworkGraph.ts` (liveness-only), with unit tests
   for edge derivation.
9. `MiniMap.tsx`; migrate `NeighborsMiniMap` and the ContactInfoPane mini-map onto
   it, each enabling the Layers FAB.
10. Migrate `PathRouteMap.tsx` and `LocationPickerModal.tsx` onto `MapSurface`,
    each enabling the Layers FAB.
11. Remove `leaflet` / `react-leaflet` / `@types/leaflet` and the Leaflet CSS;
    verify `grep -r leaflet frontend/src` is empty; final build + test.

---

## 6. Verification plan (per AGENTS "never claim it works without proof")

jsdom/vitest cannot render WebGL, so runtime map behaviour MUST be observed in a
real browser. Minimum two independent checks per claim, output captured, on this
branch's build, at the `#map` route.

- **Unit (jsdom, no WebGL):** pure helpers - `novaRecolor`, `mapLock2D`,
  `buildings3D` specs, node color/size/opacity expression builders, links
  edge-derivation from `packetNetworkGraph.ts`, basemap registry + persistence.
  Rewritten `mapView.test.tsx`. Full `npm run test:run` green; `tsc --noEmit` and
  eslint clean; i18n parity test green.
- **Build:** `cd frontend && npm run build` passes; **bundle-size delta recorded**.
- **Runtime (browser-observed):** three viewports (desktop ~1440px, tablet
  ~820px, phone ~390px) AND at least one dark theme (Original/DarkDutch) and one
  light theme (Light/Paper Grove):
  - FAB stack visible on all three; opens popovers on desktop and bottom sheets
    on compact; controls operate the same state in both.
  - Basemap switch including Nova renders; nodes/popups/particles still render
    over each basemap.
  - 2D/3D toggle tilts and flattens; 3D buildings extrude at zoom >= 12 and
    recolor with theme.
  - Node-size slider scales markers live and persists across reload.
  - Per-link lines render from live graph edges and fade with staleness.
  - Particle overlay tracks correctly after reprojection (2D); deck.gl traces
    render in 3D.
  - Popups themed (not white) in both themes; both mini-maps render.
  - Raster fallback confirmed working when WebGL is unavailable.
- Capture screenshots at each viewport/theme for the PR.

---

## 7. Risks

1. **Big single review** (rewrite + mini-maps + links + controls + deck.gl).
   Mitigated by the sliced commit order in section 5 and per-slice unit tests.
2. **Bundle size** - measured, lazy-loaded; deck.gl only on 3D.
3. **Mobile WebGL perf** - tilt/buildings/deck off by default on compact; raster
   fallback when WebGL absent; verify on a real mid/low phone.
4. **Particle overlay reprojection** - the canvas math moves from Leaflet
   `latLngToContainerPoint` to MapLibre `project()`; verify tracking on pan/zoom
   and (if allowed) tilt.
5. **Links have no SNR** - color by traffic count/liveness only; confirm the
   graph's per-edge fields during planning.
6. **OpenFreeMap dependency** - third-party keyless; raster fallbacks retained
   for LAN/air-gapped posture.
7. **Leaflet removal** - verify no non-map surface imports Leaflet before
   deleting the deps.

---

## 8. Out of scope (explicitly)

- Any `/api/links` backend endpoint or migration (edges are client-side).
- Triangulation port (a separate large plan; a deep-link to
  `triangulator.dutchmeshcore.nl` from a node popup is a possible later add).
- Terrain/hillshade (needs a DEM URL RTFM does not provision).
- Phase 1 items (already shipped).
