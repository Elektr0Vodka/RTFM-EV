// The coverage map's state: what map.mesh-hunter.eu keeps in its URL (the
// camera, the layer mode, the range, the drivers, the senders and filters),
// read back key by key so a shared link with a bad value opens on the
// default for that value only. Also the time tokens of its range picker and
// the API parameters the state asks the server for.
import { PACKET_TYPES } from '../filters';

export type LayerMode = 'points' | 'hex' | 'auto';
export type NodePosStop = 'off' | 'positions' | 'reach';
export type Stand = 'filtered' | 'all';

export interface CoverageState {
  lat: number | null;
  lon: number | null;
  z: number | null;
  pitch: number;
  bearing: number;
  view3d: boolean;
  mode: LayerMode;
  /** Range bounds: a token (`now`, `now-7d`, `now/d`) or a local date-time. */
  from: string;
  to: string;
  drivers: number[];
  senders: string[];
  senderPrefix: string;
  types: string[];
  idclass: string[];
  nopath: boolean;
  nodepos: NodePosStop;
  stand: Stand;
  /** Locate's focus view is on. */
  locate: boolean;
}

export const DEFAULT_STATE: CoverageState = {
  lat: null,
  lon: null,
  z: null,
  pitch: 0,
  bearing: 0,
  view3d: false,
  mode: 'hex',
  from: 'now-30d',
  to: 'now',
  drivers: [],
  senders: [],
  senderPrefix: '',
  types: [],
  idclass: [],
  nopath: false,
  nodepos: 'off',
  stand: 'filtered',
  locate: false,
};

const MODES: LayerMode[] = ['points', 'hex', 'auto'];
const STOPS: NodePosStop[] = ['off', 'positions', 'reach'];
export const ID_CLASSES = ['unnamed', '1b', '2b', '3b', 'pubkey', 'channel'];
const TYPE_NAMES = PACKET_TYPES.map((p) => p.value);

export interface QuickRange {
  id: string;
  from: string;
  to: string;
}

const rolling = (id: string): QuickRange => ({ id, from: `now-${id}`, to: 'now' });

/** map.mesh-hunter.eu's quick ranges: rolling windows up to a day, Today,
 * the longer windows, Last 30 days. */
export const QUICK_RANGES: QuickRange[] = [
  ...['5m', '15m', '30m', '1h', '3h', '6h', '12h', '24h'].map(rolling),
  { id: 'today', from: 'now/d', to: 'now' },
  ...['2d', '7d', '30d'].map(rolling),
];

const UNIT_S: Record<string, number> = { m: 60, h: 3600, d: 86400 };
const TOKEN = /^now(?:-(\d+)([mhd]))?$/;

