import type { StyleSpecification, Map as MlMap } from 'maplibre-gl';
import { recolorNovaDark } from './novaRecolor';

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
  '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
  'and the GIS user community';

export function rasterStyle(entry: BasemapEntry): StyleSpecification {
  const carto: Record<string, unknown> = {
    type: 'raster',
    tiles: entry.tiles,
    tileSize: 256,
    attribution: entry.attribution,
  };
  if (entry.maxzoom) carto.maxzoom = entry.maxzoom;
  return {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: { carto } as unknown as StyleSpecification['sources'],
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
  } as StyleSpecification;
}

export function basemapSig(entry: BasemapEntry): string {
  if (entry.kind === 'vector-recolor') return entry.styleUrl + '#' + (entry.recolorId || 'recolor');
  return entry.kind === 'vector'
    ? String(entry.styleUrl)
    : Array.isArray(entry.tiles)
      ? entry.tiles.join('|')
      : '';
}

export function resolveBasemapKind(entry: BasemapEntry): 'vector' | 'raster' {
  return entry.kind === 'vector' || entry.kind === 'vector-recolor' ? 'vector' : 'raster';
}

export function switchStrategy(
  currentIsRaster: boolean,
  targetKind: 'vector' | 'raster'
): 'setTiles' | 'setStyle' {
  if (targetKind === 'vector') return 'setStyle';
  return currentIsRaster ? 'setTiles' : 'setStyle';
}

// Keyless raster fallbacks (the app's previous raster tile presets). MapLibre
// does not expand the legacy {s} subdomain token, so those URLs are
// pre-expanded into an a/b/c tiles array. Ids and maxZoom caps are kept so a
// saved `remoteterm-map-layer` value keeps resolving and the zoom ceilings match.
const RASTER_FALLBACKS: BasemapEntry[] = [
  {
    id: 'light',
    kind: 'raster',
    label: 'map_tile_layer_light',
    tiles: [
      'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
    ],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxzoom: 19,
    tone: 'light',
  },
  {
    id: 'darkgray',
    kind: 'raster',
    label: 'map_tile_layer_darkgray',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: ESRI_ATTRIBUTION,
    maxzoom: 16,
    tone: 'dark',
  },
  {
    id: 'lightgray',
    kind: 'raster',
    label: 'map_tile_layer_lightgray',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: ESRI_ATTRIBUTION,
    maxzoom: 16,
    tone: 'light',
  },
  {
    id: 'topographic',
    kind: 'raster',
    label: 'map_tile_layer_topographic',
    tiles: [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
      '<a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; ' +
      '<a href="https://opentopomap.org">OpenTopoMap</a> ' +
      '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    maxzoom: 17,
    tone: 'light',
  },
  {
    id: 'natgeo',
    kind: 'raster',
    label: 'map_tile_layer_natgeo',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; National Geographic, Esri, ' +
      'Garmin, HERE, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, iPC',
    maxzoom: 12,
    tone: 'light',
  },
  {
    id: 'satellite',
    kind: 'raster',
    label: 'map_tile_layer_satellite',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, ' +
      'Earthstar Geographics, and the GIS User Community',
    maxzoom: 18,
    tone: 'dark',
  },
];

export const BASEMAPS: BasemapEntry[] = [
  {
    id: 'nova',
    kind: 'vector-recolor',
    label: 'map_layer_nova',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark',
    recolorId: 'nova',
    recolor: recolorNovaDark,
    attribution: OFM_ATTRIBUTION,
    tone: 'dark',
  },
  {
    id: 'ofm-positron',
    kind: 'vector',
    label: 'map_layer_ofm_positron',
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
    attribution: OFM_ATTRIBUTION,
    tone: 'light',
  },
  {
    id: 'ofm-liberty',
    kind: 'vector',
    label: 'map_layer_ofm_liberty',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: OFM_ATTRIBUTION,
    tone: 'light',
  },
  {
    id: 'ofm-dark',
    kind: 'vector',
    label: 'map_layer_ofm_dark',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark',
    attribution: OFM_ATTRIBUTION,
    tone: 'dark',
  },
  {
    id: 'ofm-fiord',
    kind: 'vector',
    label: 'map_layer_ofm_fiord',
    styleUrl: 'https://tiles.openfreemap.org/styles/fiord',
    attribution: OFM_ATTRIBUTION,
    tone: 'dark',
  },
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
    // The former CARTO layer had id 'dark'; migrate a saved selection to the
    // replacement Esri dark basemap so users keep a dark map after the swap.
    if (stored === 'dark') return 'darkgray';
    if (stored && BASEMAPS.some((b) => b.id === stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_BASEMAP_ID;
}

export function saveBasemapId(id: string): void {
  try {
    localStorage.setItem(BASEMAP_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

// --- applyBasemap: switch basemaps with a no-op guard + overlay re-apply ---
// Ported from EU-Meshcore-Analyzer web/js/lib/maplibre-basemap.js.

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
    .then((r) => {
      if (!r.ok) throw new Error('style ' + r.status);
      return r.json();
    })
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

  const afterStyle = () =>
    map.once('styledata', () => {
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
      .then((style) => {
        map.setStyle(style);
        afterStyle();
      })
      .catch(() => {
        _activeBasemap.delete(map);
        applyBasemap(map, getBasemap('ofm-dark'), ctx);
      });
    return;
  }
  const nextStyle = targetKind === 'vector' ? String(entry.styleUrl) : rasterStyle(entry);
  map.setStyle(nextStyle as string | StyleSpecification);
  afterStyle();
}
