// The node positions layer (rx's ▲/● layer and reach): the nodes RTFM-EV and
// the radio know with an advertised position inside the view, our own estimate
// of where a node is from where this page heard it, the drift between the two
// and, in reach mode, a line from each node to every reception tied to it. An
// advertised position is what the node says about itself, so a gap is called
// drift, not error.
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';

import type { CvdMode, Tone } from '../../utils/accessibility';
import { getDataColors } from '../../utils/cvd/palettes';
import { estimateFor } from '../arrow';
import { REACH_CAP_KM, distanceKm, type DirectoryNode } from '../names';
import type { ViewEntry } from '../useReceptionView';

export const NODEPOS_MODES = ['off', 'positions', 'reach'] as const;
export type NodePosMode = (typeof NODEPOS_MODES)[number];

export function nextNodePosMode(m: NodePosMode): NodePosMode {
  return NODEPOS_MODES[(NODEPOS_MODES.indexOf(m) + 1) % NODEPOS_MODES.length];
}

export function parseNodePosMode(v: string | null): NodePosMode {
  return (NODEPOS_MODES as readonly string[]).includes(v ?? '') ? (v as NodePosMode) : 'off';
}

export const MAX_NODES_DRAWN = 500;
export const MAX_RAYS = 20000;
/** Estimate and advert this close agree: no drift circle. */
export const TIGHT_DRIFT_M = 100;
export const HUE_COUNT = 12;

/** A node's hue slot: FNV-1a over the lower-cased id with a final mix (rx's
 * rule), so the same node keeps its colour across zooms and sessions. */
export function hueSlot(id: string): number {
  const s = id.toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % HUE_COUNT;
}

const PLAIN_HUES = Array.from({ length: HUE_COUNT }, (_, i) => `hsl(${i * 30}, 80%, 55%)`);

/** Node colours: 12 hues 30 degrees apart, or in colourblind mode the
 * palette's categorical series (fewer colours, but ones that stay apart). */
