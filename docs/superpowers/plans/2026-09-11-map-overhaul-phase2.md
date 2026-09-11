# Map Overhaul Phase 2 (MapLibre migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Leaflet map stack across all five map surfaces with a shared MapLibre-GL engine that adds vector basemaps (incl. Nova), 2D/3D tilt, 3D buildings, a node-size control, a client-side per-link layer, and floating FAB layer controls on every map, then remove Leaflet entirely.

**Architecture:** One shared `MapSurface` React wrapper owns the MapLibre map lifecycle, basemap registry/apply, WebGL fallback, and hosts a per-surface-configurable `MapControls` FAB stack. The main `MapView` builds on it and adds nodes/links/packet overlays; the two mini-maps, `PathRouteMap`, and `LocationPickerModal` are thin `MapSurface` consumers. Pure engine/layer logic (basemap style builders, recolour, camera lock, buildings spec, node/link expressions and geojson builders) lives in framework-free modules that are unit-tested under jsdom; WebGL-dependent behaviour is verified in a real browser.

**Tech Stack:** React 18 + TypeScript + Vite + Vitest/jsdom; `maplibre-gl` (new), `deck.gl` (new, lazy), shadcn Sheet + `react-swipeable` (existing), i18n EN/NL/DE (existing).

**Spec:** `docs/superpowers/specs/2026-09-11-map-overhaul-phase2-design.md`
**Master plan:** `docs/plans/13-map-overhaul.md`

---

## Conventions for every task

- Run all commands from `frontend/` unless stated. The worktree root is the repo root.
- Test one file: `npx vitest run src/test/<file> -t "<name>"`. Full suite: `npm run test:run`.
- Type-check: `npx tsc --noEmit` (there is no separate `typecheck` script; `npm run build` runs `tsc && vite build`). Lint: `npm run lint`.
- **Per `CLAUDE.md`: do NOT commit or push unless the human running the plan explicitly says so.** Each task ends with a `git add`/`git commit` step written as the intended commit; treat committing as gated on that instruction.
- **No em dashes** in any code comment, string, or doc (repo rule).
- **i18n:** every user-facing string is a `t('key')` with the key added to all three of `src/i18n/locales/{en,nl,de}.json`. `src/test/i18nParity.test.ts` enforces parity.
- Runtime map behaviour that needs WebGL cannot be asserted in jsdom. Those tasks carry a **Browser verification** block instead of a unit assertion; capture a screenshot per the spec's verification plan.

---

## File structure

New (`frontend/src/map/`):

- `engine/basemaps.ts` basemap registry, `rasterStyle`, `basemapSig`, `resolveBasemapKind`, `switchStrategy`, `applyBasemap`, `markBasemapApplied`, persistence (`remoteterm-map-layer`).
- `engine/novaRecolor.ts` `NOVA_PALETTE`, `recolorNovaDark(style)`.
- `engine/mapLock2D.ts` `setMapLock2D(map, on, opts?)`.
- `engine/buildings3D.ts` `buildingsPaint`, `buildingsLayerSpec`, `ensureBuildingsSource`, `setBuildings3D`.
- `engine/webgl.ts` `isWebglAvailable()`.
- `layers/nodesLayer.ts` node color/opacity/radius expressions, `buildNodeFeatures`, `createNodesLayer(map, opts)` controller.
- `layers/linksLayer.ts` `buildLinkArcs`, `livenessOpacity`, `createLinksLayer(map, opts)` controller.
- `layers/particleOverlay.ts` `createParticleOverlay(map)` (canvas, MapLibre-projected).
- `layers/tracesDeck.ts` `loadDeck()`, `createDeckTraces(map)` (lazy deck.gl arcs).
- `controls/breakpoints.ts` media-query constants + `useIsCompactMap()` hook.
- `controls/MapControls.tsx` configurable FAB stack (popovers on desktop, bottom Sheets on compact).
- `controls/legend/MapLegend.tsx` node-type + recency + packet-type legend body.
- `MapSurface.tsx` shared MapLibre wrapper + hosts `MapControls`.
- `MiniMap.tsx` thin `MapSurface` preset for small embeds.

Modified:

- `frontend/src/types.ts` add `CONTACT_TYPE_CLIENT`, `CONTACT_TYPE_SENSOR`.
- `frontend/src/components/MapView.tsx` rewritten on `MapSurface`.
- `frontend/src/components/NeighborsMiniMap.tsx`, `ContactInfoPane.tsx` (mini-map), `PathRouteMap.tsx`, `LocationPickerModal.tsx` re-based on `MapSurface`/`MiniMap`.
- `frontend/src/styles.css` remove `.leaflet-*` block (56-67); add MapLibre control/popup theming.
- `frontend/package.json` add `maplibre-gl`, `deck.gl`; remove `leaflet`, `react-leaflet`, `@types/leaflet`.
- `frontend/src/test/setup.ts` add a WebGL/canvas + maplibre-gl mock usable by component tests.
- Tests: rewrite `mapView.test.tsx`, `pathRouteMap.test.tsx`; new unit tests under `src/test/map/`.

Removed after migration: all `import 'leaflet/dist/leaflet.css'` and `react-leaflet` imports.

---

## Slice 1: dependencies, WebGL probe, basemap registry

### Task 1: Add dependencies and a WebGL probe

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/map/engine/webgl.ts`
- Test: `frontend/src/test/map/webgl.test.ts`

- [ ] **Step 1: Install runtime deps**

Run (from `frontend/`):
```bash
npm install maplibre-gl@^4.7.1 deck.gl@^9.0.0
```
Expected: `package.json` gains `maplibre-gl` and `deck.gl` under dependencies; `package-lock.json` updates. (Pin the actual resolved versions the install produces; `^4.7.1` matches the EU analyzer's vendored MapLibre.)

- [ ] **Step 2: Write the failing test for the WebGL probe**

```ts
// frontend/src/test/map/webgl.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isWebglAvailable } from '../../map/engine/webgl';

afterEach(() => vi.restoreAllMocks());

describe('isWebglAvailable', () => {
  it('returns true when a webgl context is obtainable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as unknown as RenderingContext);
    expect(isWebglAvailable()).toBe(true);
  });

  it('returns false when no context is obtainable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(isWebglAvailable()).toBe(false);
  });

  it('returns false when getContext throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('no gl'); });
    expect(isWebglAvailable()).toBe(false);
  });
});
```

- [ ] **Step 3: Run it, expect failure**

Run: `npx vitest run src/test/map/webgl.test.ts`
Expected: FAIL (module `../../map/engine/webgl` not found).

- [ ] **Step 4: Implement the probe**

```ts
// frontend/src/map/engine/webgl.ts
/**
 * Best-effort check that a WebGL context can be created. MapLibre needs WebGL;
 * when it is unavailable (locked-down browser, headless, blocklisted GPU) the
 * map falls back to a raster basemap and disables tilt/buildings/deck.
 */
export function isWebglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return gl != null;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run tests, expect pass**

Run: `npx vitest run src/test/map/webgl.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit (only if instructed)**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/map/engine/webgl.ts frontend/src/test/map/webgl.test.ts
git commit -m "feat(map): add maplibre-gl + deck.gl deps and a WebGL probe"
```

### Task 2: Basemap registry, style builders, and the no-op guard

**Files:**
- Create: `frontend/src/map/engine/basemaps.ts`
- Test: `frontend/src/test/map/basemaps.test.ts`

- [ ] **Step 1: Write the failing test (pure builders + guard)**

```ts
// frontend/src/test/map/basemaps.test.ts
import { describe, it, expect } from 'vitest';
import {
  rasterStyle, basemapSig, resolveBasemapKind, switchStrategy,
  BASEMAPS, getBasemap, type BasemapEntry,
} from '../../map/engine/basemaps';

const raster: BasemapEntry = {
  id: 'osm', kind: 'raster', label: 'OSM',
  tiles: ['https://a.tile.example/{z}/{x}/{y}.png'], attribution: 'OSM', maxzoom: 19,
};
const vector: BasemapEntry = {
  id: 'ofm-positron', kind: 'vector', label: 'Positron',
  styleUrl: 'https://tiles.openfreemap.org/styles/positron', attribution: 'OFM',
};
const recolor: BasemapEntry = {
  id: 'nova', kind: 'vector-recolor', label: 'Nova',
  styleUrl: 'https://tiles.openfreemap.org/styles/dark', recolorId: 'nova',
  recolor: (s) => s, attribution: 'OFM',
};

describe('rasterStyle', () => {
  it('builds a v8 raster style with the tiles, size and maxzoom cap', () => {
    const s = rasterStyle(raster);
    expect(s.version).toBe(8);
    expect(s.sources.carto).toMatchObject({ type: 'raster', tiles: raster.tiles, tileSize: 256, maxzoom: 19 });
    expect(s.layers[0]).toMatchObject({ id: 'carto', type: 'raster', source: 'carto' });
  });
});

describe('basemapSig', () => {
  it('signs vector by styleUrl', () => { expect(basemapSig(vector)).toBe(vector.styleUrl); });
  it('signs raster by joined tiles', () => { expect(basemapSig(raster)).toBe(raster.tiles!.join('|')); });
  it('distinguishes a recolour from plain OFM dark via recolorId', () => {
    expect(basemapSig(recolor)).toBe('https://tiles.openfreemap.org/styles/dark#nova');
    expect(basemapSig(recolor)).not.toBe('https://tiles.openfreemap.org/styles/dark');
  });
});

describe('resolveBasemapKind / switchStrategy', () => {
  it('treats vector-recolor as vector', () => { expect(resolveBasemapKind(recolor)).toBe('vector'); });
  it('uses setTiles only raster->raster', () => {
    expect(switchStrategy(true, 'raster')).toBe('setTiles');
    expect(switchStrategy(false, 'raster')).toBe('setStyle');
    expect(switchStrategy(true, 'vector')).toBe('setStyle');
  });
});

describe('registry', () => {
  it('contains Nova and OpenFreeMap positron and keyless raster fallbacks', () => {
    expect(getBasemap('nova')?.kind).toBe('vector-recolor');
    expect(getBasemap('ofm-positron')?.kind).toBe('vector');
    expect(BASEMAPS.some((b) => b.kind === 'raster')).toBe(true);
  });
  it('falls back to a known id for an unknown id', () => {
    expect(getBasemap('does-not-exist')?.id).toBe('nova');
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/basemaps.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the registry and builders**

Port of `EU-Meshcore-Analyzer/web/js/lib/maplibre-basemap.js` (`rasterStyle` :152-166, `basemapSig` :186-191, `resolveBasemapKind` :57-59, `switchStrategy` :65-68) to TS. `recolor` for Nova comes from Task 3; typed here as optional and wired in Task 3.

```ts
// frontend/src/map/engine/basemaps.ts
import type { StyleSpecification } from 'maplibre-gl';

