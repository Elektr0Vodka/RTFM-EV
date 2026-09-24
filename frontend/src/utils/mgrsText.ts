// Find MGRS references (e.g. "31U FT 45332 73249") in free text. Mirrors
// app/location_payloads.py so the chat and the map's shared-locations layer
// agree: zone 1-60 + band C-X (no I/O), two 100 km square letters, then equal
// easting/northing halves of 2-5 digits (1 km to 1 m), spaced or compact.
// Upper case only: lower case would also match short hex strings.

import { toPoint } from 'mgrs';

export interface MgrsMatch {
  lat: number;
  lon: number;
  /** Side of the grid square the reference names, in metres. */
  precisionM: number;
  start: number;
  end: number;
  raw: string;
}

const MGRS_PATTERN =
  /(?<![A-Za-z0-9])(\d{1,2})([C-HJ-NP-X])\s?([A-HJ-NP-Z][A-HJ-NP-V])\s?(?:(\d{2,5})\s+(\d{2,5})|(\d{4,10}))(?![A-Za-z0-9])/g;

export function findMgrsReferences(text: string): MgrsMatch[] {
  const out: MgrsMatch[] = [];
  MGRS_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MGRS_PATTERN.exec(text)) !== null) {
    const [raw, zone, band, square, east, north, compact] = m;
    if (Number(zone) < 1 || Number(zone) > 60) continue;
    if (east !== undefined && east.length !== north.length) continue;
    if (compact !== undefined && compact.length % 2 !== 0) continue;
    const digits = compact ?? `${east}${north}`;
    let lon: number;
    let lat: number;
    try {
      [lon, lat] = toPoint(`${zone}${band}${square}${digits}`);
    } catch {
      continue;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -80 || lat > 84 || lon < -180 || lon > 180) continue;
    out.push({
      lat,
      lon,
      precisionM: 100000 / 10 ** (digits.length / 2),
      start: m.index,
      end: m.index + raw.length,
      raw,
    });
  }
  return out;
}
