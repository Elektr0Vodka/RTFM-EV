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

// Labels only render at/above this zoom to keep wide views uncluttered.
export const LABEL_MIN_ZOOM = 11;

// Font for node labels. MUST be a single font, not a stack: MapLibre requests
// glyphs for the whole comma-joined fontstack as one key, and the basemap glyph
// servers we use (OpenFreeMap for the vector/Nova basemaps, openmaptiles for the
// raster ones) only serve pre-generated single fonts. A multi-font stack 404s
// and the labels silently disappear. "Noto Sans Regular" is served by both.
export const NODE_LABEL_FONT = ['Noto Sans Regular'];

export type NodeLabelMode = 'off' | 'name' | 'tag';

export function recencyTier(lastSeenSec: number | null | undefined, nowSec: number): RecencyTier {
  if (lastSeenSec == null) return 'old';
  const age = nowSec - lastSeenSec;
  if (age < 3600) return 'recent';
  if (age < 86400) return 'today';
  if (age < 3 * 86400) return 'stale';
  return 'old';
}

/**
 * Short ID tag for a node: the public-key prefix sized to the path-hash width
 * observed for that node. hash_mode 0/1/2 -> 1/2/3 bytes -> 2/4/6 hex chars.
 * Unknown / out-of-range modes (null, -1, 3, non-integer) fall back to 1 byte.
 */
export function observedIdTag(publicKey: string, hashMode: number | null | undefined): string {
  const mode =
    typeof hashMode === 'number' && Number.isInteger(hashMode) && hashMode >= 0 && hashMode <= 2
      ? hashMode
      : 0;
  return publicKey.slice(0, (mode + 1) * 2).toUpperCase();
}

function nodeLabel(c: Contact, mode: NodeLabelMode): string {
  if (mode === 'name') return c.name ?? c.public_key.slice(0, 12);
  if (mode === 'tag') return observedIdTag(c.public_key, c.direct_path_hash_mode);
  return '';
}

export function circleColorExpr(): ExpressionSpecification {
  const out: unknown[] = ['match', ['get', 'tier']];
  (Object.keys(NODE_RECENCY_COLORS) as RecencyTier[]).forEach((k) =>
    out.push(k, NODE_RECENCY_COLORS[k])
  );
  out.push(NODE_RECENCY_COLORS.old);
  return out as unknown as ExpressionSpecification;
}

export function strokeColorExpr(
  colors: Record<number, string> = NODE_TYPE_STROKE
): ExpressionSpecification {
  const out: unknown[] = ['match', ['get', 'type']];
  Object.entries(colors).forEach(([type, color]) => out.push(Number(type), color));
  out.push('#0f172a');
  return out as unknown as ExpressionSpecification;
}

export function circleRadiusExpr(baseR: number, repeaterR: number): ExpressionSpecification {
  return ['case', ['get', 'repeater'], repeaterR, baseR] as unknown as ExpressionSpecification;
}

export function buildNodeFeatures(
  contacts: Contact[],
  nowSec: number,
  labelMode: NodeLabelMode = 'off'
) {
  const features = contacts
    .filter((c) => c.lat != null && c.lon != null)
    .map((c) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [c.lon as number, c.lat as number] },
      properties: {
        id: c.public_key,
        name: c.name ?? c.public_key.slice(0, 12),
        label: nodeLabel(c, labelMode),
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
  /** Per-role stroke colours (type encoding). Defaults to NODE_TYPE_STROKE. */
  roleColors?: Record<number, string>;
}

export function createNodesLayer(map: MlMap, opts: NodesLayerOptions = {}) {
  const baseR = opts.baseR ?? 7;
  const repeaterR = opts.repeaterR ?? 10;
  let nodeScale = 1;
  let roleColors: Record<number, string> = opts.roleColors ?? NODE_TYPE_STROKE;
  let labelMode: NodeLabelMode = 'off';
  // The flat circle layer is hidden when the neon node overlay takes over; the
  // label layer stays visible either way. Preserved across style re-attaches.
  let circlesVisible = true;
  let lastContacts: Contact[] = [];
  let lastNowSec = 0;
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
      layout: { visibility: circlesVisible ? 'visible' : 'none' },
      paint: {
        'circle-color': circleColorExpr(),
        'circle-radius': circleRadiusExpr(baseR * nodeScale, repeaterR * nodeScale),
        'circle-opacity': 0.9,
        'circle-stroke-color': strokeColorExpr(roleColors),
        'circle-stroke-width': ['case', ['get', 'repeater'], 3, 2],
      },
    });
    if (!m.getLayer('rt-node-labels')) {
      m.addLayer({
        id: 'rt-node-labels',
        type: 'symbol',
        source: 'rt-nodes',
        minzoom: LABEL_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-allow-overlap': false,
          'text-optional': true,
          'text-font': NODE_LABEL_FONT,
        },
        paint: {
          // Outlined label: near-white fill with a dark halo reads on both
          // light and dark basemaps without needing theme detection. Empty
          // labels ('off' mode) render nothing.
          'text-color': '#f8fafc',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.5,
        },
      });
    }
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
    lastContacts = contacts;
    lastNowSec = nowSec;
    const src = m.getSource('rt-nodes');
    if (src) src.setData(buildNodeFeatures(contacts, nowSec, labelMode));
  }

  function setLabelMode(mode: NodeLabelMode) {
    labelMode = mode;
    const src = m.getSource('rt-nodes');
    if (src) src.setData(buildNodeFeatures(lastContacts, lastNowSec, labelMode));
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

  function setRoleColors(colors: Record<number, string>) {
    roleColors = colors;
    if (m.getLayer('rt-nodes')) {
      m.setPaintProperty('rt-nodes', 'circle-stroke-color', strokeColorExpr(roleColors));
    }
  }

  function setCirclesVisible(v: boolean) {
    circlesVisible = v;
    if (m.getLayer('rt-nodes')) {
      m.setLayoutProperty('rt-nodes', 'visibility', v ? 'visible' : 'none');
    }
  }

  function ensure() {
    addSourceAndLayer();
    bindListeners();
  }
  function reattach() {
    addSourceAndLayer();
  }

  return {
    ensure,
    reattach,
    setData,
    setNodeScale,
    setRoleColors,
    setLabelMode,
    setCirclesVisible,
  };
}
