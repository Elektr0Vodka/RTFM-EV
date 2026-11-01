// The coverage map's state in the address's query string, beside whatever
// else is there: the app routes by the hash (#wardrive), so the map keeps
// its keys out of it. Its keys go when the map closes.
import type { UrlState } from './CoverageMap';

export const MAP_KEYS = [
  'lat',
  'lon',
  'z',
  'pitch',
  'bearing',
  'view',
  'mode',
  'from',
  'to',
  'drivers',
  'senders',
  'prefix',
  'types',
  'idclass',
  'nopath',
  'nodepos',
  'stand',
  'locate',
];

function others(): URLSearchParams {
  const p = new URLSearchParams(window.location.search);
  for (const k of MAP_KEYS) p.delete(k);
  return p;
}

function address(p: URLSearchParams): string {
  const q = p.toString();
  return `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`;
}

function merged(p: URLSearchParams): URLSearchParams {
  const out = others();
  for (const [k, v] of p) if (MAP_KEYS.includes(k)) out.set(k, v);
  return out;
}

export function searchUrlState(): UrlState & { clear(): void } {
  return {
    read: () => {
      const all = new URLSearchParams(window.location.search);
      const p = new URLSearchParams();
      for (const [k, v] of all) if (MAP_KEYS.includes(k)) p.set(k, v);
      return p;
    },
    write: (p) => {
      const next = address(merged(p));
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next !== current) window.history.replaceState(window.history.state, '', next);
    },
    link: (p) => `${window.location.origin}${address(merged(p))}`,
    clear: () => {
      window.history.replaceState(window.history.state, '', address(others()));
    },
  };
}