export function nodeHues(cvd: CvdMode, tone: Tone): string[] {
  return cvd === 'off' ? PLAIN_HUES : getDataColors(cvd, tone).series;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Nodes with an advertised position inside the bounds (edges count), the
 * most recently seen first, at most MAX_NODES_DRAWN. With `withReach` the
 * bounds grow by the reach cap (15 km): a node just off screen still draws
 * its reach lines to receptions on it; nodes on screen still come first. */
export function nodesInView(nodes: DirectoryNode[], b: Bounds, withReach = false): DirectoryNode[] {
  const midLat = (b.south + b.north) / 2;
  const padLat = withReach ? REACH_CAP_KM / 111.32 : 0;
  const padLon = withReach ? REACH_CAP_KM / (111.32 * Math.cos((midLat * Math.PI) / 180)) : 0;
  const inside = (n: DirectoryNode, pLat: number, pLon: number) =>
    n.lat !== null &&
    n.lon !== null &&
    n.lat >= b.south - pLat &&
    n.lat <= b.north + pLat &&
    n.lon >= b.west - pLon &&
    n.lon <= b.east + pLon;
  const newest = (a: DirectoryNode, b2: DirectoryNode) => (b2.seen ?? -1) - (a.seen ?? -1);
  const onScreen = nodes.filter((n) => inside(n, 0, 0)).sort(newest);
  const ring = withReach
    ? nodes.filter((n) => !inside(n, 0, 0) && inside(n, padLat, padLon)).sort(newest)
    : [];
  return [...onScreen, ...ring].slice(0, MAX_NODES_DRAWN);
}

/** Receptions per drawn node: its own advert, a discover reply whose prefix
 * starts exactly one drawn node's key, or attribution by reach to it. An id
 * that could be two of them counts for neither. */
export function receptionsByNode(
  entries: ViewEntry[],
  nodes: DirectoryNode[],
  /** Every known node: a discover prefix shared with one off the map is
   * ambiguous too. Defaults to the drawn ones. */
  all: DirectoryNode[] = nodes
): Map<string, ViewEntry[]> {
  const keys = new Set(nodes.map((n) => n.publicKey));
  const out = new Map<string, ViewEntry[]>();
  const add = (key: string, e: ViewEntry) => {
    const list = out.get(key);
    if (list) list.push(e);
    else out.set(key, [e]);
  };
  // Per prefix length: prefix -> the one key that starts with it, or null
  // when several do. Built once per length seen, not per reply.
  const byLength = new Map<number, Map<string, string | null>>();
  const owner = (prefix: string): string | null => {
    let index = byLength.get(prefix.length);
    if (!index) {
      index = new Map();
      for (const n of all) {
        const p = n.publicKey.slice(0, prefix.length);
        index.set(p, index.has(p) && index.get(p) !== n.publicKey ? null : n.publicKey);
      }
      byLength.set(prefix.length, index);
    }
    return index.get(prefix) ?? null;
  };
  for (const e of entries) {
    const { kind, id } = e.sender;
    const lower = id?.toLowerCase() ?? '';
    if (kind === 'advert_pubkey' && keys.has(lower)) add(lower, e);
    else if (kind === 'discover_pubkey' && lower) {
      const key = owner(lower);
      if (key !== null && keys.has(key)) add(key, e);
    } else if (e.attr?.rule === 'node' && keys.has(e.attr.node.publicKey)) {
      add(e.attr.node.publicKey, e);
    }
  }
  return out;
}

/** A closed ring of `steps` points at `radiusM` around a centre ([lon, lat]). */
export function circleRing(
  center: { lat: number; lon: number },
  radiusM: number,
  steps = 48
): [number, number][] {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    ring.push([center.lon + dLon * Math.cos(a), center.lat + dLat * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return ring;
}

export interface NodeFeatures {
  advertised: FeatureCollection<Point>;
  estimates: FeatureCollection<Point>;
  drift: FeatureCollection<LineString>;
  circles: FeatureCollection<Polygon>;
  rays: FeatureCollection<LineString>;
}

export function nodeFeatures(
  nodes: DirectoryNode[],
  byNode: Map<string, ViewEntry[]>,
  hues: string[]
): NodeFeatures {
  const out: NodeFeatures = {
    advertised: { type: 'FeatureCollection', features: [] },
    estimates: { type: 'FeatureCollection', features: [] },
    drift: { type: 'FeatureCollection', features: [] },
    circles: { type: 'FeatureCollection', features: [] },
    rays: { type: 'FeatureCollection', features: [] },
  };
  for (const n of nodes) {
    if (n.lat === null || n.lon === null) continue;
    const home = { lat: n.lat, lon: n.lon };
    const color = hues[hueSlot(n.publicKey) % hues.length];
    const props = { key: n.publicKey, name: n.name ?? n.publicKey.slice(0, 6), color };
    out.advertised.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
      properties: props,
    });
    const heard = byNode.get(n.publicKey) ?? [];
    const est = estimateFor(heard);
    if (est) {
      out.estimates.features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [est.lon, est.lat] },
        properties: props,
      });
      const driftM = distanceKm(home, est) * 1000;
      if (driftM > TIGHT_DRIFT_M) {
        out.drift.features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [n.lon, n.lat],
              [est.lon, est.lat],
            ],
          },
          properties: { ...props, drift_m: Math.round(driftM) },
        });
        // No accuracy claim: a circle as wide as the drift, around the estimate.
        out.circles.features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [circleRing(est, driftM)] },
          properties: { ...props, radius_m: Math.round(driftM) },
        });
      }
    }
    for (const e of heard) {
      if (out.rays.features.length >= MAX_RAYS) break;
      if (e.lat === null || e.lon === null) continue;
      out.rays.features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [n.lon, n.lat],
            [e.lon, e.lat],
          ],
        },
        properties: { key: n.publicKey, color, rssi: e.rssi },
      });
    }
  }
  return out;
}
