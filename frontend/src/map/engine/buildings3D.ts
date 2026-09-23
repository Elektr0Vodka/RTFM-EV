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
      (s: any) => s.type === 'vector'
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

// Overlay layers (node icons, labels, telemetry badges, external nodes) that
// must draw ABOVE the 3D buildings, so a node icon sitting inside a building
// footprint stays visible instead of being covered by the extrusion. We anchor
// the buildings layer just below whichever of them is lowest in the current
// layer order. The order is read from the map, not assumed: rt-external is
// re-added last after every basemap switch, so it is not always the bottom one.
const OVERLAY_ANCHORS = ['rt-external', 'rt-nodes', 'rt-node-labels', 'rt-telemetry-badges'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function overlayAnchor(m: any): string | undefined {
  const present = OVERLAY_ANCHORS.filter((id) => m.getLayer(id));
  if (present.length === 0) return undefined;
  const order: string[] | undefined = m.getLayersOrder?.();
  if (!order) return present[0];
  let best: string | undefined;
  let bestIdx = Infinity;
  for (const id of present) {
    const idx = order.indexOf(id);
    if (idx >= 0 && idx < bestIdx) {
      best = id;
      bestIdx = idx;
    }
  }
  return best ?? present[0];
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

export async function setBuildings3D(
  map: MlMap,
  on: boolean,
  theme: 'light' | 'dark'
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  try {
    if (!on) {
      if (m.getLayer('buildings-3d')) m.removeLayer('buildings-3d');
      return;
    }
    const src = await ensureBuildingsSource(map);
    const anchor = overlayAnchor(m);
    if (!m.getLayer('buildings-3d')) {
      // Insert below the node/overlay layers so node icons stay on top.
      m.addLayer(buildingsLayerSpec(src, theme), anchor);
    } else {
      // Re-seat below the overlays in case it was previously added on top.
      if (anchor) m.moveLayer('buildings-3d', anchor);
      const paint = buildingsPaint(theme);
      for (const [prop, val] of Object.entries(paint))
        m.setPaintProperty('buildings-3d', prop, val);
    }
    if (m.getPitch() < 30) m.easeTo({ pitch: 45, duration: 500 });
  } catch (e) {
    // non-fatal: buildings just do not appear
    console.error('setBuildings3D failed:', e);
  }
}
