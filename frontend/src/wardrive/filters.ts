// What the driver sees: packet types, id classes, time windows, the filter
// and the filtered/all stand, and the ignore list.
import type { TFn } from '../i18n/context';
import type { Sender } from './decode/reception';

/** The decoder's payload type names, in rx's order, plus Unknown. */
export const PACKET_TYPES: { value: string; labelKey: string }[] = [
  { value: 'Advert', labelKey: 'wardrive_page_type_advert' },
  { value: 'GroupText', labelKey: 'wardrive_page_type_group_text' },
  { value: 'GroupData', labelKey: 'wardrive_page_type_group_data' },
  { value: 'Response', labelKey: 'wardrive_page_type_response' },
  { value: 'Request', labelKey: 'wardrive_page_type_request' },
  { value: 'AnonRequest', labelKey: 'wardrive_page_type_anon_request' },
  { value: 'TextMessage', labelKey: 'wardrive_page_type_text_message' },
  { value: 'Ack', labelKey: 'wardrive_page_type_ack' },
  { value: 'Control', labelKey: 'wardrive_page_type_control' },
  { value: 'Path', labelKey: 'wardrive_page_type_path' },
  { value: 'Multipart', labelKey: 'wardrive_page_type_multipart' },
  { value: 'Trace', labelKey: 'wardrive_page_type_trace' },
  { value: 'RawCustom', labelKey: 'wardrive_page_type_raw_custom' },
  { value: 'Unknown', labelKey: 'wardrive_page_type_unknown' },
];

/** The driver's word for a packet type; a name not in the list is shown as is. */
export function packetTypeLabel(value: string, t: TFn): string {
  const type = PACKET_TYPES.find((p) => p.value === value);
  return type ? t(type.labelKey) : value;
}

export type IdClass = 'unnamed' | '1b' | '2b' | '3b' | 'pubkey' | 'channel';

export const ID_CLASSES: IdClass[] = ['unnamed', '1b', '2b', '3b', 'pubkey', 'channel'];

/** What kind of id a sender carries: a channel name, a 1, 2 or 3 byte hash,
 * a (prefix of a) public key, or none. */
export function idClass(s: Sender): IdClass {
  if (s.kind === 'channel_name') return 'channel';
  const len = s.id?.length ?? 0;
  if (!s.kind || len === 0) return 'unnamed';
  if (len === 2) return '1b';
  if (len === 4) return '2b';
  if (len === 6) return '3b';
  return 'pubkey';
}

const MINUTE = 60000;
const WINDOW_MS: Record<string, number> = {
  '5m': 5 * MINUTE,
  '15m': 15 * MINUTE,
  '30m': 30 * MINUTE,
  '1h': 60 * MINUTE,
  '3h': 180 * MINUTE,
  '6h': 360 * MINUTE,
  '12h': 720 * MINUTE,
  '24h': 1440 * MINUTE,
  '2d': 2880 * MINUTE,
  '7d': 10080 * MINUTE,
};
export const TIME_WINDOWS = Object.keys(WINDOW_MS);
/** The window that keeps everything the page holds. */
export const ALL_TIME = 0;

export function windowMs(token: string): number | null {
  return WINDOW_MS[token] ?? null;
}

export interface Filter {
  /** Sender ids to follow; empty follows everyone. */
  targets: string[];
  types: string[];
  idClasses: IdClass[];
  /** How far back, in ms; ALL_TIME keeps everything. */
  windowMs: number;
  /** Only receptions heard straight from the sender (no path). */
  directOnly: boolean;
}

export const DEFAULT_FILTER: Filter = {
  targets: [],
  types: [],
  idClasses: [],
  windowMs: WINDOW_MS['30m'],
  directOnly: false,
};

/** Filters narrowing the view, for the pill's badge. Targets have their own chip. */
export function activeFilterCount(f: Filter): number {
  return (
    (f.types.length ? 1 : 0) +
    (f.idClasses.length ? 1 : 0) +
    (f.directOnly ? 1 : 0) +
    (f.windowMs !== DEFAULT_FILTER.windowMs ? 1 : 0)
  );
}

/** Filtered shows what the filter keeps; All shows everything in the window. */
export type Stand = 'filtered' | 'all';

export function standFilter(stand: Stand, f: Filter): Filter {
  if (stand === 'filtered') return f;
  return { ...DEFAULT_FILTER, windowMs: f.windowMs };
}

export interface Filterable {
  at: number;
  hops: number | null;
  packetType: string;
  sender: Sender;
}

/** A test for one reception. The ignore list applies in both stands. */
export function makeFilter(
  f: Filter,
  ignore: Set<string>
): (e: Filterable, nowMs: number) => boolean {
  const targets = new Set(f.targets.map((x) => x.toLowerCase()));
  const types = new Set(f.types);
  const classes = new Set(f.idClasses);
  return (e, nowMs) => {
    const id = e.sender.id?.toLowerCase() ?? '';
    if (id && ignore.has(id)) return false;
    if (f.windowMs !== ALL_TIME && nowMs - e.at > f.windowMs) return false;
    if (f.directOnly && e.hops !== 0) return false;
    if (types.size && !types.has(e.packetType)) return false;
    if (classes.size && !classes.has(idClass(e.sender))) return false;
    if (targets.size && !targets.has(id)) return false;
    return true;
  };
}

export const FILTER_KEY = 'rtfm-wardrive-filter';
export const STAND_KEY = 'rtfm-wardrive-stand';
export const IGNORE_KEY = 'rtfm-wardrive-ignore';

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this page load.
  }
}

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;

export function loadFilter(): Filter {
  const raw = read(FILTER_KEY);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FILTER };
  const o = raw as Record<string, unknown>;
  const classes = strings(o.idClasses)?.filter((c): c is IdClass =>
    ID_CLASSES.includes(c as IdClass)
  );
  const win = o.windowMs;
  return {
    targets: strings(o.targets) ?? [],
    types: strings(o.types) ?? [],
    idClasses: classes ?? [],
    windowMs:
      typeof win === 'number' && (win === ALL_TIME || Object.values(WINDOW_MS).includes(win))
        ? win
        : DEFAULT_FILTER.windowMs,
    directOnly: o.directOnly === true,
  };
}

export function saveFilter(f: Filter): void {
  write(FILTER_KEY, JSON.stringify(f));
}

export function loadStand(): Stand {
  try {
    return localStorage.getItem(STAND_KEY) === 'all' ? 'all' : 'filtered';
  } catch {
    return 'filtered';
  }
}

export function saveStand(s: Stand): void {
  write(STAND_KEY, s);
}

export function loadIgnore(): string[] {
  return strings(read(IGNORE_KEY)) ?? [];
}

export function saveIgnore(ids: string[]): void {
  write(IGNORE_KEY, JSON.stringify(ids));
}
