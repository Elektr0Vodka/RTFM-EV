// Names for what the radio heard. Sources: the nodes RTFM-EV knows and the
// contacts on the driver's own radio (a NodeDirectory). The rules follow
// rx.mesh-hunter.eu's: a full key takes its node's name; a short id prefix
// gets a name only when every node with it agrees, or when exactly one node
// with that prefix is within radio reach of where it was heard. A name found
// that way is a guess and carries GUESS_MARK.
import type { TFn } from '../i18n/context';
import type { Sender } from './decode/reception';
import { packetTypeLabel } from './filters';

export interface DirectoryNode {
  /** Full public key, lower hex. */
  publicKey: string;
  name: string | null;
  role: string | null;
  lat: number | null;
  lon: number | null;
  /** Unix seconds the source last heard of it. */
  seen: number | null;
}

const INDEXED_PREFIXES = [2, 4, 6];
let nextVersion = 1;

const isPositioned = (n: DirectoryNode) => n.lat !== null && n.lon !== null;
const newer = (a: number | null, b: number | null) => (a ?? -1) > (b ?? -1);

export class NodeDirectory {
  /** Changes with every directory, so views can memoise on it. */
  readonly version: number;
  private readonly keys = new Map<string, DirectoryNode>();
  private readonly prefixes = new Map<string, DirectoryNode[]>();

  constructor(nodes: DirectoryNode[]) {
    this.version = nextVersion++;
    for (const n of nodes) {
      const key = n.publicKey.toLowerCase();
      const had = this.keys.get(key);
      if (!had) {
        this.keys.set(key, { ...n, publicKey: key });
        continue;
      }
      // The newer copy names the node; a position or role only one copy
      // knows is kept.
      const [nw, old] = newer(n.seen, had.seen) ? [n, had] : [had, n];
      const pos = isPositioned(nw) ? nw : old;
      this.keys.set(key, {
        ...nw,
        publicKey: key,
        name: nw.name || old.name,
        role: nw.role ?? old.role,
        lat: pos.lat,
        lon: pos.lon,
      });
    }
    for (const n of this.keys.values()) {
      for (const len of INDEXED_PREFIXES) {
        const p = n.publicKey.slice(0, len);
        const list = this.prefixes.get(p);
        if (list) list.push(n);
        else this.prefixes.set(p, [n]);
      }
    }
  }

  get size(): number {
    return this.keys.size;
  }

  byKey(key: string): DirectoryNode | null {
    return this.keys.get(key.toLowerCase()) ?? null;
  }

  withPrefix(prefix: string): DirectoryNode[] {
    const p = prefix.toLowerCase();
    if (p.length < 2) return [];
    if (INDEXED_PREFIXES.includes(p.length)) return this.prefixes.get(p) ?? [];
    if (p.length >= 64) {
      const n = this.byKey(p);
      return n ? [n] : [];
    }
    const bucket = this.prefixes.get(p.slice(0, 6)) ?? [];
    return bucket.filter((n) => n.publicKey.startsWith(p));
  }

  positionedWithPrefix(prefix: string): DirectoryNode[] {
    return this.withPrefix(prefix).filter(isPositioned);
  }
}

export const REACH_CAP_KM = 15;
const LINK_BUDGET_DB = 36;
const FREQ_MHZ = 868;

/** How far a node heard at this RSSI can be: free-space loss at 868 MHz
 * within a 36 dB budget, capped at 15 km (rx's rule). */
export function reachKm(rssi: number | null): number {
  if (rssi === null || !Number.isFinite(rssi)) return REACH_CAP_KM;
  const lossDb = -rssi + LINK_BUDGET_DB;
  const km = 10 ** ((lossDb - 20 * Math.log10(FREQ_MHZ) - 32.44) / 20);
  return Math.min(km, REACH_CAP_KM);
}

const EARTH_KM = 6371;
const RAD = Math.PI / 180;

/** Equirectangular distance, good enough at radio range. */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const x = (b.lon - a.lon) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
  const y = (b.lat - a.lat) * RAD;
  return EARTH_KM * Math.sqrt(x * x + y * y);
}

export type Attribution =
  | { rule: 'node'; node: DirectoryNode }
  | { rule: 'collision'; count: number }
  | { rule: 'estimate'; prefixKnown: boolean };

const PLACED_KINDS = new Set<Sender['kind']>(['relay', 'path_hash', 'direct_hash']);
const PLACED_LENGTHS = new Set([2, 4, 6]);

