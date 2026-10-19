// What a drive keeps: a reception is stored only with a usable fix, and the
// listening intervals (tracks) are cut every 10 s or 25 m.
import type { Fix, Reception, TrackRow } from './messages';
import type { RadioReception } from './radio/companion';

/** Worst accuracy a fix may have and still place a reception (metres). The
 * same as core-hunter: the stream goes to the same collectors. */
export const MAX_ACCURACY_M = 100;
/** A fix older than this no longer says where the driver is. */
export const MAX_FIX_AGE_MS = 10000;
export const TRACK_INTERVAL_MS = 10000;
export const TRACK_DISTANCE_M = 25;

export function isUsableFix(fix: Fix | null, nowMs: number): fix is Fix {
  if (!fix) return false;
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return false;
  if (Math.abs(fix.lat) > 90 || Math.abs(fix.lon) > 180) return false;
  if (nowMs - fix.at > MAX_FIX_AGE_MS) return false;
  if (fix.accM === null) return true;
  return Number.isFinite(fix.accM) && fix.accM >= 0 && fix.accM <= MAX_ACCURACY_M;
}

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export interface CaptureCounts {
  heard: number;
  stored: number;
  noPosition: number;
}

export class Capture {
  counts: CaptureCounts = { heard: 0, stored: 0, noPosition: 0 };

  onReception(r: RadioReception, fix: Fix | null, nowMs: number): Reception | null {
    this.counts = { ...this.counts, heard: this.counts.heard + 1 };
    if (!isUsableFix(fix, nowMs)) {
      this.counts = { ...this.counts, noPosition: this.counts.noPosition + 1 };
      return null;
    }
    this.counts = { ...this.counts, stored: this.counts.stored + 1 };
    return { rxAt: new Date(nowMs).toISOString(), raw: r.raw, snr: r.snr, rssi: r.rssi, fix };
  }
}

/** The running listening interval. The first usable tick opens it; it is cut
 * every 10 s or 25 m from where it opened. A tick without a usable fix keeps
 * counting; the next placed track carries the count. Unlike core-hunter the
 * opening tick cuts nothing: a zero-length first interval would give the next
 * one the same t0, and RTFM-EV keeps one track per radio and t0. */
export class TrackWindow {
  private startMs: number | null = null;
  private startPos: { lat: number; lon: number } | null = null;
  private rxCount = 0;

  heard(): void {
    this.rxCount++;
  }

  tick(nowMs: number, fix: Fix | null): TrackRow | null {
    if (!isUsableFix(fix, nowMs)) return null;
    if (this.startMs === null || this.startPos === null) {
      this.startMs = nowMs;
      this.startPos = { lat: fix.lat, lon: fix.lon };
      return null;
    }
    const due =
      nowMs - this.startMs >= TRACK_INTERVAL_MS ||
      haversineM(this.startPos, fix) >= TRACK_DISTANCE_M;
    return due ? this.cut(nowMs, fix, true) : null;
  }

  /** Ends the session with a last track marked not listening, so a consumer
   * reads the end of a drive as the end of listening, not as silence. */
  close(nowMs: number, fix: Fix | null): TrackRow | null {
    const open = this.startMs !== null;
    const row = open && isUsableFix(fix, nowMs) ? this.cut(nowMs, fix, false) : null;
    this.startMs = null;
    this.startPos = null;
    this.rxCount = 0;
    return row;
  }

  private cut(nowMs: number, fix: Fix, listening: boolean): TrackRow {
    const row: TrackRow = {
      t0: new Date(this.startMs!).toISOString(),
      t1: new Date(nowMs).toISOString(),
      lat: fix.lat,
      lon: fix.lon,
      accM: fix.accM,
      rxCount: this.rxCount,
      listening,
    };
    this.startMs = nowMs;
    this.startPos = { lat: fix.lat, lon: fix.lon };
    this.rxCount = 0;
    return row;
  }
}
