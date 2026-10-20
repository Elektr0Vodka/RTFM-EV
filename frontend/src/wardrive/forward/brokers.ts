// Where the wardrive page can forward to: the list RTFM-EV serves at
// GET /api/wardrive/config (app/wardrive/brokers.py). The DutchMeshCore
// collectors and meshcore-analyzer.eu are built in, the owner adds others.
// The two DMC collectors and their stream labels are the ones
// rx.mesh-hunter.eu publishes to (config.json, 2026-10-19): `hunter` is for
// hunts, `wardriver` for coverage drives. They are also the list used before
// the server has answered once.

export type BrokerId = string;

export interface Broker {
  id: BrokerId;
  name: string;
  url: string;
  /** The host a companion token is signed for. */
  audience: string;
  /** companion: a token the radio signs; password: the owner's account. */
  auth: 'companion' | 'password';
  /** wardrive: core-hunter's obs/track messages; packets: observer packets. */
  format: 'wardrive' | 'packets';
  /** Stream label in the wardrive topic (meshcore/<label>/<KEY>/...). */
  label?: string;
  /** Region code in the packets topic (meshcore/<REGION>/<KEY>/packets). */
  region?: string;
  username?: string;
  password?: string;
  builtin: boolean;
}

export const DEFAULT_BROKERS: Broker[] = [
  {
    id: 'dmc-hunter',
    name: 'DutchMeshCore hunter',
    url: 'wss://collector1.dutchmeshcore.nl:443',
    audience: 'collector1.dutchmeshcore.nl',
    auth: 'companion',
    format: 'wardrive',
    label: 'hunter',
    builtin: true,
  },
  {
    id: 'dmc-wardriver',
    name: 'DutchMeshCore wardriver',
    url: 'wss://collector2.dutchmeshcore.nl:443',
    audience: 'collector2.dutchmeshcore.nl',
    auth: 'companion',
    format: 'wardrive',
    label: 'wardriver',
    builtin: true,
  },
];

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The upload to RTFM-EV is queue destination rtfm@<KEY> (uploader.ts): a
 * broker with that id would share its watermark. */
export const RESERVED_BROKER_IDS = new Set(['rtfm']);

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'wss:' && u.hostname ? u.hostname : null;
  } catch {
    return null;
  }
}

function parseBroker(v: unknown): Broker | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  if (!str(b.id) || !str(b.name) || !str(b.url)) return null;
  if (RESERVED_BROKER_IDS.has(b.id)) return null;
  const host = hostOf(b.url);
  if (!host) return null;
  if (b.auth !== 'companion' && b.auth !== 'password') return null;
  if (b.format !== 'wardrive' && b.format !== 'packets') return null;
  if (b.format === 'wardrive' && !str(b.label)) return null;
  if (b.format === 'packets' && !str(b.region)) return null;
  if (b.auth === 'password' && !(str(b.username) && str(b.password))) return null;
  const out: Broker = {
    id: b.id,
    name: b.name,
    url: b.url,
    audience: str(b.audience) ? b.audience : host,
    auth: b.auth,
    format: b.format,
    builtin: b.builtin === true,
  };
  if (b.format === 'wardrive') out.label = b.label as string;
  else out.region = b.region as string;
  if (b.auth === 'password') {
    out.username = b.username as string;
    out.password = b.password as string;
  }
  return out;
}

/** The brokers of a served (or cached) list the page can use; null when it is
 * not a list at all. */
export function parseBrokers(v: unknown): Broker[] | null {
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  const out: Broker[] = [];
  for (const item of v) {
    const b = parseBroker(item);
    if (b && !seen.has(b.id)) {
      seen.add(b.id);
      out.push(b);
    }
  }
  return out;
}

/** What a broker's connection depends on, in a fixed order: the same
 * broker from the built-in list, the cache or the server gives the same
 * text, whatever order its keys came in. The display name is left out. */
export function brokerFingerprint(b: Broker): string {
  return JSON.stringify([
    b.id,
    b.url,
    b.audience,
    b.auth,
    b.format,
    b.label ?? null,
    b.region ?? null,
    b.username ?? null,
    b.password ?? null,
  ]);
}

/** The queue destination of a broker for one radio. */
export function destId(id: BrokerId, radioKey: string): string {
  return `${id}@${radioKey.toUpperCase()}`;
}
