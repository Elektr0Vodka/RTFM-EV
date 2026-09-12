import type { Map as MlMap, ExpressionSpecification } from 'maplibre-gl';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
  type Contact,
} from '../../types';

// GL node layer. Encoding preserves today's UX: fill colour by recency bucket,
// node TYPE by circle-stroke colour (a second, non-colliding encoding), and
// repeaters render larger. Ported in spirit from EU-Meshcore-Analyzer
// web/js/pages/livemap/livemap-nodes-gl.js, but the tiers/colours are RTFM's.

export type RecencyTier = 'recent' | 'today' | 'stale' | 'old';

export const NODE_RECENCY_COLORS: Record<RecencyTier, string> = {
  recent: '#06b6d4',
  today: '#2563eb',
  stale: '#f59e0b',
  old: '#64748b',
};

// Type -> stroke colour. Repeater keeps the near-white ring it has today.
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
  (Object.keys(NODE_RECENCY_COLORS) as RecencyTier[]).forEach((k) =>
    out.push(k, NODE_RECENCY_COLORS[k])
  );
  out.push(NODE_RECENCY_COLORS.old);
  return out as unknown as ExpressionSpecification;
}

export function strokeColorExpr(): ExpressionSpecification {
  const out: unknown[] = ['match', ['get', 'type']];
  Object.entries(NODE_TYPE_STROKE).forEach(([type, color]) => out.push(Number(type), color));
  out.push('#0f172a');
  return out as unknown as ExpressionSpecification;
}

export function circleRadiusExpr(baseR: number, repeaterR: number): ExpressionSpecification {
  return ['case', ['get', 'repeater'], repeaterR, baseR] as unknown as ExpressionSpecification;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;

  function addSourceAndLayer() {
    if (m.getSource('rt-nodes')) return;
    m.addSource('rt-nodes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({
      id: 'rt-nodes',
      type: 'circle',
      source: 'rt-nodes',
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.on('click', 'rt-nodes', (e: any) => {
      const id = e.features?.[0]?.properties?.id;
      if (id && opts.onClick) opts.onClick(id);
    });
    m.on('mouseenter', 'rt-nodes', () => {
      m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', 'rt-nodes', () => {
      m.getCanvas().style.cursor = '';
    });
  }

  function setData(contacts: Contact[], nowSec: number) {
    const src = m.getSource('rt-nodes');
    if (src) src.setData(buildNodeFeatures(contacts, nowSec));
  }

  function setNodeScale(factor: number) {
    nodeScale = factor;
    if (m.getLayer('rt-nodes')) {
      m.setPaintProperty(
        'rt-nodes',
        'circle-radius',
        circleRadiusExpr(baseR * nodeScale, repeaterR * nodeScale)
      );
    }
  }

  function ensure() {
    addSourceAndLayer();
    bindListeners();
  }
  function reattach() {
    addSourceAndLayer();
  }

  return { ensure, reattach, setData, setNodeScale };
}
