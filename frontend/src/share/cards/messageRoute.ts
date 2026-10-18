import type { MessagePath } from '../../types';
import {
  calculateDistance,
  isValidLocation,
  parsePathHops,
  type ResolvedPath,
} from '../../utils/pathUtils';
import type { LatLon } from '../geo';

export interface RouteStop {
  /** Null when the stop has no known position or the hop is ambiguous. */
  point: LatLon | null;
  kind: 'sender' | 'hop' | 'receiver';
  name: string | null;
}

export interface RouteLine {
  stops: RouteStop[];
  receivedAt: number;
  hopCount: number;
  colorIndex: number;
}

/** Card 1, "How a message reached me": everything the drawing needs, no pixels. */
export interface MessageRouteModel {
  outgoing: boolean;
  /** Sorted by receivedAt ascending; colorIndex is the position after sorting. */
  routes: RouteLine[];
  /** Every located stop once, for fitting the map. */
  located: LatLon[];
  routeCount: number;
  hopsMin: number;
  hopsMax: number;
  /** Sender to receiver when both are located; null for an outgoing message. */
  straightKm: number | null;
  /** Highest last-hop SNR over all paths (the only signal a path carries). */
  bestSnr: number | null;
}

function point(lat: number | null, lon: number | null): LatLon | null {
  return isValidLocation(lat, lon) ? { lat: lat as number, lon: lon as number } : null;
}

export function buildMessageRouteModel(input: {
  paths: Array<MessagePath & { resolved: ResolvedPath }>;
  outgoing: boolean;
}): MessageRouteModel {
  const sorted = [...input.paths].sort((a, b) => a.received_at - b.received_at);
  const routes: RouteLine[] = sorted.map((p, i) => {
    const r = p.resolved;
    const hops: RouteStop[] = r.hops.map((h) => {
      const only = h.matches.length === 1 ? h.matches[0] : null;
      return {
        kind: 'hop',
        name: only?.name ?? null,
        point: only ? point(only.lat ?? null, only.lon ?? null) : null,
      };
    });
    return {
      stops: [
        { kind: 'sender', name: r.sender.name || null, point: point(r.sender.lat, r.sender.lon) },
        ...hops,
        {
          kind: 'receiver',
          name: r.receiver.name || null,
          point: point(r.receiver.lat, r.receiver.lon),
        },
      ],
      receivedAt: p.received_at,
      hopCount: parsePathHops(p.path, p.path_len).length,
      colorIndex: i,
    };
  });

  const seen = new Set<string>();
  const located: LatLon[] = [];
  for (const route of routes) {
    for (const s of route.stops) {
      if (!s.point) continue;
      const key = `${s.point.lat},${s.point.lon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      located.push(s.point);
    }
  }

  const hopCounts = routes.map((r) => r.hopCount);
  const snrs = input.paths.map((p) => p.snr).filter((s): s is number => typeof s === 'number');
  // From the validated stop points: an unset position (null or 0,0) gives no
  // distance rather than one to the middle of the Atlantic.
  const stops = routes[0]?.stops;
  const from = stops?.[0]?.point;
  const to = stops?.[stops.length - 1]?.point;
  const straightKm =
    !input.outgoing && from && to ? calculateDistance(from.lat, from.lon, to.lat, to.lon) : null;

  return {
    outgoing: input.outgoing,
    routes,
    located,
    routeCount: routes.length,
    hopsMin: hopCounts.length ? Math.min(...hopCounts) : 0,
    hopsMax: hopCounts.length ? Math.max(...hopCounts) : 0,
    straightKm: straightKm ?? null,
    bestSnr: snrs.length ? Math.max(...snrs) : null,
  };
}
