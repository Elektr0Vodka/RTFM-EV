// Every repeater's reach at once (map.mesh-hunter.eu's third Node positions
// stop, core-hunter web/coverage.js upstream/master 000bb89): a ray from the
// repeater to each place it was heard, in a hue of its own (neighbours kept
// apart), the signal in the ray's width and opacity, a two-way hearing (it
// answered us) at full strength and a one-way one receded. A selection keeps
// its stars and dims the rest to a quarter. Pinned by reachVectors.json.
import type { Feature, FeatureCollection, LineString } from 'geojson';

import type { Attribution, Hearing, RegistryNode } from './attribution';
import { estimateFor } from './locate';

export const HUE_COUNT = 12;
const NEAR_M = 2000;
const M_PER_DEG = 111320;
const RAY_WEAK_DBM = -120;
const RAY_STRONG_DBM = -60;
const ONE_WAY_OPACITY = 0.4;
export const DIM_OPACITY = 0.25;
const RAY_MIN_W = 0.8;
const RAY_MAX_W = 3.2;
const RAY_MIN_OP = 0.3;
const RAY_MAX_OP = 0.95;

export function isRepeaterHearing(h: Hearing): boolean {
  return (
    h.sender_role === 'Repeater' ||
    h.sender_kind === 'relay' ||
    h.sender_kind === 'path_hash' ||
    h.sender_kind === 'discover_pubkey' ||
    h.sender_kind === 'trace_reply' ||
    h.sender_kind === 'anon_reply'
  );
}

export function isTwoWay(h: Hearing): boolean {
  return (
    h.sender_kind === 'discover_pubkey' ||
    h.sender_kind === 'trace_reply' ||
    h.sender_kind === 'anon_reply'
  );
}

/** FNV-1a with a final mix, to one of 12 hue slots. */
export function hueSlot(id: string): number {
  const s = String(id ?? '').toLowerCase();
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

function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = (a.lat - b.lat) * M_PER_DEG;
  const dLon = (a.lon - b.lon) * M_PER_DEG * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** A slot per node, stepping on when a node within 2 km already has it. */
export function assignHues(nodes: { id: string; lat: number; lon: number }[]): Map<string, number> {
  const rows = nodes
    .filter((n) => n && n.id != null)
    .map((n) => ({ id: String(n.id).toLowerCase(), lat: n.lat, lon: n.lon }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: { lat: number; lon: number; slot: number }[] = [];
  const out = new Map<string, number>();
  const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Number.isFinite(a.lat) &&
    Number.isFinite(a.lon) &&
    Number.isFinite(b.lat) &&
    Number.isFinite(b.lon) &&
    metresBetween(a, b) < NEAR_M;
  for (const n of rows) {
    if (out.has(n.id)) continue;
    const base = hueSlot(n.id);
    let slot = base;
    for (let step = 0; step < HUE_COUNT; step++) {
      slot = (base + step) % HUE_COUNT;
      if (!placed.some((p) => p.slot === slot && near(p, n))) break;
    }
    out.set(n.id, slot);
    placed.push({ ...n, slot });
  }
  return out;
}

export function rayStrength(rssi: number | null): number {
  if (rssi == null) return 0;
  const v = Number(rssi);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, (v - RAY_WEAK_DBM) / (RAY_STRONG_DBM - RAY_WEAK_DBM)));
}

export function rayStyle(
  rssi: number | null,
  { twoWay = true, dimmed = false }: { twoWay?: boolean; dimmed?: boolean } = {}
): { w: number; op: number } {
  const s = rayStrength(rssi);
  const w = Math.round((RAY_MIN_W + s * (RAY_MAX_W - RAY_MIN_W)) * 100) / 100;
  let op = RAY_MIN_OP + s * (RAY_MAX_OP - RAY_MIN_OP);
  if (!twoWay) op *= ONE_WAY_OPACITY;
  if (dimmed) op *= DIM_OPACITY;
  return { w, op: Math.round(op * 1000) / 1000 };
}

/** 1, or a quarter for what a selection leaves out. */
export function selectionDim(selected: Set<string> | null, id: string | null = null): number {
  if (!selected || !selected.size) return 1;
  if (id == null) return DIM_OPACITY;
  return selected.has(id.toLowerCase()) ? 1 : DIM_OPACITY;
}

type AttributionOf = (h: Hearing) => Attribution | null;
type RegistryNodeOf = (h: Hearing) => RegistryNode | null;

function starAttribution(h: Hearing, attributionOf: AttributionOf, registryNodeOf: RegistryNodeOf) {
  const reach = attributionOf(h);
  const named = reach ? null : registryNodeOf(h);
  return named ? ({ rule: 'node', node: named } as Attribution) : reach;
}

function starKey(h: Hearing, a: Attribution | null): string | null {
  if (a && a.rule === 'node') return a.node.pubkey.toLowerCase();
  if (a && a.rule === 'collision') return null;
  return String(h.sender_id).toLowerCase();
}

/** The star a hearing belongs to, or null (not a repeater, or a collision). */
export function starKeyOf(
  h: Hearing,
  attributionOf: AttributionOf = () => null,
  registryNodeOf: RegistryNodeOf = () => null
): string | null {
  if (!isRepeaterHearing(h) || h.sender_id == null) return null;
  return starKey(h, starAttribution(h, attributionOf, registryNodeOf));
}

export interface Star<H extends Hearing = Hearing> {
  id: string;
  origin: { lat: number; lon: number; kind: 'advertised' | 'estimate' };
  points: H[];
}

export function starSelected(star: Star, selected: Set<string>): boolean {
  return (
    selected.has(star.id) ||
    star.points.some((p) => p.sender_id != null && selected.has(String(p.sender_id).toLowerCase()))
  );
}

const usable = (
  p: { lat: number; lon: number } | null | undefined
): p is { lat: number; lon: number } =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat === 0 && p.lon === 0);