export type BasemapKind = 'vector' | 'vector-recolor' | 'raster';

export interface BasemapEntry {
  id: string;
  kind: BasemapKind;
  /** i18n key OR literal label; MapControls resolves keys via t(). */
  label: string;
  styleUrl?: string;
  tiles?: string[];
  maxzoom?: number;
  attribution: string;
  recolorId?: string;
  recolor?: (style: StyleSpecification) => StyleSpecification;
  /** dark|light hint used to pick a default per theme (not auto-applied). */
  tone?: 'dark' | 'light';
}

export const OFM_ATTRIBUTION =
  '© <a href="https://openfreemap.org">OpenFreeMap</a> ' +
  '© <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function rasterStyle(entry: BasemapEntry): StyleSpecification {
  const carto: Record<string, unknown> = {
    type: 'raster', tiles: entry.tiles, tileSize: 256, attribution: entry.attribution,
  };
  if (entry.maxzoom) carto.maxzoom = entry.maxzoom;
  return {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: { carto } as StyleSpecification['sources'],
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
  } as StyleSpecification;
}

export function basemapSig(entry: BasemapEntry): string {
  if (entry.kind === 'vector-recolor') return entry.styleUrl + '#' + (entry.recolorId || 'recolor');
  return entry.kind === 'vector'
    ? String(entry.styleUrl)
    : (Array.isArray(entry.tiles) ? entry.tiles.join('|') : '');
}

export function resolveBasemapKind(entry: BasemapEntry): 'vector' | 'raster' {
  return entry.kind === 'vector' || entry.kind === 'vector-recolor' ? 'vector' : 'raster';
}

export function switchStrategy(currentIsRaster: boolean, targetKind: 'vector' | 'raster'): 'setTiles' | 'setStyle' {
  if (targetKind === 'vector') return 'setStyle';
  return currentIsRaster ? 'setTiles' : 'setStyle';
}

// Keyless raster fallbacks: mirror the ids/urls/maxZoom currently in
// frontend/src/utils/mapTiles.ts so the saved `remoteterm-map-layer` value keeps
// resolving. Fill tiles/attribution/maxzoom by copying that file's presets.
const RASTER_FALLBACKS: BasemapEntry[] = [
  // e.g. { id: 'light', kind: 'raster', label: 'map_layer_light', tiles: [...], attribution: '...', maxzoom: 19, tone: 'light' },
  // Port every entry from mapTiles.ts TILE_LAYERS here (Task 6 wires labels).
];

