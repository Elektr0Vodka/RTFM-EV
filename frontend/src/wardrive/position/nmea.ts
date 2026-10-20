// NMEA 0183 from a USB GPS: GGA (position, fix quality, HDOP) and RMC
// (position, status). Other sentences are ignored.
import type { Fix } from '../messages';

/** Rough horizontal accuracy from HDOP: HDOP x 5 m, a common user range error.
 * An estimate, not a measured 1-sigma like a phone reports. */
export function accuracyFromHdop(hdop: number): number {
  return hdop * 5;
}

function checksumOk(line: string): boolean {
  const star = line.lastIndexOf('*');
  if (star < 0) return true;
  let x = 0;
  for (let i = 1; i < star; i++) x ^= line.charCodeAt(i);
  return (
    line.slice(star + 1, star + 3).toUpperCase() === x.toString(16).toUpperCase().padStart(2, '0')
  );
}

function coord(value: string, hemi: string, degDigits: number): number | null {
  if (!value || value.length < degDigits + 2) return null;
  const deg = Number(value.slice(0, degDigits));
  const min = Number(value.slice(degDigits));
  if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
  const v = deg + min / 60;
  return hemi === 'S' || hemi === 'W' ? -v : v;
}

/** A position (and for GGA an accuracy estimate) from one sentence, or null. */
const KNOT_MPS = 1852 / 3600;

export function parseNmea(line: string): Partial<Fix> | null {
  const text = line.trim();
  if (!text.startsWith('$') || !checksumOk(text)) return null;
  const body = text.split('*')[0];
  const f = body.split(',');
  const type = f[0].slice(3);
  if (type === 'GGA') {
    if (!f[6] || f[6] === '0') return null;
    const lat = coord(f[2], f[3], 2);
    const lon = coord(f[4], f[5], 3);
    if (lat === null || lon === null) return null;
    const hdop = Number(f[8]);
    const fix: Partial<Fix> = { lat, lon };
    if (f[8] && Number.isFinite(hdop)) fix.accM = accuracyFromHdop(hdop);
    return fix;
  }
  if (type === 'RMC') {
    if (f[2] !== 'A') return null;
    const lat = coord(f[3], f[4], 2);
    const lon = coord(f[5], f[6], 3);
    if (lat === null || lon === null) return null;
    const fix: Partial<Fix> = { lat, lon };
    const knots = Number(f[7]);
    if (f[7] && Number.isFinite(knots)) fix.speedMps = knots * KNOT_MPS;
    const course = Number(f[8]);
    if (f[8] && Number.isFinite(course)) fix.headingDeg = course;
    return fix;
  }
  return null;
}

/** Splits a serial text stream into lines. */
export class NmeaLineReader {
  private rest = '';

  push(text: string): string[] {
    this.rest += text;
    const parts = this.rest.split(/\r?\n/);
    this.rest = parts.pop() ?? '';
    return parts.filter((p) => p.length > 0);
  }
}

/** How long an RMC's speed and course still hold for the GGA fixes after it. */
export const RMC_CARRY_MS = 2000;

/** Turns sentences into fixes; an RMC keeps the last GGA accuracy, and a GGA
 * keeps the speed and course of an RMC from the last 2 s. */
export class NmeaFixBuilder {
  private lastAccM: number | null = null;
  private lastMotion: { speedMps?: number | null; headingDeg?: number | null; at: number } | null =
    null;

  line(line: string, nowMs: number): Fix | null {
    const parsed = parseNmea(line);
    if (!parsed || parsed.lat === undefined || parsed.lon === undefined) return null;
    if (parsed.accM !== undefined) this.lastAccM = parsed.accM;
    const fromRmc = parsed.speedMps !== undefined || parsed.headingDeg !== undefined;
    if (fromRmc) {
      this.lastMotion = {
        ...(parsed.speedMps !== undefined ? { speedMps: parsed.speedMps } : {}),
        ...(parsed.headingDeg !== undefined ? { headingDeg: parsed.headingDeg } : {}),
        at: nowMs,
      };
    }
    const carried =
      !fromRmc && this.lastMotion && nowMs - this.lastMotion.at <= RMC_CARRY_MS
        ? this.lastMotion
        : null;
    const speedMps = parsed.speedMps ?? carried?.speedMps;
    const headingDeg = parsed.headingDeg ?? carried?.headingDeg;
    return {
      lat: parsed.lat,
      lon: parsed.lon,
      accM: parsed.accM ?? this.lastAccM,
      at: nowMs,
      ...(speedMps !== undefined ? { speedMps } : {}),
      ...(headingDeg !== undefined ? { headingDeg } : {}),
    };
  }
}
