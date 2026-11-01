// Who a short id was, by reach: map.mesh-hunter.eu's rule (core-hunter
// web/attribution.js, upstream/master 000bb89). A relay, path or direct hash
// is placed on a node only when exactly one known node with that prefix is
// within the reach the signal allows; two in reach is a collision, none an
// estimate. Adverts match by key, discover replies by a unique prefix of at
// least 4 hex. Pinned by reachVectors.json from their modules.

/** A reception as the node and reach layers read it. */
export interface Hearing {
  sender_kind: string | null;
  sender_id: string | null;
  sender_role: string | null;
  lat: number;
  lon: number;
  rssi: number | null;
}

export interface RegistryNode {
  pubkey: string;
  name: string | null;
  lat: number;
  lon: number;
}

export type Attribution =
  | { rule: 'node'; node: RegistryNode }
  | { rule: 'collision'; count: number }
  | { rule: 'estimate'; prefixKnown: boolean };

export const REACH_CAP_KM = 15;
const LINK_BUDGET_DB = 36;
const REACH_FREQ_MHZ = 868;
const M_PER_DEG = 111320;
const HEAD_HEX = 4;

/** Free-space reach of a reception at 868 MHz with a 36 dB budget, capped. */
export function reachKm(rssi: number | null | undefined): number {
  if (typeof rssi !== 'number' || !Number.isFinite(rssi)) return REACH_CAP_KM;
  const km = 10 ** ((LINK_BUDGET_DB - rssi - 20 * Math.log10(REACH_FREQ_MHZ) - 32.44) / 20);
  return Math.min(REACH_CAP_KM, km);
}

const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ATTRIBUTABLE = new Set(['relay', 'path_hash', 'direct_hash']);
const SHORT_ID = /^(?:[0-9a-f]{2}|[0-9a-f]{4}|[0-9a-f]{6})$/i;

function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = (a.lat - b.lat) * M_PER_DEG;
  const dLon = (a.lon - b.lon) * M_PER_DEG * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLon) / 1000;
}

export interface RegistryIndex {
  byPrefix: Map<string, RegistryNode[]>;
}

export function registryIndex(nodes: RegistryNode[]): RegistryIndex {
  const byPrefix = new Map<string, RegistryNode[]>();
  const seen = new Set<string>();
  for (const n of nodes) {
    if (!n?.pubkey || !isCoord(n.lat) || !isCoord(n.lon)) continue;
    const key = n.pubkey.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    for (const len of [2, 4, 6]) {
      const p = key.slice(0, len);
      const list = byPrefix.get(p);
      if (list) list.push(n);
      else byPrefix.set(p, [n]);
    }
  }
  return { byPrefix };
}

export function attributeReception(r: Hearing, index: RegistryIndex): Attribution | null {
  if (!r.sender_kind || !ATTRIBUTABLE.has(r.sender_kind) || r.sender_id == null) return null;
  const id = String(r.sender_id);
  if (!SHORT_ID.test(id)) return null;
  const candidates = index.byPrefix.get(id.toLowerCase()) ?? [];
  const inReach = candidates.filter(
    (n) => kmBetween(r, n) <= reachKm(r.rssi == null ? NaN : r.rssi)
  );
  if (inReach.length === 1) return { rule: 'node', node: inReach[0] };
  if (inReach.length >= 2) return { rule: 'collision', count: inReach.length };
  return { rule: 'estimate', prefixKnown: candidates.length > 0 };
}

export function attributionSignature(a: Attribution | null): string {
  if (!a) return '';
  if (a.rule === 'node') return `node:${a.node.pubkey.toLowerCase()}`;
  if (a.rule === 'estimate') return a.prefixKnown ? 'estimate:known' : 'estimate';
  return a.rule;
}

const isRegistryIdKind = (kind: string | null) =>
  kind === 'advert_pubkey' || kind === 'discover_pubkey';

/** The registry node a hearing names by key (an advert) or by a prefix of at
 * least 4 hex that starts exactly one key (a discover reply). */
export function registryMatcher(nodes: RegistryNode[]): (r: Hearing) => RegistryNode | null {
  const byHead = new Map<string, string[]>();
  const byKey = new Map<string, RegistryNode>();
  for (const n of nodes) {
    const k = n?.pubkey ? n.pubkey.toLowerCase() : null;
    if (!k) continue;
    byKey.set(k, n);
    const head = k.slice(0, HEAD_HEX);
    const list = byHead.get(head);
    if (list) list.push(k);
    else byHead.set(head, [k]);
  }
  return (r) => {
    if (r.sender_id == null || !isRegistryIdKind(r.sender_kind)) return null;
    const id = String(r.sender_id).toLowerCase();
    let matched: string | null = null;
    for (const k of byHead.get(id.slice(0, HEAD_HEX)) ?? []) {
      const ok = r.sender_kind === 'advert_pubkey' ? id === k : id.length >= 4 && k.startsWith(id);
      if (!ok) continue;
      if (matched !== null) return null;
      matched = k;
    }
    return matched ? (byKey.get(matched) ?? null) : null;
  };
}

/** The view's box grown by `km` on every side: a node just off screen can be
 * the one in reach of a reception on it. */
export function padBounds(
  b: { south: number; west: number; north: number; east: number },
  km: number
): { south: number; west: number; north: number; east: number } {
  const dLat = (km * 1000) / M_PER_DEG;
  const poleward = Math.max(Math.abs(b.south - dLat), Math.abs(b.north + dLat));
  const dLon = (km * 1000) / (M_PER_DEG * Math.cos((poleward * Math.PI) / 180));
  return { south: b.south - dLat, west: b.west - dLon, north: b.north + dLat, east: b.east + dLon };
}
