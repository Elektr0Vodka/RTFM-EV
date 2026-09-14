import type { AdvertLinkEdge } from '../types';
import { calculateDistance } from '../utils/pathUtils';

/**
 * A node whose nearest resolvable RF neighbour is farther than this many
 * kilometres is treated as reporting a wrong location: mesh RF range cannot
 * realistically span it, so the claimed coordinates are implausible.
 */
export const WRONG_LOCATION_MAX_NEIGHBOR_KM = 300;

/**
 * Given resolved advert-link edges, return the set of node pubkeys (lowercase)
 * whose nearest neighbour is farther than `thresholdKm`.
 *
 * For each node we take the minimum great-circle distance to any node it shares
 * an edge with. A node that appears in no edge is absent from the result
 * (fail-open: the caller keeps it visible, since there is no evidence its
 * location is wrong).
 */
export function computeWrongLocationKeys(
  edges: AdvertLinkEdge[],
  thresholdKm: number = WRONG_LOCATION_MAX_NEIGHBOR_KM
): Set<string> {
  const minNeighborKm = new Map<string, number>();
  const note = (pubkey: string, km: number) => {
    const key = pubkey.toLowerCase();
    const prev = minNeighborKm.get(key);
    if (prev === undefined || km < prev) minNeighborKm.set(key, km);
  };
  for (const e of edges) {
    const km = calculateDistance(e.a.lat, e.a.lon, e.b.lat, e.b.lon);
    if (km === null) continue;
    note(e.a.pubkey, km);
    note(e.b.pubkey, km);
  }
  const wrong = new Set<string>();
  for (const [key, km] of minNeighborKm) {
    if (km > thresholdKm) wrong.add(key);
  }
  return wrong;
}
