import type { Map as MlMap } from 'maplibre-gl';
import type { PacketNetworkLink } from '../../networkGraph/packetNetworkGraph';

// Links have no traffic count and no SNR in the packet network graph
// (PacketNetworkLink is { sourceId, targetId, lastActivity } only), so they
// encode liveness only: opacity fades from fresh to stale by lastActivity.
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

export interface LinkFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { liveness: number };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }[];
}

export function buildLinkArcs(
  links: PacketNetworkLink[],
  resolve: ResolveCoord,
  now: number,
): LinkFeatureCollection {
  const features: LinkFeatureCollection['features'] = [];
  for (const link of links) {
    const a = resolve(link.sourceId);
    const b = resolve(link.targetId);
    if (!a || !b) continue;
    features.push({
      type: 'Feature',
      properties: { liveness: livenessOpacity(link.lastActivity, now) },
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export interface LinksLayerController {
  ensure(): void;
  reattach(): void;
  show(): void;
  hide(): void;
  setData(links: PacketNetworkLink[], resolve: ResolveCoord): void;
}

/** GL line layer for client-derived per-link edges, drawn below the node layer
 *  and fading with staleness. Hidden until shown by the Links toggle. */
export function createLinksLayer(map: MlMap): LinksLayerController {
  const m = map as unknown as {
    getSource: (id: string) => { setData: (d: LinkFeatureCollection) => void } | undefined;
    getLayer: (id: string) => unknown;
    addSource: (id: string, src: unknown) => void;
    addLayer: (layer: unknown, before?: string) => void;
    setLayoutProperty: (id: string, prop: string, value: unknown) => void;
  };
  let visible = false;

  function ensureLayer(): void {
    if (m.getSource('rt-links')) return;
    const before = m.getLayer('rt-nodes') ? 'rt-nodes' : undefined;
    m.addSource('rt-links', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    m.addLayer(
      {
        id: 'rt-links',
        type: 'line',
        source: 'rt-links',
        layout: { visibility: visible ? 'visible' : 'none', 'line-cap': 'round' },
        paint: {
          'line-color': '#58a6ff',
          'line-opacity': ['get', 'liveness'],
          'line-width': 1.5,
        },
      },
      before,
    );
  }

  return {
    ensure(): void {
      ensureLayer();
    },
    reattach(): void {
      ensureLayer();
      if (visible && m.getLayer('rt-links')) m.setLayoutProperty('rt-links', 'visibility', 'visible');
    },
    show(): void {
      ensureLayer();
      visible = true;
      m.setLayoutProperty('rt-links', 'visibility', 'visible');
    },
    hide(): void {
      visible = false;
      if (m.getLayer('rt-links')) m.setLayoutProperty('rt-links', 'visibility', 'none');
    },
    setData(links: PacketNetworkLink[], resolve: ResolveCoord): void {
      const src = m.getSource('rt-links');
      if (src) src.setData(buildLinkArcs(links, resolve, Date.now()));
    },
  };
}
