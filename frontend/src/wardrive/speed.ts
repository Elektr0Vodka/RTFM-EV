// Speed for the HUD: what the position source reports (phone, or the RMC
// sentence of a USB GPS), else worked out from two fixes. Display only: the
// collectors get no speed.
import { haversineM } from './capture';
import type { Fix } from './messages';
import type { DistanceUnit } from '../utils/distanceUnits';

/** Older than this, a fix says nothing about the speed now. */
const MAX_AGE_MS = 10000;
/** Fixes closer in time than this give a jumpy derived speed. */
const MIN_SPAN_MS = 2000;

export class SpeedTracker {
  private last: Fix | null = null;
  private derived: number | null = null;
  private latest: Fix | null = null;

  push(fix: Fix): void {
    if (this.last && fix.at - this.last.at >= MIN_SPAN_MS) {
      this.derived = haversineM(this.last, fix) / ((fix.at - this.last.at) / 1000);
      this.last = fix;
    } else if (!this.last) {
      this.last = fix;
      this.derived = null;
    }
    this.latest = fix;
  }

  speedMps(nowMs: number): number | null {
    const f = this.latest;
    if (!f || nowMs - f.at > MAX_AGE_MS) return null;
    if (typeof f.speedMps === 'number' && Number.isFinite(f.speedMps)) return f.speedMps;
    return this.derived;
  }
}

export function formatSpeed(mps: number | null, unit: DistanceUnit): string {
  if (mps === null || !Number.isFinite(mps)) return '-';
  return unit === 'imperial'
    ? `${Math.round(mps * 2.236936)} mph`
    : `${Math.round(mps * 3.6)} km/h`;
}
