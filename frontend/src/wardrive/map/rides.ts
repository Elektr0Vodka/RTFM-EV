// Rides, as rx draws them: a gap of more than ten minutes between successive
// receptions ends one ride and starts the next. What came before the current
// ride is backlog: on the map it is coverage (its hexes) when zoomed out, and
// faint outline circles from zoom 12, so a live reception stands out from what
// was already there.

export const RIDE_GAP_MS = 10 * 60 * 1000;
export const BACKLOG_OUTLINE_ZOOM = 12;

/** Start (ms) of the last ride among these times, null without any. A gap of
 * exactly ten minutes does not split (rx: "more than"). */
export function currentRideStart(times: number[], gapMs = RIDE_GAP_MS): number | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  let start = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > gapMs) start = sorted[i];
  }
  return start;
}

/** Heard before the current ride. Without a known ride nothing is backlog. */
export const isBacklog = (at: number, rideStart: number | null): boolean =>
  rideStart !== null && at < rideStart;

export const showBacklogPoints = (zoom: number): boolean => zoom >= BACKLOG_OUTLINE_ZOOM;
