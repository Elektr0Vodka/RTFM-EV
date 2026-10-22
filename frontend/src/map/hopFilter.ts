/**
 * Map "hops" filter: show only nodes whose latest heard advert came in within
 * a maximum number of hops. The hop count is the `path_len` of the node's most
 * recently heard advert path (`/contacts/repeaters/advert-paths`); 0 = heard
 * direct. A node with no stored advert path has no known hop count and is
 * hidden while the filter is active.
 */

import type { ContactAdvertPathSummary } from '../types';

/** null = no hop filter ("Any"). */
export type MaxHops = number | null;

/** The choices offered in the map's Hops panel. */
export const MAX_HOPS_OPTIONS: readonly MaxHops[] = [null, 0, 1, 2, 3, 4, 5];

export function isMaxHops(v: unknown): v is MaxHops {
  return v === null || (typeof v === 'number' && MAX_HOPS_OPTIONS.includes(v));
}

/** Lowercase public key -> hop count of that node's most recently heard advert path. */
export function latestAdvertHops(summaries: ContactAdvertPathSummary[]): Map<string, number> {
  const hops = new Map<string, number>();
  for (const summary of summaries) {
    let latest: ContactAdvertPathSummary['paths'][number] | null = null;
    for (const path of summary.paths) {
      if (latest === null || path.last_seen > latest.last_seen) latest = path;
    }
    if (latest !== null) hops.set(summary.public_key.toLowerCase(), latest.path_len);
  }
  return hops;
}

/** Whether a node with `hops` (undefined = unknown) passes `maxHops`. */
export function passesHopFilter(hops: number | undefined, maxHops: MaxHops): boolean {
  if (maxHops === null) return true;
  return hops !== undefined && hops <= maxHops;
}
