// What the node positions stops and Locate put over the coverage, built from
// the registry slice and the window's receptions (pure; CoverageMap fetches,
// CoverageMapGL draws).
import type { Feature, FeatureCollection, Point } from 'geojson';

import { rssiTier, tierColor } from '../signal';
import type { RegistryEntry } from './api';
import {
  attributeReception,
  registryIndex,
  registryMatcher,
  type Hearing,
  type RegistryNode,
} from './attribution';
import type { CoverageOverlays, LocateLayer } from './CoverageMapGL';
import type { LocateResult } from './locate';
import {
  driftTone,
  groupForNodes,
  nodeLayerFeatures,
  nodeRows,
  type NodeRow,
} from './nodePositions';
import {
  DIM_OPACITY,
  assignHues,
  coverageFeatures,
  coverageStars,
  starKeyOf,
  starSelected,
} from './reach';
import type { NodePosStop } from './state';
import type { MapPoint } from './types';

export const toHearing = (p: MapPoint): Hearing => ({
  sender_kind: p.sender.kind,
  sender_id: p.sender.id,
  sender_role: p.sender.role,
  lat: p.lat,
  lon: p.lon,
  rssi: p.rssi,
});

export function toRegistry(entries: RegistryEntry[]): RegistryNode[] {
  const out: RegistryNode[] = [];
  for (const e of entries) {
    if (e.lat === null || e.lon === null || !Number.isFinite(e.lat) || !Number.isFinite(e.lon))
      continue;
    if (e.lat === 0 && e.lon === 0) continue;
    out.push({ pubkey: e.public_key.toLowerCase(), name: e.name, lat: e.lat, lon: e.lon });
  }
  return out;
}

const TONES = { accent: '#22d3ee', warn: '#f97316', muted: '#9ca3af' } as const;

export type HeardPoint = MapPoint & Hearing;

/** Every repeater's star over the points, with a hue per star (neighbours apart). */
export function starsFor(registry: RegistryNode[], points: MapPoint[], palette: string[]) {
  const hearings: HeardPoint[] = points.map((p) => ({ ...p, ...toHearing(p) }));
  const index = registryIndex(registry);
  const attributionOf = (h: Hearing) => attributeReception(h, index);
  const matcher = registryMatcher(registry);
  const byKey = new Map(registry.map((n) => [n.pubkey, n]));
  const stars = coverageStars(hearings, {
    positionOf: (id) => byKey.get(id) ?? null,
    attributionOf,
    registryNodeOf: matcher,
  });
  const hues = assignHues(stars.map((s) => ({ id: s.id, lat: s.origin.lat, lon: s.origin.lon })));
  const colorOf = (id: string) => palette[(hues.get(id) ?? 0) % palette.length];
  return { stars, colorOf, byKey, attributionOf, matcher, hearings };
}

export interface NodeOverlayInput {
  registry: RegistryNode[];
  points: MapPoint[];
  /** south, west, north, east: the nodes drawn are the ones in view. */
  bbox: [number, number, number, number];
  stop: NodePosStop;
  selected: Set<string>;
  palette: string[];
}

export interface NodeOverlayResult {
  overlays: Pick<CoverageOverlays, 'nodes' | 'reach'>;
  rows: NodeRow[];
  /** Repeaters with a star in this window (their reach can be drawn). */
  heard: Set<string>;
  pointOpacity?: (p: MapPoint) => number;
  cellOpacity: number;
}

export function buildNodeOverlays({
  registry,
  points,
  bbox,
  stop,
  selected,
  palette,
}: NodeOverlayInput): NodeOverlayResult {
  const [south, west, north, east] = bbox;
  const hearings = points.map(toHearing);
  const index = registryIndex(registry);
  const attributionOf = (h: Hearing) => attributeReception(h, index);
  const matcher = registryMatcher(registry);
  const inView = registry.filter(
    (n) => n.lat >= south && n.lat <= north && n.lon >= west && n.lon <= east
  );
  const rows = nodeRows(inView, groupForNodes(hearings, registry, attributionOf));
  if (stop !== 'reach') {
    const nodes = nodeLayerFeatures(rows, (row) => TONES[driftTone(row.p)]);
    return {
      overlays: {
        nodes: { ...nodes, hubs: { type: 'FeatureCollection', features: [] } },
        reach: null,
      },
      rows,
      heard: new Set(),
      cellOpacity: 1,
    };
  }
  const { stars, colorOf } = starsFor(registry, points, palette);
  const reach = coverageFeatures(stars, colorOf, selected);
  const heard = new Set(stars.map((s) => s.id));
  const lit = new Set([
    ...selected,
    ...stars.filter((s) => starSelected(s, selected)).map((s) => s.id),
  ]);
  const dimming = selected.size > 0;
  const nodes = nodeLayerFeatures(
    rows,
    (row) => (heard.has(row.id) ? colorOf(row.id) : TONES[driftTone(row.p)]),
    (row) => dimming && !lit.has(row.id)
  );
  const hubs: Feature<Point>[] = stars
    .filter((s) => s.origin.kind === 'estimate')
    .map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.origin.lon, s.origin.lat] },
      properties: {
        id: s.id,
        color: colorOf(s.id),
        op: dimming && !lit.has(s.id) ? DIM_OPACITY : 1,
      },
    }));
  return {
    overlays: { nodes: { ...nodes, hubs: { type: 'FeatureCollection', features: hubs } }, reach },
    rows,
    heard,
    pointOpacity: dimming
      ? (p) => {
          const key = starKeyOf(toHearing(p), attributionOf, matcher);
          return key !== null && lit.has(key) ? 1 : DIM_OPACITY;
        }
      : undefined,
    cellOpacity: dimming ? DIM_OPACITY : 1,
  };
}

const pointsFc = (
  pts: { lat: number; lon: number; rssi: number | null }[],
  color: (rssi: number | null) => string
): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: pts.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { color: color(p.rssi) },
  })),
});

export function buildLocateLayer(
  r: LocateResult,
  cvd: boolean,
  heat: LocateLayer['heat']
): LocateLayer {
  return {
    inliers: pointsFc(r.inliers, (rssi) => tierColor(rssiTier(rssi), cvd)),
    outliers: pointsFc(r.outliers, () => tierColor('none', cvd)),
    centroid: pointsFc(r.centroid ? [{ ...r.centroid, rssi: null }] : [], () => '#2563eb'),
    strongest: pointsFc(r.strongest ? [r.strongest] : [], () => '#facc15'),
    heat,
  };
}
