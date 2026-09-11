import type { Map as MlMap } from 'maplibre-gl';

// Ported from EU-Meshcore-Analyzer web/js/lib/maplibre-basemap.js. 3D building
// extrusions on the OpenMapTiles `building` source-layer. Works over a vector OR
// raster basemap: ensureBuildingsSource adds a dedicated vector source when the
// active basemap has none.

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
    id: 'buildings-3d',
    type: 'fill-extrusion' as const,
    source: sourceId,
    'source-layer': 'building',
    minzoom: 12,
    paint: buildingsPaint(theme),
  };
}

let _vectorSourceDef: Promise<unknown> | null = null;
async function vectorSourceDef(): Promise<unknown> {
  if (_vectorSourceDef) return _vectorSourceDef;
  const p = (async () => {
    const res = await fetch('https://tiles.openfreemap.org/styles/positron');
    if (!res.ok) throw new Error('OpenFreeMap style ' + res.status);
    const style = await res.json();
    const entry = Object.values(style.sources || {}).find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.type === 'vector',
    );
    if (!entry) throw new Error('no vector source in OpenFreeMap style');
    return entry;
  })();
  _vectorSourceDef = p;
  p.catch(() => {
    _vectorSourceDef = null;
  });
  return p;
}

export async function ensureBuildingsSource(map: MlMap): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  if (m.getSource('openmaptiles')) return 'openmaptiles';
  if (m.getSource('ofm-buildings')) return 'ofm-buildings';
  const def = await vectorSourceDef();
  if (m.getSource('ofm-buildings')) return 'ofm-buildings';
  m.addSource('ofm-buildings', def);
  return 'ofm-buildings';
}

export async function setBuildings3D(map: MlMap, on: boolean, theme: 'light' | 'dark'): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
