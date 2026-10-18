import type { TraceMapNode } from '../../utils/traceMapUtils';
import { calculateDistance, isValidLocation } from '../../utils/pathUtils';
import type { LatLon } from '../geo';

export interface TraceStop {
  point: LatLon | null;
  name: string;
  /** SNR as received at this node (one value, not one per direction). */
  snr: number | null;
  role: TraceMapNode['role'];
}

/** Card 2, "Trace route result": the trace as run, out and back to my radio. */
export interface TraceModel {
  /** My radio first, then the hops, then my radio again (the return). */
  stops: TraceStop[];
  /** Repeater and custom hops; my radio at either end is not a hop. */
  hops: number;
  weakestSnr: number | null;
  /** Sum of the legs whose two ends both have a position; null when none. */
  pathKm: number | null;
  /** The hop the trace turned around at (the middle of A,B,A; else the last hop). */
  turnaroundName: string | null;
  located: LatLon[];
}

/** `nodes` with the local origin first (as TracePane builds them); `names` as shown in the result list. */
export function buildTraceModel(nodes: TraceMapNode[], names: string[]): TraceModel {
  const stops: TraceStop[] = nodes.map((n, i) => ({
    point: isValidLocation(n.lat, n.lon) ? { lat: n.lat as number, lon: n.lon as number } : null,
    name: names[i] ?? n.name ?? '',
    snr: n.snr,
    role: n.role,
  }));

  const hopIdx = stops.flatMap((s, i) => (s.role === 'local' ? [] : [i]));
  const ids = hopIdx.map((i) => nodes[i].publicKey ?? stops[i].name);
  const palindrome =
    ids.length >= 3 && ids.length % 2 === 1 && ids.every((id, i) => id === ids[ids.length - 1 - i]);
  const turnIdx = palindrome ? hopIdx[(hopIdx.length - 1) / 2] : hopIdx[hopIdx.length - 1];

  const snrs = stops
    .slice(1)
    .map((s) => s.snr)
    .filter((v): v is number => typeof v === 'number');

  let pathKm: number | null = null;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1].point;
    const b = stops[i].point;
    if (!a || !b) continue;
    pathKm = (pathKm ?? 0) + (calculateDistance(a.lat, a.lon, b.lat, b.lon) ?? 0);
  }

  const seen = new Set<string>();
  const located: LatLon[] = [];
  for (const s of stops) {
    if (!s.point) continue;
    const key = `${s.point.lat},${s.point.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    located.push(s.point);
  }

  return {
    stops,
    hops: hopIdx.length,
    weakestSnr: snrs.length ? Math.min(...snrs) : null,
    pathKm,
    turnaroundName: turnIdx != null ? stops[turnIdx].name : null,
    located,
  };
}