export function coverageStars<H extends Hearing>(
  points: H[],
  {
    positionOf = () => null,
    attributionOf = () => null,
    registryNodeOf = () => null,
  }: {
    positionOf?: (id: string) => { lat: number; lon: number } | null;
    attributionOf?: AttributionOf;
    registryNodeOf?: RegistryNodeOf;
  } = {}
): Star<H>[] {
  const byId = new Map<string, H[]>();
  const nodeOf = new Map<string, RegistryNode>();
  for (const h of points) {
    if (!isRepeaterHearing(h) || h.sender_id == null) continue;
    if (!Number.isFinite(h.lat) || !Number.isFinite(h.lon)) continue;
    const a = starAttribution(h, attributionOf, registryNodeOf);
    const id = starKey(h, a);
    if (id == null) continue;
    if (a && a.rule === 'node') nodeOf.set(id, a.node);
    const list = byId.get(id);
    if (list) list.push(h);
    else byId.set(id, [h]);
  }
  const out: Star<H>[] = [];
  for (const [id, pts] of byId) {
    const advertised = nodeOf.get(id) ?? positionOf(id) ?? null;
    let origin: Star['origin'] | null = null;
    if (usable(advertised))
      origin = { lat: advertised.lat, lon: advertised.lon, kind: 'advertised' };
    else {
      const est = estimateFor(pts.map((p) => ({ lat: p.lat, lon: p.lon, rssi: p.rssi })));
      if (est && usable(est.centroid)) origin = { ...est.centroid, kind: 'estimate' };
    }
    if (origin) out.push({ id, origin, points: pts });
  }
  return out;
}

export function coverageFeatures(
  stars: Star[],
  colorOf: (id: string) => string,
  selected: Set<string> | null
): FeatureCollection<LineString> {
  const dimming = !!(selected && selected.size);
  const features: Feature<LineString>[] = [];
  for (const s of stars) {
    const color = colorOf(s.id);
    const dim = dimming && !starSelected(s, selected!);
    for (const p of s.points) {
      const two = isTwoWay(p);
      const { w, op } = rayStyle(p.rssi, { twoWay: two, dimmed: dim });
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [s.origin.lon, s.origin.lat],
            [p.lon, p.lat],
          ],
        },
        properties: { id: s.id, color, op, w, hub: s.origin.kind },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
