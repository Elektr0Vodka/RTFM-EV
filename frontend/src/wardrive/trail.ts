// Where this drive went: one point every 5 m of movement, kept in memory for
// this page load (display only).
import { haversineM } from './capture';
import type { Fix } from './messages';

const MIN_STEP_M = 5;

export class Trail {
  private pts: [number, number][] = [];

  /** True when the fix was far enough from the last point to be added. */
  push(fix: Fix): boolean {
    const last = this.pts[this.pts.length - 1];
    if (last && haversineM({ lat: last[1], lon: last[0] }, fix) < MIN_STEP_M) return false;
    this.pts = [...this.pts, [fix.lon, fix.lat]];
    return true;
  }

  /** [lon, lat] pairs, oldest first. */
  points(): [number, number][] {
    return this.pts;
  }

  clear(): void {
    this.pts = [];
  }
}
