import { CONTACT_TYPE_REPEATER, type Contact } from '../../types';
import { calculateDistance, isValidLocation } from '../../utils/pathUtils';
import type { LatLon } from '../geo';

/** A neighbour as `historical-stats` `neighbors_by_count` returns it (0-hop adverts). */
export interface ReachNeighbor {
  public_key: string;
  name: string | null;
  first_seen: number | null;
  lat: number | null;
  lon: number | null;
  best_snr?: number | null;
}

export interface ReachNode {
  point: LatLon | null;
  name: string;
  snr: number | null;
  firstSeen: number | null;
  isRepeater: boolean;
}

/** Card 3, "My node's reach": who my radio hears directly. */
export interface NodeReachModel {
  center: LatLon | null;
  /** Ordered by first heard (unknown last), for the animation. */
  nodes: ReachNode[];
  count: number;
  /** The backend returns at most 50 neighbours. */
  capped: boolean;
  furthestKm: number | null;
  repeaters: number;
  medianSnr: number | null;
  located: LatLon[];
}

/** Neighbours the backend lists at most (`historical-stats`, LIMIT 50). */
export const REACH_NEIGHBOR_CAP = 50;

const toPoint = (lat: number | null, lon: number | null): LatLon | null =>
  isValidLocation(lat, lon) ? { lat: lat as number, lon: lon as number } : null;

export function buildNodeReachModel(
  neighbors: ReachNeighbor[],
  config: { lat: number | null; lon: number | null } | null,
  contacts: Contact[]
): NodeReachModel {
  const center = config ? toPoint(config.lat, config.lon) : null;
  const repeaterKeys = new Set(
    contacts.filter((c) => c.type === CONTACT_TYPE_REPEATER).map((c) => c.public_key)
  );
  const nodes: ReachNode[] = neighbors
    .map((n) => ({
      point: toPoint(n.lat, n.lon),
      name: n.name || n.public_key.slice(0, 12),
      snr: typeof n.best_snr === 'number' ? n.best_snr : null,
      firstSeen: n.first_seen,
      isRepeater: repeaterKeys.has(n.public_key),
    }))
    .sort((a, b) => (a.firstSeen ?? Infinity) - (b.firstSeen ?? Infinity));

  const distances = center
    ? nodes
        .filter((n) => n.point)
        .map((n) => calculateDistance(center.lat, center.lon, n.point!.lat, n.point!.lon) ?? 0)
    : [];
  const snrs = nodes
    .map((n) => n.snr)
    .filter((s): s is number => s != null)
    .sort((a, b) => a - b);
  const mid = Math.floor(snrs.length / 2);
  const medianSnr =
    snrs.length === 0 ? null : snrs.length % 2 ? snrs[mid] : (snrs[mid - 1] + snrs[mid]) / 2;

  return {
    center,
    nodes,
    count: nodes.length,
    capped: nodes.length >= REACH_NEIGHBOR_CAP,
    furthestKm: distances.length ? Math.max(...distances) : null,
    repeaters: nodes.filter((n) => n.isRepeater).length,
    medianSnr,
    located: [...(center ? [center] : []), ...nodes.flatMap((n) => (n.point ? [n.point] : []))],
  };
}