export const BASEMAPS: BasemapEntry[] = [
  { id: 'nova', kind: 'vector-recolor', label: 'map_layer_nova',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark', recolorId: 'nova',
    attribution: OFM_ATTRIBUTION, tone: 'dark' }, // .recolor injected in Task 3
  { id: 'ofm-positron', kind: 'vector', label: 'map_layer_ofm_positron',
    styleUrl: 'https://tiles.openfreemap.org/styles/positron', attribution: OFM_ATTRIBUTION, tone: 'light' },
  { id: 'ofm-liberty', kind: 'vector', label: 'map_layer_ofm_liberty',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty', attribution: OFM_ATTRIBUTION, tone: 'light' },
  { id: 'ofm-dark', kind: 'vector', label: 'map_layer_ofm_dark',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark', attribution: OFM_ATTRIBUTION, tone: 'dark' },
  { id: 'ofm-fiord', kind: 'vector', label: 'map_layer_ofm_fiord',
    styleUrl: 'https://tiles.openfreemap.org/styles/fiord', attribution: OFM_ATTRIBUTION, tone: 'dark' },
  ...RASTER_FALLBACKS,
];

export const DEFAULT_BASEMAP_ID = 'nova';
export const BASEMAP_STORAGE_KEY = 'remoteterm-map-layer';

export function getBasemap(id: string | null | undefined): BasemapEntry {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS.find((b) => b.id === DEFAULT_BASEMAP_ID)!;
}

export function getSavedBasemapId(): string {
  try {
    const stored = localStorage.getItem(BASEMAP_STORAGE_KEY);
    if (stored === 'dark') return 'darkgray'; // preserve the existing legacy migration
    if (stored && BASEMAPS.some((b) => b.id === stored)) return stored;
  } catch { /* ignore */ }
  return DEFAULT_BASEMAP_ID;
}

export function saveBasemapId(id: string): void {
  try { localStorage.setItem(BASEMAP_STORAGE_KEY, id); } catch { /* ignore */ }
}
```

Note for the implementer: open `frontend/src/utils/mapTiles.ts` and copy each `TILE_LAYERS` preset (id, url template as a one-element `tiles` array, attribution, maxZoom) into `RASTER_FALLBACKS`, preserving ids so saved selections resolve. Keep the existing `darkgray` id.

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/map/basemaps.test.ts`
Expected: PASS. Then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit (only if instructed)**

```bash
git add frontend/src/map/engine/basemaps.ts frontend/src/test/map/basemaps.test.ts
git commit -m "feat(map): basemap registry, raster style builder, switch guard"
```

---

## Slice 2: Nova recolour + `applyBasemap`

### Task 3: Nova recolour (pure) and inject it into the registry

**Files:**
- Create: `frontend/src/map/engine/novaRecolor.ts`
- Modify: `frontend/src/map/engine/basemaps.ts` (inject `recolor`)
- Test: `frontend/src/test/map/novaRecolor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/test/map/novaRecolor.test.ts
import { describe, it, expect } from 'vitest';
import { recolorNovaDark, NOVA_PALETTE } from '../../map/engine/novaRecolor';

const style = {
  version: 8, sources: {}, layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
    { id: 'water', type: 'fill', 'source-layer': 'water', paint: { 'fill-color': '#00f' } },
    { id: 'road_motorway', type: 'line', 'source-layer': 'transportation', paint: {} },
    { id: 'mystery', type: 'line', 'source-layer': 'unknownlayer', paint: { 'line-color': '#123' } },
  ],
} as any;

describe('recolorNovaDark', () => {
  it('recolours background, water and roads to the Nova palette', () => {
    const out = recolorNovaDark(style);
    const by = (id: string) => out.layers.find((l: any) => l.id === id);
    expect(by('background').paint['background-color']).toBe(NOVA_PALETTE.land);
    expect(by('water').paint['fill-color']).toBe(NOVA_PALETTE.water);
    expect(by('road_motorway').paint['line-color']).toBe(NOVA_PALETTE.road_bright);
  });
  it('passes unknown layers through unchanged and does not mutate input', () => {
    const out = recolorNovaDark(style);
    expect(out.layers.find((l: any) => l.id === 'mystery').paint['line-color']).toBe('#123');
    expect(style.layers[0].paint['background-color']).toBe('#fff'); // input untouched
    expect(out).not.toBe(style);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/novaRecolor.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the recolour**

Direct port of `Dutch-MeshCore/DutchMeshCore-Observers/web/js/lib/dmcbasemap.js` (:15-84).

```ts
// frontend/src/map/engine/novaRecolor.ts
import type { StyleSpecification } from 'maplibre-gl';

export const NOVA_PALETTE = {
  land: '#080f1e', water: '#0c1d33', waterway: '#13385a', building: '#111d33',
  landuse: '#0b1526', park: '#0c1a26', boundary: '#284a76',
  road_bright: '#79b8ff', road_mid: '#3f66a9', road_dim: '#2b4a70',
  rail: '#33405c', pier: '#16233b', label: '#c4dbff', halo: '#050a15',
} as const;

type AnyLayer = Record<string, any>;

function recolorLayer(layer: AnyLayer, P: typeof NOVA_PALETTE): AnyLayer {
  const paint: AnyLayer = { ...(layer.paint || {}) };
  const id: string = layer.id;
  const sl: string | undefined = layer['source-layer'];
  const line = (color: string, blur?: number) => {
    paint['line-color'] = color;
    if (blur != null) paint['line-blur'] = blur;
  };
  if (layer.type === 'background') paint['background-color'] = P.land;
  else if (sl === 'water') paint['fill-color'] = P.water;
  else if (sl === 'waterway') paint['line-color'] = P.waterway;
  else if (sl === 'building') { paint['fill-color'] = P.building; paint['fill-outline-color'] = P.land; }
  else if (sl === 'landcover' || sl === 'landuse') { paint['fill-color'] = id.includes('park') ? P.park : P.landuse; delete paint['fill-pattern']; }
  else if (sl === 'boundary') paint['line-color'] = P.boundary;
  else if (sl === 'transportation') {
    if (layer.type === 'fill') paint['fill-color'] = P.pier;
    else if (/casing/.test(id)) paint['line-color'] = P.land;
    else if (/motorway_inner|major_inner/.test(id)) line(P.road_bright, 1.4);
    else if (/motorway_subtle|major_subtle/.test(id)) line(P.road_bright, 1.1);
    else if (/motorway|major/.test(id)) line(P.road_bright, 1.0);
    else if (/minor/.test(id)) line(P.road_mid, 0.4);
    else if (/path/.test(id)) paint['line-color'] = P.road_dim;
    else if (/railway/.test(id)) paint['line-color'] = P.rail;
    else if (/pier/.test(id)) paint['line-color'] = P.pier;
  } else if (layer.type === 'symbol') {
    if ('text-color' in paint) paint['text-color'] = P.label;
    if ('text-halo-color' in paint) paint['text-halo-color'] = P.halo;
  }
  return { ...layer, paint };
}

export function recolorNovaDark(style: StyleSpecification): StyleSpecification {
  const P = NOVA_PALETTE;
  const layers = ((style.layers as AnyLayer[]) || []).map((l) => recolorLayer(l, P));
  return { ...style, layers } as StyleSpecification;
}
```

- [ ] **Step 4: Inject the recolour into the Nova registry entry**

In `frontend/src/map/engine/basemaps.ts`, import and attach:
```ts
import { recolorNovaDark } from './novaRecolor';
// ...in the BASEMAPS 'nova' entry, add:
//   recolor: recolorNovaDark,
```
Edit the `nova` object literal to include `recolor: recolorNovaDark,`.

- [ ] **Step 5: Run tests, expect pass**

Run: `npx vitest run src/test/map/novaRecolor.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit (only if instructed)**

```bash
git add frontend/src/map/engine/novaRecolor.ts frontend/src/map/engine/basemaps.ts frontend/src/test/map/novaRecolor.test.ts
git commit -m "feat(map): Nova dark vector recolour and register it"
```

### Task 4: `applyBasemap` with the WeakMap no-op guard and overlay re-apply

**Files:**
- Modify: `frontend/src/map/engine/basemaps.ts`
- Test: `frontend/src/test/map/applyBasemap.test.ts`

- [ ] **Step 1: Write the failing test with a stub map**

```ts
// frontend/src/test/map/applyBasemap.test.ts
import { describe, it, expect, vi } from 'vitest';
import { applyBasemap, markBasemapApplied, getBasemap } from '../../map/engine/basemaps';

function stubMap() {
  const handlers: Record<string, (() => void)[]> = {};
  return {
    _sources: new Set<string>(['carto']), // starts on a raster style
    setStyle: vi.fn(),
    getSource(id: string) { return this._sources.has(id) ? { setTiles: vi.fn() } : undefined; },
    once(ev: string, cb: () => void) { (handlers[ev] ||= []).push(cb); },
    fire(ev: string) { (handlers[ev] || []).forEach((cb) => cb()); },
  };
}

describe('applyBasemap', () => {
  it('is a no-op when the same basemap signature is applied twice', () => {
    const map = stubMap();
    const ofm = getBasemap('ofm-positron');
    applyBasemap(map as any, ofm, {});
    applyBasemap(map as any, ofm, {});
    expect(map.setStyle).toHaveBeenCalledTimes(1);
  });

  it('calls reapplyOverlays after styledata on a vector switch', () => {
    const map = stubMap();
    const reapplyOverlays = vi.fn();
    applyBasemap(map as any, getBasemap('ofm-positron'), { reapplyOverlays });
    map.fire('styledata');
    expect(reapplyOverlays).toHaveBeenCalledTimes(1);
  });

  it('markBasemapApplied seeds the guard so the first apply is skipped', () => {
    const map = stubMap();
    const ofm = getBasemap('ofm-positron');
    markBasemapApplied(map as any, ofm);
    applyBasemap(map as any, ofm, {});
    expect(map.setStyle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/applyBasemap.test.ts`
Expected: FAIL (`applyBasemap`/`markBasemapApplied` not exported).

- [ ] **Step 3: Implement `applyBasemap` + helpers**

Port of `maplibre-basemap.js` :173-257 (WeakMap guard, `recoloredStyle` cache, vector-recolor branch, `setTiles` vs `setStyle`). Append to `basemaps.ts`.

```ts
// --- appended to frontend/src/map/engine/basemaps.ts ---
import type { Map as MlMap } from 'maplibre-gl';

export interface ApplyBasemapCtx {
  reapplyOverlays?: () => void;
  buildingsOn?: boolean;
  theme?: 'light' | 'dark';
  onBuildings?: (map: MlMap, on: boolean, theme: 'light' | 'dark') => void;
}

const _activeBasemap = new WeakMap<object, string>();
const _recolorCache = new Map<string, Promise<StyleSpecification>>();

function recoloredStyle(entry: BasemapEntry): Promise<StyleSpecification> {
  const key = entry.styleUrl + '#' + (entry.recolorId || 'recolor');
  let p = _recolorCache.get(key);
  if (p) return p;
  p = fetch(String(entry.styleUrl))
    .then((r) => { if (!r.ok) throw new Error('style ' + r.status); return r.json(); })
    .then((s) => entry.recolor!(s as StyleSpecification));
  _recolorCache.set(key, p);
  p.catch(() => _recolorCache.delete(key));
  return p;
}

export function markBasemapApplied(map: MlMap, entry: BasemapEntry): void {
  if (entry) _activeBasemap.set(map, basemapSig(entry));
}

export function applyBasemap(map: MlMap, entry: BasemapEntry, ctx: ApplyBasemapCtx = {}): void {
  if (!entry) return;
  const sig = basemapSig(entry);
  if (_activeBasemap.get(map) === sig) return;
  _activeBasemap.set(map, sig);

  const afterStyle = () => map.once('styledata', () => {
    ctx.reapplyOverlays?.();
    if (ctx.buildingsOn && ctx.onBuildings) ctx.onBuildings(map, true, ctx.theme ?? 'dark');
  });

  const currentIsRaster = !!map.getSource('carto');
  const targetKind = resolveBasemapKind(entry);
  const strategy = switchStrategy(currentIsRaster, targetKind);

  if (strategy === 'setTiles') {
    const src = map.getSource('carto') as { setTiles?: (t: string[]) => void } | undefined;
    if (src?.setTiles && entry.tiles) src.setTiles(entry.tiles);
    return;
  }
  if (entry.kind === 'vector-recolor') {
    recoloredStyle(entry)
      .then((style) => { map.setStyle(style); afterStyle(); })
      .catch(() => { _activeBasemap.delete(map); applyBasemap(map, getBasemap('ofm-dark'), ctx); });
    return;
  }
  const nextStyle = targetKind === 'vector' ? String(entry.styleUrl) : rasterStyle(entry);
  map.setStyle(nextStyle as string | StyleSpecification);
  afterStyle();
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/map/applyBasemap.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit (only if instructed)**

```bash
git add frontend/src/map/engine/basemaps.ts frontend/src/test/map/applyBasemap.test.ts
git commit -m "feat(map): applyBasemap with no-op guard and overlay re-apply"
```

---

## Slice 3: camera lock + 3D buildings

### Task 5: `setMapLock2D`

**Files:**
- Create: `frontend/src/map/engine/mapLock2D.ts`
- Test: `frontend/src/test/map/mapLock2D.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/test/map/mapLock2D.test.ts
import { describe, it, expect, vi } from 'vitest';
import { setMapLock2D } from '../../map/engine/mapLock2D';

function stubMap() {
  return {
    dragRotate: { disable: vi.fn(), enable: vi.fn() },
    touchZoomRotate: { disableRotation: vi.fn(), enableRotation: vi.fn() },
    touchPitch: { disable: vi.fn(), enable: vi.fn() },
    keyboard: { disableRotation: vi.fn(), enableRotation: vi.fn() },
    setMaxPitch: vi.fn(),
    easeTo: vi.fn(),
  };
}

describe('setMapLock2D', () => {
  it('does not throw on a null map', () => { expect(() => setMapLock2D(null as any, true)).not.toThrow(); });
  it('locks: disables rotation, clamps pitch to 0, flattens camera', () => {
    const m = stubMap();
    setMapLock2D(m as any, true);
    expect(m.dragRotate.disable).toHaveBeenCalled();
    expect(m.touchZoomRotate.disableRotation).toHaveBeenCalled();
    expect(m.setMaxPitch).toHaveBeenCalledWith(0);
    expect(m.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 0, bearing: 0 }));
  });
  it('unlocks: re-enables rotation and restores maxPitch (default 60)', () => {
    const m = stubMap();
    setMapLock2D(m as any, false);
    expect(m.dragRotate.enable).toHaveBeenCalled();
    expect(m.setMaxPitch).toHaveBeenCalledWith(60);
  });
  it('unlocks with a custom maxPitch', () => {
    const m = stubMap();
    setMapLock2D(m as any, false, { maxPitch: 85 });
    expect(m.setMaxPitch).toHaveBeenCalledWith(85);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/mapLock2D.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement (port of `map-2d-lock.js` :15-37)**

```ts
// frontend/src/map/engine/mapLock2D.ts
import type { Map as MlMap } from 'maplibre-gl';

export function setMapLock2D(map: MlMap | null | undefined, on: boolean, opts?: { maxPitch?: number }): void {
  if (!map) return;
  const call = (obj: any, method: string) => {
    try { if (obj && typeof obj[method] === 'function') obj[method](); } catch { /* non-fatal */ }
  };
  const m = map as any;
  if (on) {
    call(m.dragRotate, 'disable');
    call(m.touchZoomRotate, 'disableRotation');
    call(m.touchPitch, 'disable');
    call(m.keyboard, 'disableRotation');
    try { if (typeof m.setMaxPitch === 'function') m.setMaxPitch(0); } catch { /* ignore */ }
    try { m.easeTo({ pitch: 0, bearing: 0, duration: 300 }); } catch { /* ignore */ }
  } else {
    call(m.dragRotate, 'enable');
    call(m.touchZoomRotate, 'enableRotation');
    call(m.touchPitch, 'enable');
    call(m.keyboard, 'enableRotation');
    const maxPitch = typeof opts?.maxPitch === 'number' ? opts.maxPitch : 60;
    try { if (typeof m.setMaxPitch === 'function') m.setMaxPitch(maxPitch); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/map/mapLock2D.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit (only if instructed)**

```bash
git add frontend/src/map/engine/mapLock2D.ts frontend/src/test/map/mapLock2D.test.ts
git commit -m "feat(map): 2D/3D camera lock helper"
```

### Task 6: 3D buildings spec builders + `setBuildings3D`

**Files:**
- Create: `frontend/src/map/engine/buildings3D.ts`
- Test: `frontend/src/test/map/buildings3D.test.ts`

- [ ] **Step 1: Write the failing test (pure builders)**

```ts
// frontend/src/test/map/buildings3D.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildingsPaint, buildingsLayerSpec, setBuildings3D } from '../../map/engine/buildings3D';

describe('buildingsPaint', () => {
  it('uses light vs dark extrusion colour and coalesced height/base', () => {
    expect(buildingsPaint('light')['fill-extrusion-color']).toBe('#c9ccd1');
    expect(buildingsPaint('dark')['fill-extrusion-color']).toBe('#3a3f4a');
    expect(buildingsPaint('dark')['fill-extrusion-height']).toEqual(['coalesce', ['get', 'render_height'], 0]);
    expect(buildingsPaint('dark')['fill-extrusion-opacity']).toBe(0.85);
  });
});

describe('buildingsLayerSpec', () => {
  it('is a fill-extrusion on the building source-layer at minzoom 12', () => {
    const s = buildingsLayerSpec('openmaptiles', 'dark');
    expect(s).toMatchObject({ id: 'buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 12 });
  });
});

describe('setBuildings3D', () => {
  it('removes the layer when turned off', async () => {
    const map = { getLayer: vi.fn(() => ({})), removeLayer: vi.fn() } as any;
    await setBuildings3D(map, false, 'dark');
    expect(map.removeLayer).toHaveBeenCalledWith('buildings-3d');
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/buildings3D.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement (port of `maplibre-basemap.js` :72-147)**

```ts
// frontend/src/map/engine/buildings3D.ts
import type { Map as MlMap } from 'maplibre-gl';

export function buildingsPaint(theme: 'light' | 'dark'): Record<string, unknown> {
  return {
    'fill-extrusion-color': theme === 'light' ? '#c9ccd1' : '#3a3f4a',
    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
    'fill-extrusion-opacity': 0.85,
  };
}

export function buildingsLayerSpec(sourceId: string, theme: 'light' | 'dark') {
  return {
    id: 'buildings-3d', type: 'fill-extrusion' as const, source: sourceId,
    'source-layer': 'building', minzoom: 12, paint: buildingsPaint(theme),
  };
}

let _vectorSourceDef: Promise<unknown> | null = null;
async function vectorSourceDef(): Promise<unknown> {
  if (_vectorSourceDef) return _vectorSourceDef;
  const p = (async () => {
    const res = await fetch('https://tiles.openfreemap.org/styles/positron');
    if (!res.ok) throw new Error('OpenFreeMap style ' + res.status);
    const style = await res.json();
    const entry = Object.values(style.sources || {}).find((s: any) => s.type === 'vector');
    if (!entry) throw new Error('no vector source in OpenFreeMap style');
    return entry;
  })();
  _vectorSourceDef = p;
  p.catch(() => { _vectorSourceDef = null; });
  return p;
}

export async function ensureBuildingsSource(map: MlMap): Promise<string> {
  const m = map as any;
  if (m.getSource('openmaptiles')) return 'openmaptiles';
  if (m.getSource('ofm-buildings')) return 'ofm-buildings';
  const def = await vectorSourceDef();
  if (m.getSource('ofm-buildings')) return 'ofm-buildings';
  m.addSource('ofm-buildings', def);
  return 'ofm-buildings';
}

export async function setBuildings3D(map: MlMap, on: boolean, theme: 'light' | 'dark'): Promise<void> {
  const m = map as any;
  try {
    if (!on) {
      if (m.getLayer('buildings-3d')) m.removeLayer('buildings-3d');
      return;
    }
    const src = await ensureBuildingsSource(map);
    if (!m.getLayer('buildings-3d')) {
      m.addLayer(buildingsLayerSpec(src, theme));
    } else {
      const paint = buildingsPaint(theme);
      for (const [prop, val] of Object.entries(paint)) m.setPaintProperty('buildings-3d', prop, val);
    }
    if (m.getPitch() < 30) m.easeTo({ pitch: 45, duration: 500 });
  } catch (e) {
    // non-fatal: buildings just do not appear
    console.error('setBuildings3D failed:', e);
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/map/buildings3D.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit (only if instructed)**

```bash
git add frontend/src/map/engine/buildings3D.ts frontend/src/test/map/buildings3D.test.ts
git commit -m "feat(map): 3D buildings fill-extrusion spec and toggle"
```

---

## Slice 4: node layer expressions + contact-type constants

### Task 7: Contact-type constants

**Files:**
- Modify: `frontend/src/types.ts:512-514`
- Test: `frontend/src/test/map/contactTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/test/map/contactTypes.test.ts
import { describe, it, expect } from 'vitest';
import { CONTACT_TYPE_CLIENT, CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM, CONTACT_TYPE_SENSOR } from '../../types';

describe('contact type constants', () => {
  it('match the canonical AGENTS.md table', () => {
    expect(CONTACT_TYPE_CLIENT).toBe(1);
    expect(CONTACT_TYPE_REPEATER).toBe(2);
    expect(CONTACT_TYPE_ROOM).toBe(3);
    expect(CONTACT_TYPE_SENSOR).toBe(4);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/contactTypes.test.ts`
Expected: FAIL (`CONTACT_TYPE_CLIENT`/`CONTACT_TYPE_SENSOR` not exported).

- [ ] **Step 3: Add the constants**

In `frontend/src/types.ts`, next to the existing constants (currently lines 512-514):
```ts
export const CONTACT_TYPE_CLIENT = 1;
export const CONTACT_TYPE_REPEATER = 2;
export const CONTACT_TYPE_ROOM = 3;
export const CONTACT_TYPE_SENSOR = 4;
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/map/contactTypes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (only if instructed)**

```bash
git add frontend/src/types.ts frontend/src/test/map/contactTypes.test.ts
git commit -m "feat(types): add CONTACT_TYPE_CLIENT and CONTACT_TYPE_SENSOR"
```

### Task 8: Node layer expressions and geojson builder

**Design decision (flag for override at plan review):** keep today's encoding to avoid regressing UX. Fill colour = recency bucket (as today, `MAP_RECENCY_COLORS`); node TYPE = `circle-stroke-color` mapped to type; repeaters render larger. This keeps two non-colliding encodings on one circle layer. The alternative EU model (colour by role, opacity by recency) is possible but changes current behaviour.

**Files:**
- Create: `frontend/src/map/layers/nodesLayer.ts`
- Test: `frontend/src/test/map/nodesLayer.test.ts`

- [ ] **Step 1: Write the failing test (pure expressions + features)**

```ts
// frontend/src/test/map/nodesLayer.test.ts
import { describe, it, expect } from 'vitest';
import { buildNodeFeatures, circleRadiusExpr, recencyTier } from '../../map/layers/nodesLayer';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_CLIENT, type Contact } from '../../types';

const now = 1_000_000; // seconds
const contact = (over: Partial<Contact>): Contact => ({
  public_key: 'aa', name: 'n', type: CONTACT_TYPE_CLIENT, lat: 52, lon: 5, last_seen: now, on_radio: true,
  favorite: false, first_seen: null, last_advert: null,
  // fill any other required Contact fields with nulls/defaults as the type demands
} as Contact);

describe('recencyTier', () => {
  it('buckets by age', () => {
    expect(recencyTier(now, now)).toBe('recent');
    expect(recencyTier(now - 2 * 3600, now)).toBe('today');
    expect(recencyTier(now - 2 * 86400, now)).toBe('stale');
    expect(recencyTier(now - 10 * 86400, now)).toBe('old');
    expect(recencyTier(null, now)).toBe('old');
  });
});

describe('circleRadiusExpr', () => {
  it('makes repeaters larger via a case on the repeater property', () => {
    expect(circleRadiusExpr(7, 10)).toEqual(['case', ['get', 'repeater'], 10, 7]);
  });
});

describe('buildNodeFeatures', () => {
  it('emits one feature per mappable contact with type/repeater/tier props', () => {
    const fc = buildNodeFeatures(
      [contact({ public_key: 'a', type: CONTACT_TYPE_REPEATER }), contact({ public_key: 'b', lat: null })],
      now,
    );
    expect(fc.features).toHaveLength(1); // 'b' has no lat, dropped
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [5, 52] });
    expect(fc.features[0].properties).toMatchObject({ id: 'a', type: CONTACT_TYPE_REPEATER, repeater: true, tier: 'recent' });
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/nodesLayer.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement expressions, features and the layer controller**

Port the controller shape from `livemap-nodes-gl.js` (source/layer at :102-116, `setNodeScale` :121-126, reattach :185-189, listeners bound once :131-140), but colour/tier logic from RTFM's own recency buckets.

```ts
// frontend/src/map/layers/nodesLayer.ts
import type { Map as MlMap, ExpressionSpecification } from 'maplibre-gl';
import { CONTACT_TYPE_CLIENT, CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM, CONTACT_TYPE_SENSOR, type Contact } from '../../types';

export type RecencyTier = 'recent' | 'today' | 'stale' | 'old';

export const NODE_RECENCY_COLORS: Record<RecencyTier, string> = {
  recent: '#06b6d4', today: '#2563eb', stale: '#f59e0b', old: '#64748b',
};
// Type -> stroke colour (the second, non-colliding encoding).
export const NODE_TYPE_STROKE: Record<number, string> = {
  [CONTACT_TYPE_CLIENT]: '#94a3b8',
  [CONTACT_TYPE_REPEATER]: '#f8fafc',
  [CONTACT_TYPE_ROOM]: '#a855f7',
  [CONTACT_TYPE_SENSOR]: '#22c55e',
};

export function recencyTier(lastSeenSec: number | null | undefined, nowSec: number): RecencyTier {
  if (lastSeenSec == null) return 'old';
  const age = nowSec - lastSeenSec;
  if (age < 3600) return 'recent';
  if (age < 86400) return 'today';
  if (age < 3 * 86400) return 'stale';
  return 'old';
}

export function circleColorExpr(): ExpressionSpecification {
  const out: unknown[] = ['match', ['get', 'tier']];
  (Object.keys(NODE_RECENCY_COLORS) as RecencyTier[]).forEach((k) => out.push(k, NODE_RECENCY_COLORS[k]));
  out.push(NODE_RECENCY_COLORS.old);
  return out as ExpressionSpecification;
}

export function strokeColorExpr(): ExpressionSpecification {
  const out: unknown[] = ['match', ['get', 'type']];
  Object.entries(NODE_TYPE_STROKE).forEach(([type, color]) => out.push(Number(type), color));
  out.push('#0f172a');
  return out as ExpressionSpecification;
}

export function circleRadiusExpr(baseR: number, repeaterR: number): ExpressionSpecification {
  return ['case', ['get', 'repeater'], repeaterR, baseR] as ExpressionSpecification;
}

export function buildNodeFeatures(contacts: Contact[], nowSec: number) {
  const features = contacts
    .filter((c) => c.lat != null && c.lon != null)
    .map((c) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [c.lon as number, c.lat as number] },
      properties: {
        id: c.public_key,
        name: c.name ?? c.public_key.slice(0, 12),
        type: c.type,
        repeater: c.type === CONTACT_TYPE_REPEATER,
        tier: recencyTier(c.last_seen, nowSec),
      },
    }));
  return { type: 'FeatureCollection' as const, features };
}

export interface NodesLayerOptions {
  baseR?: number;
  repeaterR?: number;
  onClick?: (id: string) => void;
}

export function createNodesLayer(map: MlMap, opts: NodesLayerOptions = {}) {
  const baseR = opts.baseR ?? 7;
  const repeaterR = opts.repeaterR ?? 10;
  let nodeScale = 1;
  let listenersBound = false;
  const m = map as any;

  function addSourceAndLayer() {
    if (m.getSource('rt-nodes')) return;
    m.addSource('rt-nodes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({
      id: 'rt-nodes', type: 'circle', source: 'rt-nodes',
      paint: {
        'circle-color': circleColorExpr(),
        'circle-radius': circleRadiusExpr(baseR * nodeScale, repeaterR * nodeScale),
        'circle-opacity': 0.9,
        'circle-stroke-color': strokeColorExpr(),
        'circle-stroke-width': ['case', ['get', 'repeater'], 3, 2],
      },
    });
  }
  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    m.on('click', 'rt-nodes', (e: any) => {
      const id = e.features?.[0]?.properties?.id;
      if (id && opts.onClick) opts.onClick(id);
    });
    m.on('mouseenter', 'rt-nodes', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'rt-nodes', () => { m.getCanvas().style.cursor = ''; });
  }
  function setData(contacts: Contact[], nowSec: number) {
    const src = m.getSource('rt-nodes');
    if (src) src.setData(buildNodeFeatures(contacts, nowSec));
  }
  function setNodeScale(factor: number) {
    nodeScale = factor;
    if (m.getLayer('rt-nodes')) {
      m.setPaintProperty('rt-nodes', 'circle-radius', circleRadiusExpr(baseR * nodeScale, repeaterR * nodeScale));
    }
  }
  function ensure() { addSourceAndLayer(); bindListeners(); }
  function reattach() { addSourceAndLayer(); }

  return { ensure, reattach, setData, setNodeScale };
}
```

Note: fill in every required `Contact` field in the test factory to satisfy the real type; read `types.ts:185-210` for the full shape.

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/map/nodesLayer.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit (only if instructed)**

```bash
git add frontend/src/map/layers/nodesLayer.ts frontend/src/test/map/nodesLayer.test.ts
git commit -m "feat(map): GL node layer expressions, features and controller"
```

---

## Slice 5: shared MapSurface + MapControls (FABs on every map)

### Task 9: Test-environment MapLibre mock

**Files:**
- Modify: `frontend/src/test/setup.ts`
- Create: `frontend/src/test/mocks/maplibre.ts`

- [ ] **Step 1: Add a reusable maplibre-gl mock**

jsdom has no WebGL, so component tests mock `maplibre-gl`. Create a factory a test can `vi.mock('maplibre-gl', ...)` with.

```ts
// frontend/src/test/mocks/maplibre.ts
import { vi } from 'vitest';

export function makeMapStub() {
  const handlers: Record<string, ((e?: unknown) => void)[]> = {};
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn>; setTiles: ReturnType<typeof vi.fn> }>();
  return {
    on: vi.fn((ev: string, ...rest: any[]) => { const cb = rest[rest.length - 1]; (handlers[ev] ||= []).push(cb); }),
    once: vi.fn((ev: string, cb: () => void) => { (handlers[ev] ||= []).push(cb); }),
    off: vi.fn(),
    fire: (ev: string, e?: unknown) => (handlers[ev] || []).forEach((cb) => cb(e)),
    addControl: vi.fn(), removeControl: vi.fn(),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn(), setTiles: vi.fn() })),
    getSource: vi.fn((id: string) => sources.get(id)),
    addLayer: vi.fn(), removeLayer: vi.fn(), getLayer: vi.fn(() => undefined),
    setPaintProperty: vi.fn(), setLayoutProperty: vi.fn(),
    setStyle: vi.fn(), getStyle: vi.fn(() => ({ layers: [] })),
    setMaxPitch: vi.fn(), getPitch: vi.fn(() => 0), easeTo: vi.fn(), flyTo: vi.fn(),
    fitBounds: vi.fn(), setCenter: vi.fn(), setZoom: vi.fn(), getZoom: vi.fn(() => 8),
    getContainer: vi.fn(() => document.createElement('div')),
    getCanvas: vi.fn(() => document.createElement('canvas')),
    project: vi.fn(() => ({ x: 0, y: 0 })), resize: vi.fn(), remove: vi.fn(),
    dragRotate: { disable: vi.fn(), enable: vi.fn() },
    touchZoomRotate: { disableRotation: vi.fn(), enableRotation: vi.fn() },
    touchPitch: { disable: vi.fn(), enable: vi.fn() },
    keyboard: { disableRotation: vi.fn(), enableRotation: vi.fn() },
  };
}

export function mockMaplibreModule() {
  const stub = makeMapStub();
  return {
    default: { Map: vi.fn(() => stub), Popup: vi.fn(() => ({ setLngLat: vi.fn().mockReturnThis(), setDOMContent: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() })), NavigationControl: vi.fn() },
    Map: vi.fn(() => stub), Popup: vi.fn(), NavigationControl: vi.fn(),
    __stub: stub,
  };
}
```

Leave `setup.ts` importing jest-dom + ResizeObserver + matchMedia as-is; the maplibre mock is opt-in per test file.

- [ ] **Step 2: Commit (only if instructed)**

```bash
git add frontend/src/test/mocks/maplibre.ts
git commit -m "test(map): reusable maplibre-gl stub for component tests"
```

### Task 10: `breakpoints.ts` + `useIsCompactMap`

**Files:**
- Create: `frontend/src/map/controls/breakpoints.ts`
- Test: `frontend/src/test/map/breakpoints.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/test/map/breakpoints.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MOBILE_QUERY, COMPACT_MAP_QUERY, useIsCompactMap } from '../../map/controls/breakpoints';

describe('breakpoint constants', () => {
  it('match the EU analyzer vocabulary', () => {
    expect(MOBILE_QUERY).toBe('(max-width: 768px)');
    expect(COMPACT_MAP_QUERY).toBe('(max-width: 1024px), (pointer: coarse)');
  });
});

describe('useIsCompactMap', () => {
  it('reads matchMedia for the compact query', () => {
    const mm = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('matchMedia', mm);
    const { result } = renderHook(() => useIsCompactMap());
    expect(mm).toHaveBeenCalledWith(COMPACT_MAP_QUERY);
    expect(result.current).toBe(true);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/breakpoints.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement (port of `mobile.js` :27-93)**

```ts
// frontend/src/map/controls/breakpoints.ts
import { useEffect, useState } from 'react';

export const MOBILE_QUERY = '(max-width: 768px)';
export const COMPACT_MAP_QUERY = '(max-width: 1024px), (pointer: coarse)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches; }
    catch { return false; }
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    if (mql.addEventListener) { mql.addEventListener('change', handler); return () => mql.removeEventListener('change', handler); }
    // older Safari
    mql.addListener(handler); return () => mql.removeListener(handler);
  }, [query]);
  return matches;
}

export function useIsMobile(): boolean { return useMediaQuery(MOBILE_QUERY); }
export function useIsCompactMap(): boolean { return useMediaQuery(COMPACT_MAP_QUERY); }
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/map/breakpoints.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit (only if instructed)**

```bash
git add frontend/src/map/controls/breakpoints.ts frontend/src/test/map/breakpoints.test.tsx
git commit -m "feat(map): responsive breakpoint constants and hook"
```

### Task 11: i18n keys for map controls

**Files:**
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`
- Test: `frontend/src/test/i18nParity.test.ts` (already exists; must stay green)

- [ ] **Step 1: Add keys to all three locales**

Add (EN values shown; translate for NL/DE). Keep them grouped with the existing `map_*` keys.

```jsonc
// en.json (and matching keys in nl.json, de.json)
"map_layers": "Layers",
"map_basemap_label": "Basemap",
"map_legend": "Legend",
"map_search": "Search",
"map_2d": "2D",
"map_3d": "3D",
"map_tilt_label": "Tilt (3D)",
"map_buildings_label": "3D buildings",
"map_node_size_label": "Node size",
"map_controls_title": "Map controls",
"map_layer_nova": "Nova (dark)",
"map_layer_ofm_positron": "OpenFreeMap Positron",
"map_layer_ofm_liberty": "OpenFreeMap Liberty",
"map_layer_ofm_dark": "OpenFreeMap Dark",
"map_layer_ofm_fiord": "OpenFreeMap Fiord",
"map_links_label": "Links",
"map_type_client": "Client",
"map_type_repeater": "Repeater",
"map_type_room": "Room",
"map_type_sensor": "Sensor"
```
(Also confirm labels already exist for the ported raster fallbacks, e.g. `map_layer_light`; add any missing ones.)

NL suggested values: `Lagen / Basiskaart / Legenda / Zoeken / 2D / 3D / Kanteling (3D) / 3D-gebouwen / Puntgrootte / Kaartbediening / Nova (donker) / ... / Verbindingen / Client / Repeater / Room / Sensor`.
DE suggested values: `Ebenen / Basiskarte / Legende / Suche / 2D / 3D / Neigung (3D) / 3D-Gebaeude / Punktgroesse / Kartensteuerung / Nova (dunkel) / ... / Verbindungen / Client / Repeater / Raum / Sensor`.

- [ ] **Step 2: Run the parity + core i18n tests**

Run: `npx vitest run src/test/i18nParity.test.ts src/test/i18nCore.test.ts`
Expected: PASS (key sets identical across en/nl/de).

- [ ] **Step 3: Commit (only if instructed)**

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "i18n(map): add control/legend/basemap keys (en/nl/de)"
```

### Task 12: `MapControls` FAB stack (configurable, popover/sheet)

**Files:**
- Create: `frontend/src/map/controls/MapControls.tsx`
- Create: `frontend/src/map/controls/legend/MapLegend.tsx`
- Test: `frontend/src/test/map/mapControls.test.tsx`

- [ ] **Step 1: Write the failing test (DOM behaviour, no WebGL)**

```tsx
// frontend/src/test/map/mapControls.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { MapControls } from '../../map/controls/MapControls';

const renderControls = (props = {}) => render(
  <I18nProvider>
    <MapControls
      fabs={{ layers: true, legend: true }}
      basemaps={[{ id: 'nova', label: 'map_layer_nova' }, { id: 'ofm-positron', label: 'map_layer_ofm_positron' }]}
      selectedBasemapId="nova"
      onSelectBasemap={vi.fn()}
      {...props}
    />
  </I18nProvider>,
);

describe('MapControls', () => {
  it('renders only the enabled FABs', () => {
    renderControls({ fabs: { layers: true } });
    expect(screen.getByRole('button', { name: /layers/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /legend/i })).not.toBeInTheDocument();
  });
  it('opens the basemap picker and reports a selection', () => {
    const onSelectBasemap = vi.fn();
    renderControls({ onSelectBasemap });
    fireEvent.click(screen.getByRole('button', { name: /layers/i }));
    fireEvent.click(screen.getByText('OpenFreeMap Positron'));
    expect(onSelectBasemap).toHaveBeenCalledWith('ofm-positron');
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/mapControls.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `MapControls` + `MapLegend`**

Requirements the code must meet (write the full component to satisfy them):
- Props: `fabs: { layers?, legend?, search?, tilt?, buildings?, nodeSize? }`; `basemaps: {id,label}[]`; `selectedBasemapId`; `onSelectBasemap(id)`; optional `tilt3D`, `onToggleTilt`, `buildings`, `onToggleBuildings`, `nodeScale`, `onNodeScale`, `onSearch(query)`, `legendContent?: ReactNode`.
- Render an absolutely-positioned vertical stack of circular buttons styled from `.map-fab` (44px, `bg-[hsl(var(--card))]`, `border-[hsl(var(--border))]`, rounded-full, shadow, 20px lucide icon). Use the app's existing icon set (lucide-react) for Layers/Info/Search/Box/Mountain.
- Each FAB opens its panel. On desktop (`!useIsCompactMap()`), render the panel as an anchored popover/`div`. On compact, render it inside a shadcn `Sheet` with `side="bottom"` (mirror `AppShell.tsx` usage: `Sheet`, `SheetContent side="bottom"`, `SheetHeader` with `SheetTitle`/`SheetDescription`). Reuse the same panel body component in both hosts (one vocabulary, two hosts).
- Layers panel: a radio list of `basemaps` (label via `t(label)`), calling `onSelectBasemap`.
- Legend panel: renders `legendContent` or `<MapLegend/>`.
- Tilt FAB: a 2D/3D toggle button, label `t('map_2d')`/`t('map_3d')`.
- Buildings FAB: a toggle, `t('map_buildings_label')`.
- Node-size FAB: a range input `0.5..2.5 step 0.1` bound to `nodeScale`/`onNodeScale`, label `t('map_node_size_label')`.
- Search FAB: a text input calling `onSearch` on submit.
- All strings via `t()`; every control keyboard-focusable with an `aria-label`.

`MapLegend.tsx` renders three `role="group"` sections: node types (client/repeater/room/sensor swatches using `NODE_TYPE_STROKE`), recency (using `NODE_RECENCY_COLORS`), and packet types (reuse existing `PARTICLE_COLOR_MAP` labels), matching the a11y pattern of the current inline legend (`MapView.tsx:945-982`).

(Author the component to pass the Step-1 test; keep the file focused. Add `data-testid` hooks only if the test needs them.)

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/map/mapControls.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, clean (lint includes the i18n hardcoded-string rule).

- [ ] **Step 5: Commit (only if instructed)**

```bash
git add frontend/src/map/controls/MapControls.tsx frontend/src/map/controls/legend/MapLegend.tsx frontend/src/test/map/mapControls.test.tsx
git commit -m "feat(map): configurable FAB controls with popover/sheet hosts"
```

### Task 13: `MapSurface` shared wrapper

**Files:**
- Create: `frontend/src/map/MapSurface.tsx`
- Test: `frontend/src/test/map/mapSurface.test.tsx`

- [ ] **Step 1: Write the failing test (lifecycle with the maplibre mock)**

```tsx
// frontend/src/test/map/mapSurface.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { mockMaplibreModule } from '../mocks/maplibre';

const mod = mockMaplibreModule();
vi.mock('maplibre-gl', () => mod);
vi.mock('../../map/engine/webgl', () => ({ isWebglAvailable: () => true }));

import { I18nProvider } from '../../i18n/I18nProvider';
import { MapSurface } from '../../map/MapSurface';

beforeEach(() => vi.clearAllMocks());

describe('MapSurface', () => {
  it('creates a MapLibre map on mount and calls onReady after load', async () => {
    const onReady = vi.fn();
    render(<I18nProvider><MapSurface fabs={{ layers: true }} onReady={onReady} /></I18nProvider>);
    expect(mod.Map).toHaveBeenCalledTimes(1);
    mod.__stub.fire('load');
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(mod.__stub));
  });
  it('removes the map on unmount', () => {
    const { unmount } = render(<I18nProvider><MapSurface fabs={{ layers: true }} /></I18nProvider>);
    unmount();
    expect(mod.__stub.remove).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/mapSurface.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `MapSurface`**

Requirements the code must meet:
- Props: `initialCenter?: [lng,lat]`, `initialZoom?`, `fabs` (passed to `MapControls`), `onReady?(map)`, `onBasemapReapply?()`, `defaultBasemapId?`, `children?`, `className?`, plus pass-through control props for tilt/buildings/nodeSize/search/legend.
- On mount: if `!isWebglAvailable()`, render a themed fallback `div` with `t('...')` note and a raster basemap only (no tilt/buildings); else `new maplibregl.Map({ container, style, center, zoom, attributionControl: true })` where the initial style is built from the saved basemap via `getBasemap(getSavedBasemapId())` (use `rasterStyle(entry)` for raster, `entry.styleUrl` for vector; for `vector-recolor` start from `ofm-dark` and swap in via `applyBasemap` after load to keep mount cheap). Call `markBasemapApplied` accordingly.
- After `load`: call `onReady(map)`; apply `setMapLock2D(map, true)` by default (2D locked).
- Basemap switching: keep `selectedBasemapId` state (init `getSavedBasemapId()`); on change call `saveBasemapId`, `applyBasemap(map, getBasemap(id), { reapplyOverlays: onBasemapReapply, buildingsOn, theme, onBuildings: setBuildings3D })`.
- Resize: `ResizeObserver` on the container calling `map.resize()`.
- Render: a relative container `div` with the map div, `{children}`, and `<MapControls .../>` wired to the basemap state and the pass-through control props.
- Cleanup: `map.remove()` on unmount.

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/map/mapSurface.test.tsx && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Browser verification**

`cd frontend && npm run dev`, open `#map`; confirm the map renders, the Layers FAB appears and switches basemaps incl. Nova, and switching a theme does not change the basemap. Capture a screenshot.

- [ ] **Step 6: Commit (only if instructed)**

```bash
git add frontend/src/map/MapSurface.tsx frontend/src/test/map/mapSurface.test.tsx
git commit -m "feat(map): shared MapSurface wrapper hosting FAB controls"
```

---

## Slice 6: main MapView on MapSurface

### Task 14: Rewrite `MapView` (nodes, popups, fit/focus, filters)

**Files:**
- Rewrite: `frontend/src/components/MapView.tsx`
- Rewrite: `frontend/src/test/mapView.test.tsx`

- [ ] **Step 1: Rewrite the MapView test to the new structure**

The old test mocks `react-leaflet` and asserts marker `data-fill-color` and English filter strings. Replace it with tests that:
- mock `maplibre-gl` via `mockMaplibreModule()` and `../map/engine/webgl` (`isWebglAvailable: true`);
- render `MapView` with a small `contacts` array and assert the nodes source received a FeatureCollection whose feature count matches the since-filtered contacts (spy on `__stub.addSource`/the source `setData`);
- assert the "since" filter and focused-contact behaviour at the data level (feature inclusion), not Leaflet markers;
- assert `onSelectContact` fires when the node-layer click handler is invoked (call the captured `click` handler from `__stub.on`).

Write these assertions concretely against the `createNodesLayer` data path. (Keep the fake-timers recency-stability idea from the old test, retargeted to `buildNodeFeatures`.)

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/mapView.test.tsx`
Expected: FAIL (new MapView not written yet).

- [ ] **Step 3: Rewrite `MapView` on `MapSurface`**

Requirements:
- Keep the same `MapViewProps` (contacts, focusedKey, config, blockedKeys, blockedNames, onSelectContact, focusedLatLon, focusedLabel).
- Preserve state: `sinceId` + custom datetime (reuse `MAP_SINCE_PRESETS`, `remoteterm-map-since`), `showPackets`, `discoveryMode`, `nodeScale` (new `remoteterm-map-node-scale`), `tilt3D`, `buildings`.
- Compute `mappableContacts` with the same since-window + blocked filters as today (`MapView.tsx:621-633` logic), plus always-include the focused contact.
- Render `<MapSurface fabs={{ layers:true, legend:true, search:true, tilt:true, buildings:true, nodeSize:true }} onReady={...} ...>`; in `onReady`, create the nodes layer via `createNodesLayer(map, { onClick })`, `ensure()`, and `setData(mappableContacts, nowSec)`; on relevant state changes call `setData`/`setNodeScale`.
- Popups: on node click, open a `maplibregl.Popup` with themed DOM (use `text-muted-foreground` for helper/coords, `text-primary` for the name button) rendered via a small helper building the same content as today (name button when `onSelectContact`, last-heard, coords). Do NOT use hardcoded `text-gray-*`.
- Wire tilt (`setMapLock2D(map, !tilt3D)`), buildings (`setBuildings3D(map, buildings, theme)`), node-size (`nodesLayer.setNodeScale`), and search (filter/flyTo to a matched contact).
- Fit/focus: on ready, replicate `MapBoundsHandler` using `map.fitBounds`/`flyTo`/geolocate.
- Move the Since filter, Visualize-packets and Discover-nodes controls into `MapControls` panels (pass as extra panel content or dedicated FABs); keep their existing behaviour and i18n keys.
- Search FAB filters contacts by name/pubkey and `flyTo` the match.

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/mapView.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, clean.

- [ ] **Step 5: Browser verification (desktop + tablet + phone, dark + light)**

`npm run dev`, `#map`: nodes render and are clickable (popup themed), since-filter changes the visible set, node-size slider scales live and persists across reload, search flies to a node, tilt toggles 3D, buildings extrude at zoom >= 12. Capture screenshots at ~1440/820/390 px in one dark and one light theme.

- [ ] **Step 6: Commit (only if instructed)**

```bash
git add frontend/src/components/MapView.tsx frontend/src/test/mapView.test.tsx
git commit -m "feat(map): rewrite MapView on MapLibre MapSurface"
```

---

## Slice 7: packet overlays (2D canvas + 3D deck)

### Task 15: `particleOverlay` reprojected to MapLibre

**Files:**
- Create: `frontend/src/map/layers/particleOverlay.ts`
- Test: `frontend/src/test/map/particleOverlay.test.ts`

- [ ] **Step 1: Write a failing test for the pure projection mapping**

Extract the per-frame position math into a pure function `projectParticlePath(points, project)` so it is testable without a canvas.

```ts
// frontend/src/test/map/particleOverlay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { projectParticlePath } from '../../map/layers/particleOverlay';

describe('projectParticlePath', () => {
  it('maps each [lng,lat] via the map projector to container points', () => {
    const project = vi.fn(([lng, lat]: [number, number]) => ({ x: lng * 2, y: lat * 2 }));
    const pts = projectParticlePath([[5, 52], [6, 53]], project as any);
    expect(pts).toEqual([{ x: 10, y: 104 }, { x: 12, y: 106 }]);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/particleOverlay.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the overlay**

Port `ParticleOverlay` (`MapView.tsx:355-515`) to a framework-free controller that appends a `<canvas>` to `map.getContainer()`, sizes it with `devicePixelRatio`, and in the rAF loop projects points with `map.project([lng,lat])` (replacing Leaflet `latLngToContainerPoint`). Expose `projectParticlePath(points, project)` (pure), `setParticles(particles)`, `start()`, `stop()`, `destroy()`. Listen to map `move`/`zoom`/`resize` to redraw.

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/test/map/particleOverlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Browser verification**

With "Visualize packets" on, confirm particles track the correct hop paths while panning/zooming in 2D. Screenshot.

- [ ] **Step 6: Commit (only if instructed)**

```bash
git add frontend/src/map/layers/particleOverlay.ts frontend/src/test/map/particleOverlay.test.ts
git commit -m "feat(map): MapLibre-projected canvas particle overlay"
```

### Task 16: `tracesDeck` lazy deck.gl 3D arcs + 2D/3D swap

**Files:**
- Create: `frontend/src/map/layers/tracesDeck.ts`
- Modify: `frontend/src/components/MapView.tsx` (swap overlay on tilt)
- Test: `frontend/src/test/map/tracesDeck.test.ts`

- [ ] **Step 1: Write a failing test for the pure arc-row builder**

```ts
// frontend/src/test/map/tracesDeck.test.ts
import { describe, it, expect } from 'vitest';
import { arcRows } from '../../map/layers/tracesDeck';

describe('arcRows', () => {
  it('builds source/target rows from consecutive hop points', () => {
    const rows = arcRows([{ lon: 5, lat: 52 }, { lon: 6, lat: 53 }, { lon: 7, lat: 54 }], [255, 0, 0]);
    expect(rows).toEqual([
      { s: [5, 52, 0], t: [6, 53, 0], color: [255, 0, 0] },
      { s: [6, 53, 0], t: [7, 54, 0], color: [255, 0, 0] },
    ]);
  });
  it('returns [] for a single point', () => {
    expect(arcRows([{ lon: 5, lat: 52 }], [0, 0, 0])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/tracesDeck.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement lazy deck loader + arc rows + controller**

Port `arcRows` (`livemap-deck.js:144-157`) as a pure function. Implement `loadDeck()` as a dynamic `import('deck.gl')` (npm, not the vendored UMD), caching the promise. Implement `createDeckTraces(map)` returning `{ setArcs(rows), clear(), destroy() }` that lazily loads deck, creates a `MapboxOverlay({ interleaved: true })`, `map.addControl(overlay)`, and updates an `ArcLayer` via `overlay.setProps({ layers })`. Remember `map.triggerRepaint()` per interleaved frame (livemap-deck.js note :397-419).

```ts
// frontend/src/map/layers/tracesDeck.ts (arcRows shown; controller per requirements above)
export interface HopPoint { lon: number; lat: number; }
export function arcRows(points: HopPoint[], color: [number, number, number]) {
  const rows: { s: [number, number, number]; t: [number, number, number]; color: [number, number, number] }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    rows.push({ s: [points[i].lon, points[i].lat, 0], t: [points[i + 1].lon, points[i + 1].lat, 0], color });
  }
  return rows;
}

let _deck: Promise<typeof import('deck.gl')> | null = null;
export function loadDeck() { if (!_deck) { _deck = import('deck.gl'); _deck.catch(() => { _deck = null; }); } return _deck; }
```

- [ ] **Step 4: Wire the 2D/3D swap in MapView**

When `tilt3D` turns on: `particleOverlay.stop()`; `createDeckTraces` (lazy) and feed arc rows built from the same resolved hop paths. When off: `deckTraces.clear()` and `particleOverlay.start()`.

- [ ] **Step 5: Run tests, expect pass**

Run: `npx vitest run src/test/map/tracesDeck.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Browser verification**

Toggle 3D with packets on: arcs render in deck.gl and animate; toggle back to 2D restores the canvas overlay. Confirm deck.gl is only fetched after the first 3D switch (Network tab). Screenshot.

- [ ] **Step 7: Commit (only if instructed)**

```bash
git add frontend/src/map/layers/tracesDeck.ts frontend/src/components/MapView.tsx frontend/src/test/map/tracesDeck.test.ts
git commit -m "feat(map): lazy deck.gl 3D arc traces with 2D/3D overlay swap"
```

---

## Slice 8: per-link layer from the packet network graph

### Task 17: Link geojson from graph edges (liveness-only)

**Files:**
- Create: `frontend/src/map/layers/linksLayer.ts`
- Test: `frontend/src/test/map/linksLayer.test.ts`

- [ ] **Step 1: Confirm the node-id -> contact mapping (spike, no code)**

Read `frontend/src/networkGraph/packetNetworkGraph.ts` (`buildPacketNetworkContext` :107, `PacketNetworkNode` :51-62, `projectPacketNetwork` :750) and the visualizer's usage to establish how a `PacketNetworkNode.id` maps to a `Contact` (public key or prefix). Record the resolver shape (e.g. `nodeId -> Contact | undefined`). This determines the `resolveContact` argument below. Do not invent a scheme; derive it from the code.

- [ ] **Step 2: Write the failing test**

```ts
// frontend/src/test/map/linksLayer.test.ts
import { describe, it, expect } from 'vitest';
import { buildLinkArcs, livenessOpacity } from '../../map/layers/linksLayer';

const now = 1_000_000_000_000; // ms
describe('livenessOpacity', () => {
  it('is max when fresh and floors when stale', () => {
    expect(livenessOpacity(now, now)).toBeCloseTo(0.85, 5);
    expect(livenessOpacity(now - 40 * 24 * 3600e3, now)).toBeCloseTo(0.12, 5);
  });
  it('floors when timestamp missing', () => { expect(livenessOpacity(null, now)).toBeCloseTo(0.12, 5); });
});

describe('buildLinkArcs', () => {
  const resolve = (id: string) => ({ a: { lat: 52, lon: 5 }, b: { lat: 53, lon: 6 } } as Record<string, { lat: number; lon: number }>)[id];
  it('builds a LineString per link whose endpoints both resolve to coordinates', () => {
    const links = [
      { sourceId: 'a', targetId: 'b', lastActivity: now },
      { sourceId: 'a', targetId: 'missing', lastActivity: now }, // dropped
    ];
    const fc = buildLinkArcs(links as any, resolve as any, now);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe('LineString');
    expect(fc.features[0].geometry.coordinates[0]).toEqual([5, 52]);
    expect(fc.features[0].properties.liveness).toBeCloseTo(0.85, 5);
  });
});
```

- [ ] **Step 3: Run it, expect failure**

Run: `npx vitest run src/test/map/linksLayer.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement (liveness-only; ports `livemap-links.js` livenessOpacity/layer shape)**

```ts
// frontend/src/map/layers/linksLayer.ts
import type { Map as MlMap } from 'maplibre-gl';
import type { PacketNetworkLink } from '../../networkGraph/packetNetworkGraph';

const FRESH_MS = 24 * 3600e3;
const STALE_MS = 24 * 14 * 3600e3;
const MAX_OPACITY = 0.85;
const FLOOR_OPACITY = 0.12;

export function livenessOpacity(lastActivityMs: number | null | undefined, now: number): number {
  if (lastActivityMs == null) return FLOOR_OPACITY;
  const ms = Math.max(0, now - lastActivityMs);
  if (ms <= FRESH_MS) return MAX_OPACITY;
  if (ms >= STALE_MS) return FLOOR_OPACITY;
  const k = (ms - FRESH_MS) / (STALE_MS - FRESH_MS);
  return MAX_OPACITY - k * (MAX_OPACITY - FLOOR_OPACITY);
}

export type ContactCoord = { lat: number; lon: number };
export type ResolveCoord = (nodeId: string) => ContactCoord | undefined;

export function buildLinkArcs(links: PacketNetworkLink[], resolve: ResolveCoord, now: number) {
  const features = [];
  for (const link of links) {
    const a = resolve(link.sourceId);
    const b = resolve(link.targetId);
    if (!a || !b) continue;
    features.push({
      type: 'Feature' as const,
      properties: { liveness: livenessOpacity(link.lastActivity, now) },
      geometry: { type: 'LineString' as const, coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
    });
  }
  return { type: 'FeatureCollection' as const, features };
}

export function createLinksLayer(map: MlMap) {
  const m = map as any;
  let visible = false;
  function ensureLayer() {
    if (m.getSource('rt-links')) return;
    const before = m.getLayer('rt-nodes') ? 'rt-nodes' : undefined;
    m.addSource('rt-links', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({
      id: 'rt-links', type: 'line', source: 'rt-links',
      layout: { visibility: 'none', 'line-cap': 'round' },
      paint: { 'line-color': '#58a6ff', 'line-opacity': ['get', 'liveness'], 'line-width': 1.5 },
    }, before);
  }
  function setData(links: PacketNetworkLink[], resolve: ResolveCoord) {
    const src = m.getSource('rt-links');
    if (src) src.setData(buildLinkArcs(links, resolve, Date.now()));
  }
  return {
    ensure() { ensureLayer(); },
    reattach() { ensureLayer(); if (visible) m.setLayoutProperty('rt-links', 'visibility', 'visible'); },
    show() { ensureLayer(); visible = true; m.setLayoutProperty('rt-links', 'visibility', 'visible'); },
    hide() { visible = false; if (m.getLayer('rt-links')) m.setLayoutProperty('rt-links', 'visibility', 'none'); },
    setData,
  };
}
```

- [ ] **Step 5: Wire into MapView**

Build the graph state from `rawPacketStore` using the existing pipeline confirmed in Step 1 (`createPacketNetworkState` -> `ingestPacketIntoPacketNetwork` per packet -> `projectPacketNetwork`), map node ids to contacts via the resolver, and call `linksLayer.setData(projection.links.values(), resolve)`. Add a "Links" toggle FAB/panel entry (`map_links_label`) calling `show()`/`hide()`.

- [ ] **Step 6: Run tests, expect pass**

Run: `npx vitest run src/test/map/linksLayer.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Browser verification**

Enable Links; confirm arcs draw between located nodes and fade with staleness; disabling hides them. Screenshot.

- [ ] **Step 8: Commit (only if instructed)**

```bash
git add frontend/src/map/layers/linksLayer.ts frontend/src/components/MapView.tsx frontend/src/test/map/linksLayer.test.ts
git commit -m "feat(map): client-side per-link layer (liveness-only) from packet graph"
```

---

## Slice 9: mini-maps

### Task 18: `MiniMap` preset + migrate NeighborsMiniMap and ContactInfoPane mini-map

**Files:**
- Create: `frontend/src/map/MiniMap.tsx`
- Rewrite: `frontend/src/components/NeighborsMiniMap.tsx`
- Modify: `frontend/src/components/ContactInfoPane.tsx` (mini-map block :1234-1266)
- Test: rewrite `frontend/src/test/` coverage for NeighborsMiniMap if present; add `frontend/src/test/map/miniMap.test.tsx`

- [ ] **Step 1: Write a failing test for MiniMap**

```tsx
// frontend/src/test/map/miniMap.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { mockMaplibreModule } from '../mocks/maplibre';
const mod = mockMaplibreModule();
vi.mock('maplibre-gl', () => mod);
vi.mock('../../map/engine/webgl', () => ({ isWebglAvailable: () => true }));
import { I18nProvider } from '../../i18n/I18nProvider';
import { MiniMap } from '../../map/MiniMap';

describe('MiniMap', () => {
  it('creates a map and enables the Layers FAB by default', () => {
    render(<I18nProvider><MiniMap center={[5, 52]} zoom={12} /></I18nProvider>);
    expect(mod.Map).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/test/map/miniMap.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `MiniMap`**

A thin wrapper over `MapSurface` with `fabs={{ layers: true }}` by default (overridable), fixed `center`/`zoom` or `fitBounds` to provided markers, exposing `onReady(map)` so consumers draw their own markers/polylines as GL layers. No packet overlays.

- [ ] **Step 4: Migrate NeighborsMiniMap**

Replace react-leaflet with `MiniMap`. In `onReady`, add a geojson source+layer for the radio marker (blue), the neighbor markers (SNR-colored fill via a `circle-color` step expression on an `snr` property: `>=6 #22c55e`, `>=0 #eab308`, else `#ef4444`), and dashed connector lines (a line layer with `line-dasharray`). Remove `import 'leaflet/dist/leaflet.css'` and `InvalidateOnResize` (MapSurface handles resize).

- [ ] **Step 5: Migrate the ContactInfoPane mini-map**

Replace the `MapContainer`/`TileLayer`/`CircleMarker` block (`ContactInfoPane.tsx:1234-1266`) with `<MiniMap center={[lon,lat]} zoom={13} onReady={...}/>` that adds a single GL circle marker + popup for the contact. Keep the surrounding `h-48 rounded border` container and the `mapExpanded` gate.

- [ ] **Step 6: Run tests, expect pass**

Run: `npx vitest run src/test/map/miniMap.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, clean.

- [ ] **Step 7: Browser verification**

Open a repeater's Neighbors pane and a contact's info GPS map; confirm both render on MapLibre, show the Layers FAB, and switch basemaps. Screenshot each.

- [ ] **Step 8: Commit (only if instructed)**

```bash
git add frontend/src/map/MiniMap.tsx frontend/src/components/NeighborsMiniMap.tsx frontend/src/components/ContactInfoPane.tsx frontend/src/test/map/miniMap.test.tsx
git commit -m "feat(map): MiniMap preset; migrate Neighbors and ContactInfo mini-maps"
```

---

## Slice 10: PathRouteMap + LocationPickerModal

### Task 19: Migrate `PathRouteMap`

**Files:**
- Rewrite: `frontend/src/components/PathRouteMap.tsx`
- Rewrite: `frontend/src/test/pathRouteMap.test.tsx`

- [ ] **Step 1: Read the current component and its test**

Read `PathRouteMap.tsx` and `src/test/pathRouteMap.test.tsx` to capture its props (the hop route it draws) and current assertions.

- [ ] **Step 2: Rewrite the test to the new structure**

Mock `maplibre-gl` and `webgl` as in Task 13. Assert that given a route prop, the component adds a line source whose coordinates match the hop path and one marker per hop (spy on `__stub.addSource`/`addLayer`).

- [ ] **Step 3: Run it, expect failure**

Run: `npx vitest run src/test/pathRouteMap.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Rewrite `PathRouteMap` on `MiniMap`/`MapSurface`**

Draw the hop route as a GL line layer + per-hop circle markers; fit bounds to the route; enable the Layers FAB. Remove all Leaflet imports.

- [ ] **Step 5: Run tests, expect pass**

Run: `npx vitest run src/test/pathRouteMap.test.tsx && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Browser verification**

Open a packet path modal; confirm the route renders on MapLibre with the Layers FAB. Screenshot.

- [ ] **Step 7: Commit (only if instructed)**

```bash
git add frontend/src/components/PathRouteMap.tsx frontend/src/test/pathRouteMap.test.tsx
git commit -m "feat(map): migrate PathRouteMap to MapLibre"
```

### Task 20: Migrate `LocationPickerModal`

**Files:**
- Rewrite: `frontend/src/components/LocationPickerModal.tsx`
- Test: add/adjust `frontend/src/test/` coverage if present

- [ ] **Step 1: Read the current component**

Read `LocationPickerModal.tsx` to capture its props and the click-to-pick contract (the lat/lon it returns).

- [ ] **Step 2: Write/adjust a failing test**

If a test exists, retarget it: assert that clicking the map (fire the maplibre `click` handler with a `lngLat`) reports the picked `{lat, lon}` via the component's callback. If none exists, add one using the maplibre mock.

- [ ] **Step 3: Run it, expect failure**

Run: `npx vitest run src/test/<locationPicker test>`
Expected: FAIL.

- [ ] **Step 4: Rewrite on `MapSurface`**

Host `MapSurface` inside the modal; add a `click` handler reading `e.lngLat` to place/move a draggable marker and report the coordinate; enable the Layers FAB. Remove Leaflet imports.

- [ ] **Step 5: Run tests, expect pass**

Run: `npx vitest run src/test/<locationPicker test> && npx tsc --noEmit && npm run lint`
Expected: PASS, clean.

- [ ] **Step 6: Browser verification**

Open the location picker; confirm clicking sets the marker/coordinate and the Layers FAB works. Screenshot.

- [ ] **Step 7: Commit (only if instructed)**

```bash
git add frontend/src/components/LocationPickerModal.tsx frontend/src/test/
git commit -m "feat(map): migrate LocationPickerModal to MapLibre"
```

---

## Slice 11: remove Leaflet, theme CSS, final verification

### Task 21: Remove Leaflet and add MapLibre control theming

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/styles.css:56-67`
- Modify: any remaining files importing leaflet

- [ ] **Step 1: Confirm no Leaflet imports remain**

Run (from repo root):
```bash
grep -rn "leaflet\|react-leaflet" frontend/src
```
Expected: zero matches. If any remain, fix them before continuing.

- [ ] **Step 2: Remove deps**

Run (from `frontend/`):
```bash
npm uninstall leaflet react-leaflet @types/leaflet
```
Expected: the three packages leave `package.json`/lockfile.

- [ ] **Step 3: Swap Leaflet CSS for MapLibre control/popup theming**

In `frontend/src/styles.css`, delete the `.leaflet-container` / `.leaflet-pane` / `.leaflet-control` block (56-67) and add MapLibre equivalents driven by the HSL tokens:
```css
/* MapLibre chrome uses theme tokens */
.maplibregl-ctrl-group { background: hsl(var(--card)); border: 1px solid hsl(var(--border)); }
.maplibregl-ctrl-group button + button { border-top: 1px solid hsl(var(--border)); }
.maplibregl-popup-content { background: hsl(var(--popover)); color: hsl(var(--popover-foreground)); border: 1px solid hsl(var(--border)); }
.maplibregl-popup-tip { border-top-color: hsl(var(--popover)); }
.maplibregl-ctrl-attrib { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.maplibregl-canvas { z-index: 0; }
```
Add `import 'maplibre-gl/dist/maplibre-gl.css';` once (e.g. in `MapSurface.tsx`).

- [ ] **Step 4: Verify build + full test suite**

Run (from `frontend/`):
```bash
npm run build
npm run test:run
npm run lint
```
Expected: build passes (tsc + vite), full vitest suite green (Windows-only pre-existing failures per memory excluded), lint clean.

- [ ] **Step 5: Record the bundle-size delta**

Compare the `vite build` output chunk sizes to a pre-change baseline (`git stash`-free: build on `main` first, note sizes). Record the maplibre/deck chunk sizes and confirm they are in a lazy chunk, not the initial bundle. Write the numbers into the PR description.

- [ ] **Step 6: Commit (only if instructed)**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/styles.css frontend/src/map/MapSurface.tsx
git commit -m "chore(map): remove Leaflet; theme MapLibre chrome via tokens"
```

### Task 22: Full runtime verification matrix

- [ ] **Step 1: Browser matrix per the spec verification plan**

At three viewports (desktop ~1440px, tablet ~820px, phone ~390px) in one dark theme (Original/DarkDutch) and one light theme (Light/Paper Grove), verify on `#map`:
- FAB stack visible on all three; opens popovers on desktop and bottom sheets on compact; same state in both.
- Basemap switch including Nova; nodes/popups/particles render over each basemap.
- 2D/3D toggle tilts and flattens; buildings extrude at zoom >= 12 and recolor with theme.
- Node-size slider scales live and persists across reload.
- Links render and fade with staleness.
- Particle overlay tracks after reprojection (2D); deck traces render in 3D.
- Popups themed (not white) in both themes; both mini-maps, PathRouteMap and LocationPickerModal render with the Layers FAB.
- Raster fallback works with WebGL disabled (chrome://flags or a forced `isWebglAvailable=false`).

Capture screenshots for each viewport/theme.

- [ ] **Step 2: Confirm the branch/build under test**

Verify the running app is this branch's `npm run build` output at `#map` (per AGENTS "confirm the thing you tested is the thing you changed").

- [ ] **Step 3: Write the verification evidence into the PR description**

List the two-plus independent checks per claim with their observed results; mark anything unverified as NOT VERIFIED.

---

## Self-review notes (author)

- Spec coverage: engine (Tasks 2-6), nodes (8), FAB controls on every map (12-13, 18-20), MapView rewrite (14), overlays 2D/3D (15-16), links liveness-only (17), all five surfaces migrated + Leaflet removed (18-21), i18n (11), verification (22). Bundle-size delta (21). WebGL fallback (1, 13, 22).
- Type consistency: source ids `rt-nodes`/`rt-links`, layer controllers expose `ensure`/`reattach`/`setData` consistently; `applyBasemap` ctx `onBuildings` matches `setBuildings3D` signature; `getBasemap` fallback id is `nova` (matches `DEFAULT_BASEMAP_ID`).
- Known research steps (not placeholders): Task 2 Step 3 copies raster presets from `mapTiles.ts`; Task 17 Step 1 confirms the node-id -> contact resolver from `packetNetworkGraph.ts`. Both are concrete reads, required before the code they feed.
