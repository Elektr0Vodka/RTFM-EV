// The warmer / colder cue on the HUD: is the shown sender getting stronger?
// The median of its last three readings against the median of the three
// before, so one lucky or unlucky packet does not flip it. Readings stop at a
// long silence, so an earlier walk is not compared with this one.
import type { LiveEntry } from './liveLog';

export type TrendDir = 'warmer' | 'colder' | 'steady';

export interface SignalTrend {
  dir: TrendDir;
  /** Recent median minus the earlier median, whole dB. */
  deltaDb: number;
}

type Reading = Pick<LiveEntry, 'id' | 'at' | 'rssi' | 'sender'>;

export const TREND_WINDOW = 3;
/** A change smaller than this is steady. */
export const TREND_STEADY_DB = 3;
/** A longer silence between two readings ends the series. */
export const TREND_MAX_GAP_MS = 600_000;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Newest first: by time, then by id for copies heard at the same moment. */
function newerFirst(a: Reading, b: Reading): number {
  return b.at - a.at || b.id - a.id;
}

/** The trend of `shown`'s sender up to `shown`, or null with too few readings. */
export function signalTrend(shown: Reading | null, entries: Reading[]): SignalTrend | null {
  const id = shown?.sender.id?.toLowerCase();
  if (!shown || !id) return null;
  const readings = entries
    .filter(
      (e) =>
        e.sender.id?.toLowerCase() === id &&
        e.rssi !== null &&
        Number.isFinite(e.rssi) &&
        newerFirst(shown, e) <= 0
    )
    .sort(newerFirst);
  const need = TREND_WINDOW * 2;
  const kept: number[] = [];
  for (let i = 0; i < readings.length && kept.length < need; i++) {
    if (i > 0 && readings[i - 1].at - readings[i].at > TREND_MAX_GAP_MS) break;
    kept.push(readings[i].rssi as number);
  }
  if (kept.length < need) return null;
  const deltaDb = Math.round(
    median(kept.slice(0, TREND_WINDOW)) - median(kept.slice(TREND_WINDOW, need))
  );
  const dir: TrendDir =
    Math.abs(deltaDb) < TREND_STEADY_DB ? 'steady' : deltaDb > 0 ? 'warmer' : 'colder';
  return { dir, deltaDb };
}
