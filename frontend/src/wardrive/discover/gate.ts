// When an Auto-discover cycle may fire (core-hunter autoping.js): every 10 s,
// or sooner after 50 m of movement, but never inside the airtime floor the
// previous cycle bought, and never while its trace pings are still queued
// (the companion's send queue drops on overflow).
import { haversineM } from '../capture';

export const INTERVAL_MS = 10000;
export const MOVE_THRESHOLD_M = 50;
/** Trace pings go out this far apart, so the send queue drains one per slot. */
export const STAGGER_MS = 1500;

export interface GateInput {
  lastFireAt: number | null;
  lastLat?: number | null;
  lastLon?: number | null;
  now: number;
  lat?: number | null;
  lon?: number | null;
  pendingTargets: number;
  minPeriodMs: number;
}

export function shouldAutoFire(g: GateInput): boolean {
  if (g.pendingTargets > 0) return false;
  if (g.lastFireAt === null) return true;
  const since = g.now - g.lastFireAt;
  if (since < g.minPeriodMs) return false;
  if (since >= INTERVAL_MS) return true;
  if (g.lat == null || g.lon == null || g.lastLat == null || g.lastLon == null) return false;
  return (
    haversineM({ lat: g.lastLat, lon: g.lastLon }, { lat: g.lat, lon: g.lon }) >= MOVE_THRESHOLD_M
  );
}

export function staggerTargets(ids: string[]): { id: string; delayMs: number }[] {
  return ids.map((id, i) => ({ id, delayMs: (i + 1) * STAGGER_MS }));
}

/** The seconds between cycles the Status tab shows: the interval unless the
 * floor is longer; null when off. */
export function cadenceSeconds(enabled: boolean, minPeriodMs: number): number | null {
  if (!enabled) return null;
  return Math.ceil(Math.max(INTERVAL_MS, minPeriodMs || 0) / 1000);
}
