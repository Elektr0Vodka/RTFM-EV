import type { Map as MlMap } from 'maplibre-gl';
import type { ExternalMapNode } from '../../types';

// External analyzer nodes use a deliberately distinct style (magenta) so they
// never read as locally-heard contacts. MapLibre circle strokes cannot be
// dashed, so the distinction is carried by the magenta fill + dark magenta ring
// rather than the dashed ring the Leaflet version used.
export const EXTERNAL_FILL = '#c026d3';
export const EXTERNAL_STROKE = '#701a75';

export interface ExternalNodeProps {
  pubkey: string;
  name: string;
  role: string;
  last_seen: number | null;
  lat: number;
  lon: number;
}

export function buildExternalFeatures(nodes: ExternalMapNode[]) {
  const features = nodes
    .filter((n) => n.lat != null && n.lon != null)
    .map((n) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [n.lon, n.lat] },
      properties: {
        pubkey: n.pubkey,
        name: n.name || n.pubkey.slice(0, 12),
        role: n.role || '',
        last_seen: n.last_seen ?? null,
        lat: n.lat,
        lon: n.lon,
      } satisfies ExternalNodeProps,
    }));
  return { type: 'FeatureCollection' as const, features };
}

export interface ExternalNodesLayerOptions {
  onClick?: (props: ExternalNodeProps) => void;
}

export function createExternalNodesLayer(map: MlMap, opts: ExternalNodesLayerOptions = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  let listenersBound = false;

  function addSourceAndLayer() {
    if (m.getSource('rt-external')) return;
    m.addSource('rt-external', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    m.addLayer({
      id: 'rt-external',
      type: 'circle',
      source: 'rt-external',
      paint: {
        'circle-radius': 5,
        'circle-color': EXTERNAL_FILL,
        'circle-opacity': 0.65,
        'circle-stroke-color': EXTERNAL_STROKE,
        'circle-stroke-width': 1.5,
      },
    });
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.on('click', 'rt-external', (e: any) => {
      const props = e.features?.[0]?.properties;
      if (props && opts.onClick) opts.onClick(props as ExternalNodeProps);
    });
    m.on('mouseenter', 'rt-external', () => {
      m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', 'rt-external', () => {
      m.getCanvas().style.cursor = '';
    });
  }

  function setData(nodes: ExternalMapNode[]) {
    m.getSource('rt-external')?.setData(buildExternalFeatures(nodes));
  }

  function ensure() {
    addSourceAndLayer();
    bindListeners();
  }
  function reattach() {
    addSourceAndLayer();
  }

  return { ensure, reattach, setData };
}