/** Which node a short id was, judged by who is in reach of where it was
 * heard. Only for relays and hashes; null for every other sender. */
export function attribute(
  sender: Sender,
  at: { lat: number | null; lon: number | null; rssi: number | null },
  dir: NodeDirectory
): Attribution | null {
  const id = sender.id?.toLowerCase() ?? '';
  if (!PLACED_KINDS.has(sender.kind) || !PLACED_LENGTHS.has(id.length)) return null;
  // Known = a node with this prefix and a position, out of reach: evidence the
  // id belongs to another node than the one heard here (rx's rule).
  const placed = dir.positionedWithPrefix(id);
  const prefixKnown = placed.length > 0;
  if (at.lat === null || at.lon === null) return { rule: 'estimate', prefixKnown };
  const here = { lat: at.lat, lon: at.lon };
  const reach = reachKm(at.rssi);
  const inReach = placed.filter(
    (n) => distanceKm(here, { lat: n.lat as number, lon: n.lon as number }) <= reach
  );
  if (inReach.length === 1) return { rule: 'node', node: inReach[0] };
  if (inReach.length > 1) return { rule: 'collision', count: inReach.length };
  return { rule: 'estimate', prefixKnown };
}

export const GUESS_MARK = '~';

export interface NameParts {
  mark: string;
  name: string;
}

const NONE: NameParts = { mark: '', name: '' };
const HEX = /^[0-9a-f]+$/;

function consensus(id: string, dir: NodeDirectory): NameParts {
  const names = new Set(
    dir
      .withPrefix(id)
      .map((n) => (n.name ?? '').trim())
      .filter(Boolean)
  );
  if (names.size !== 1) return { ...NONE };
  const [name] = names;
  return { mark: id.length <= 6 ? GUESS_MARK : '', name };
}

/** The name to show for a sender, or an empty name when there is none. */
export function nameParts(sender: Sender, attr: Attribution | null, dir: NodeDirectory): NameParts {
  const id = sender.id?.toLowerCase() ?? '';
  if (sender.kind === 'channel_name') return { mark: '', name: sender.label ?? '' };
  if (sender.kind === 'advert_pubkey') {
    return { mark: '', name: sender.label || dir.byKey(id)?.name || '' };
  }
  if (!sender.kind || !id) return { ...NONE };
  if (id.length >= 64) return { mark: '', name: dir.byKey(id)?.name ?? '' };
  if (attr?.rule === 'node') {
    return attr.node.name ? { mark: GUESS_MARK, name: attr.node.name } : { ...NONE };
  }
  if (attr?.rule === 'collision') return { ...NONE };
  if (sender.kind === 'path_hash' || sender.kind === 'direct_hash') return { ...NONE };
  if (attr?.rule === 'estimate' && attr.prefixKnown) return { ...NONE };
  if (id.length >= 2 && HEX.test(id)) return consensus(id, dir);
  return { ...NONE };
}

const HASH_KINDS = new Set<Sender['kind']>(['path_hash', 'direct_hash']);
const VIA_KINDS = new Set<Sender['kind']>(['relay', 'path_hash']);
const SHOWN_ID_HEX = 6;

/** A sender's id as shown when nobody named it: `#64` for a 1-byte hash,
 * the first 6 hex of a key or prefix, a channel sender's own name. */
export function shownId(sender: Sender): string {
  if (!sender.kind || !sender.id) return '';
  if (sender.kind === 'channel_name') return sender.id;
  const id = sender.id.slice(0, SHOWN_ID_HEX);
  return HASH_KINDS.has(sender.kind) ? `#${id}` : id;
}

/** The HUD's sender line: `prefix + name`, or a note when there is no one to name. */
export function senderLine(
  sender: Sender,
  attr: Attribution | null,
  dir: NodeDirectory,
  packetType: string,
  t: TFn
): { prefix: string; name: string; note: string } {
  if (!sender.kind || !sender.id) {
    return {
      prefix: '',
      name: '',
      note: t('wardrive_page_sender_none', { type: packetTypeLabel(packetType, t) }),
    };
  }
  const via = VIA_KINDS.has(sender.kind) ? `${t('wardrive_page_sender_via')} ` : '';
  const parts = nameParts(sender, attr, dir);
  if (parts.name) return { prefix: via + parts.mark, name: parts.name, note: '' };
  const shown = shownId(sender);
  const hash = shown.startsWith('#') && HASH_KINDS.has(sender.kind);
  return { prefix: via + (hash ? '#' : ''), name: hash ? shown.slice(1) : shown, note: '' };
}
