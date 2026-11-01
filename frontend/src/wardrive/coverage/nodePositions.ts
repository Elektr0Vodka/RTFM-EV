// Node positions (map.mesh-hunter.eu's second stop, core-hunter
// web/nodelayer.js upstream/master 000bb89): each known node at its
// advertised position, against the estimate from where drivers heard it
// (the weighted centroid of the deduped inliers, three at least). The colour
// says the rule: tight within 100 m, drifted outside a search circle the
// geometry trusts (half the compass covered), else unverified. Pinned by
// reachVectors.json.
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

import type { Attribution, Hearing, RegistryNode } from './attribution';
import { registryMatcher } from './attribution';
import { estimateFor, haversineM, type LocatePoint, type LocateStats } from './locate';

export const TIGHT_DRIFT_M = 100;
export const TRUSTED_ENCIRCLEMENT = 0.5;
const M_PER_DEG_LAT = 111320;

export interface Presentation {
  kind: 'none' | 'advertised-only' | 'estimate-only' | 'tight' | 'drifted' | 'unverified';
  driftM?: number;
  circle?: { kind: 'search' | 'drift'; radiusM: number } | null;
  outsideCircle?: boolean;
}

export interface NodeEstimate {
  centroid: { lat: number; lon: number };
  stats: LocateStats;
  n: number;
}

export function driftPresentation(
  advertised: { lat: number; lon: number } | null,
  est: NodeEstimate | null
): Presentation {
  const centroid = est?.centroid ?? null;
  const hasAdvertised =
    !!advertised && Number.isFinite(advertised.lat) && Number.isFinite(advertised.lon);
  if (!hasAdvertised && !centroid) return { kind: 'none' };
  if (!centroid) return { kind: 'advertised-only' };
  if (!hasAdvertised) return { kind: 'estimate-only' };
  const driftM = haversineM(advertised!, centroid);
  if (driftM <= TIGHT_DRIFT_M) return { kind: 'tight', driftM, circle: null, outsideCircle: false };
  const stats = est!.stats;
  const trusted =
    (stats.encirclement ?? 0) >= TRUSTED_ENCIRCLEMENT &&
    Number.isFinite(stats.searchRadiusM as number);
  if (trusted) {
    return {
      kind: 'drifted',
      driftM,
      circle: { kind: 'search', radiusM: stats.searchRadiusM as number },
      outsideCircle: driftM > (stats.searchRadiusM as number),
    };
  }
  return {
    kind: 'unverified',
    driftM,
    circle: { kind: 'drift', radiusM: driftM },
    outsideCircle: false,
  };
}

/** The hearings of each node: attributed by reach to it, or naming it by key
 * or a unique discover prefix. */
export function groupForNodes(
  hearings: Hearing[],
  nodes: RegistryNode[],
  attributionOf: (h: Hearing) => Attribution | null
): Map<string, LocatePoint[]> {
  const out = new Map<string, LocatePoint[]>();
  for (const n of nodes) if (n?.pubkey) out.set(n.pubkey.toLowerCase(), []);
  if (out.size === 0) return out;
  const nodeOf = registryMatcher(nodes);
  for (const h of hearings) {
    if (h.sender_id == null || !Number.isFinite(h.lat) || !Number.isFinite(h.lon)) continue;
    const a = attributionOf(h);
    if (a) {
      const bucket = a.rule === 'node' ? out.get(a.node.pubkey.toLowerCase()) : null;
      if (bucket) bucket.push({ lat: h.lat, lon: h.lon, rssi: h.rssi });
      continue;
    }
    const n = nodeOf(h);
    if (n) out.get(n.pubkey.toLowerCase())!.push({ lat: h.lat, lon: h.lon, rssi: h.rssi });
  }
  return out;
}

export interface NodeRow {
  id: string;
  name: string;
  advertised: { lat: number; lon: number };
  est: NodeEstimate | null;
  p: Presentation;
}

export function nodeRows(nodes: RegistryNode[], byNode: Map<string, LocatePoint[]>): NodeRow[] {
  const rows: NodeRow[] = [];
  for (const n of nodes) {
    if (!n?.pubkey || !Number.isFinite(n.lat) || !Number.isFinite(n.lon)) continue;
    const id = n.pubkey.toLowerCase();
    const est = estimateFor(byNode.get(id) ?? []);
    const advertised = { lat: n.lat, lon: n.lon };
    rows.push({ id, name: n.name ?? '', advertised, est, p: driftPresentation(advertised, est) });
  }
  return rows;
}

export function circleRing(centre: { lat: number; lon: number }, radiusM: number, steps = 48) {
  if (!(radiusM > 0)) return [];
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((centre.lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([
      centre.lon + (radiusM * Math.cos(a)) / mPerDegLon,
      centre.lat + (radiusM * Math.sin(a)) / M_PER_DEG_LAT,
    ]);
  }
  ring.push(ring[0]);
  return ring;
}

export interface NodeLayer {
  advertised: FeatureCollection<Point>;
  estimates: FeatureCollection<Point>;
  drift: FeatureCollection<LineString>;
  circles: FeatureCollection<LineString>;
}

/** The colour of the rule (never a verdict on which position is right). */
export type DriftTone = 'accent' | 'warn' | 'muted';

export function driftTone(p: Presentation): DriftTone {
  if (p.kind === 'tight') return 'accent';
  if (p.kind === 'drifted' && p.outsideCircle) return 'warn';
  return 'muted';
}

export function nodeLayerFeatures(
  rows: NodeRow[],
  colorOf: (row: NodeRow) => string,
  dimOf: (row: NodeRow) => boolean = () => false
): NodeLayer {
  const out: NodeLayer = {
    advertised: { type: 'FeatureCollection', features: [] },
    estimates: { type: 'FeatureCollection', features: [] },
    drift: { type: 'FeatureCollection', features: [] },
    circles: { type: 'FeatureCollection', features: [] },
  };
  for (const row of rows) {
    const color = colorOf(row);
    const op = dimOf(row) ? 0.25 : 1;
    const props = { id: row.id, label: row.name || row.id.slice(0, 6), color, op };
    out.advertised.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.advertised.lon, row.advertised.lat] },
      properties: props,
    } as Feature<Point>);
    if (!row.est) continue;
    const c = row.est.centroid;
    out.estimates.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: props,
    });
    out.drift.features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [row.advertised.lon, row.advertised.lat],
          [c.lon, c.lat],
        ],
      },
      properties: props,
    });
    if (row.p.circle) {
      const ring = circleRing(c, row.p.circle.radiusM);
      if (ring.length) {
        out.circles.features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: ring },
          properties: { ...props, style: row.p.circle.kind },
        });
      }
    }
  }
  return out;
}