/** Unix seconds of a range bound at `nowMs`, or null when it cannot be read. */
export function resolveTime(value: string, nowMs: number): number | null {
  const s = value.trim();
  if (!s) return null;
  const now = Math.floor(nowMs / 1000);
  if (s === 'now/d') {
    const d = new Date(nowMs);
    return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
  }
  const m = TOKEN.exec(s);
  if (m) return m[1] ? now - Number(m[1]) * UNIT_S[m[2]] : now;
  // An absolute bound is local time (a datetime-local value) or carries a zone.
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** A range that ends now keeps refreshing. */
export const isLive = (to: string): boolean => to.trim() === 'now';

function num(v: string | null, min: number, max: number): number | null {
  if (v === null || v.trim() === '') return null;
  const x = Number(v);
  return Number.isFinite(x) && x >= min && x <= max ? x : null;
}

const list = (v: string | null): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function decodeState(p: URLSearchParams): CoverageState {
  const d = DEFAULT_STATE;
  const mode = p.get('mode') as LayerMode | null;
  const stop = p.get('nodepos') as NodePosStop | null;
  const range = (key: 'from' | 'to') => {
    const v = p.get(key);
    return v && resolveTime(v, Date.now()) !== null ? v : d[key];
  };
  return {
    lat: num(p.get('lat'), -90, 90),
    lon: num(p.get('lon'), -180, 180),
    z: num(p.get('z'), 0, 24),
    pitch: num(p.get('pitch'), 0, 85) ?? d.pitch,
    bearing: num(p.get('bearing'), -360, 360) ?? d.bearing,
    view3d: p.get('view') === '3d',
    mode: mode && MODES.includes(mode) ? mode : d.mode,
    from: range('from'),
    to: range('to'),
    drivers: list(p.get('drivers'))
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
    senders: list(p.get('senders')),
    senderPrefix: p.get('prefix')?.trim() ?? '',
    types: list(p.get('types')).filter((t) => TYPE_NAMES.includes(t)),
    idclass: list(p.get('idclass')).filter((c) => ID_CLASSES.includes(c)),
    nopath: p.get('nopath') === '1',
    nodepos: stop && STOPS.includes(stop) ? stop : d.nodepos,
    stand: p.get('stand') === 'all' ? 'all' : 'filtered',
    locate: p.get('locate') === '1',
  };
}

const round = (v: number, places: number) => String(Number(v.toFixed(places)));

/** The state as URL parameters, only what differs from the defaults. */
export function encodeState(s: CoverageState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.lat !== null && s.lon !== null) {
    p.set('lat', round(s.lat, 5));
    p.set('lon', round(s.lon, 5));
  }
  if (s.z !== null) p.set('z', round(s.z, 2));
  if (s.pitch) p.set('pitch', round(s.pitch, 1));
  if (s.bearing) p.set('bearing', round(s.bearing, 1));
  if (s.view3d) p.set('view', '3d');
  if (s.mode !== DEFAULT_STATE.mode) p.set('mode', s.mode);
  if (s.from !== DEFAULT_STATE.from) p.set('from', s.from);
  if (s.to !== DEFAULT_STATE.to) p.set('to', s.to);
  if (s.drivers.length) p.set('drivers', s.drivers.join(','));
  if (s.senders.length) p.set('senders', s.senders.join(','));
  if (s.senderPrefix) p.set('prefix', s.senderPrefix);
  if (s.types.length) p.set('types', s.types.join(','));
  if (s.idclass.length) p.set('idclass', s.idclass.join(','));
  if (s.nopath) p.set('nopath', '1');
  if (s.nodepos !== 'off') p.set('nodepos', s.nodepos);
  if (s.stand !== 'filtered') p.set('stand', s.stand);
  if (s.locate) p.set('locate', '1');
  return p;
}

export type QueryParams = Record<string, string | string[]>;

/** What the server is asked for. The All stand keeps the drivers, the time
 * and the ignore list, and lifts the sender, type, id class and path
 * narrowing (map.mesh-hunter.eu's #646). Every known driver picked is the
 * same as none picked. */
export function queryParams(
  s: CoverageState,
  knownDrivers: number[] | null,
  ignore: string[],
  bbox: [number, number, number, number] | null,
  nowMs: number
): QueryParams {
  const p: QueryParams = {};
  const since = resolveTime(s.from, nowMs);
  const until = resolveTime(s.to, nowMs);
  if (since !== null) p.since = String(Math.max(0, since));
  if (until !== null) p.until = String(Math.max(0, until));
  const everyone =
    knownDrivers !== null &&
    knownDrivers.length > 0 &&
    knownDrivers.every((id) => s.drivers.includes(id));
  if (s.drivers.length && !everyone) p.users = s.drivers.join(',');
  if (s.stand === 'filtered') {
    if (s.senders.length) p.sender = [...s.senders];
    if (s.senderPrefix) p.sender_prefix = s.senderPrefix;
    if (s.types.length) p.types = s.types.join(',');
    if (s.idclass.length) p.idclass = s.idclass.join(',');
    if (s.nopath) p.nopath = 'true';
  }
  if (ignore.length) p.ignore = [...ignore];
  if (bbox) p.bbox = bbox.join(',');
  return p;
}

export const STORE_KEY = 'rtfm-wardrive-coverage';

/** The state this browser last had (as URL parameters), or none. */
export function loadStored(key = STORE_KEY): URLSearchParams | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : new URLSearchParams(v);
  } catch {
    return null;
  }
}

export function store(s: CoverageState, key = STORE_KEY): void {
  try {
    localStorage.setItem(key, encodeState(s).toString());
  } catch {
    // Storage blocked: the URL still carries the state.
  }
}

export const IGNORE_STORE_KEY = 'rtfm-wardrive-coverage-ignore';

export function loadIgnore(key = IGNORE_STORE_KEY): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function storeIgnore(ids: string[], key = IGNORE_STORE_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage blocked: the list lasts for this page load.
  }
}
