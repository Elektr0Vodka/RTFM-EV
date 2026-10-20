// The direction arrow: from the driver toward the node that was heard, turned
// by the way the driver faces. The node's place is its advertised position
// when the directory has exactly one, else an estimate from where the driver
// heard it. Heading: the compass when slow, the GPS course from 2 m/s (rx's
// rule), so the arrow does not spin at a standstill.
import { isUsableFix } from './capture';
import type { Sender } from './decode/reception';
import type { Fix } from './messages';
import { distanceKm, type Attribution, type NodeDirectory } from './names';

const RAD = Math.PI / 180;

/** Initial great-circle bearing, 0 to 360 degrees from north. */
export function bearingDeg(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): number {
  const p1 = from.lat * RAD;
  const p2 = to.lat * RAD;
  const dl = (to.lon - from.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** The bearing as seen from the heading, in (-180, 180]. */
export function relativeAngle(bearing: number, heading: number): number {
  const d = ((((bearing - heading) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

export const COURSE_MIN_SPEED_MS = 2;
export const COURSE_RELEASE_SPEED_MS = 1;
export type HeadingSource = 'compass' | 'course';

/** Course from 2 m/s, compass below 1 m/s; in between, or without a speed,
 * the source stays as it is. */
export function nextHeadingSource(current: HeadingSource, speedMps: number | null): HeadingSource {
  if (speedMps === null || !Number.isFinite(speedMps)) return current;
  if (speedMps >= COURSE_MIN_SPEED_MS) return 'course';
  if (speedMps < COURSE_RELEASE_SPEED_MS) return 'compass';
  return current;
}

export const COMPASS_STALE_MS = 2000;

export function headingFor(
  src: HeadingSource,
  course: number | null,
  compass: { deg: number; at: number } | null,
  nowMs: number
): number | null {
  if (src === 'course') return course !== null && Number.isFinite(course) ? course : null;
  if (!compass || nowMs - compass.at > COMPASS_STALE_MS || !Number.isFinite(compass.deg)) {
    return null;
  }
  return compass.deg;
}

/** The fix's course while moving fast enough to trust it, else the last one. */
export function courseHeading(
  fixHeading: number | null,
  last: number | null,
  speedMps: number | null
): number | null {
  const moving = speedMps !== null && speedMps >= COURSE_MIN_SPEED_MS;
  return moving && fixHeading !== null && Number.isFinite(fixHeading) ? fixHeading : last;
}

const CELL_M = 10;
const MIN_POINTS = 3;
const OUTLIER_FACTOR = 4;
const OUTLIER_FLOOR_KM = 20;
const WEIGHT_CEILING_DBM = -55;
const NO_SIGNAL_DBM = -130;
const M_PER_DEG = 111320;

type Heard = { lat: number; lon: number; rssi: number | null };

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Where a node probably is, from where it was heard: the strongest point per
 * 10 m cell, far outliers dropped, the rest averaged with stronger signals
 * weighing more. Null with fewer than 3 places. */
export function estimateFor(
  points: { lat: number | null; lon: number | null; rssi: number | null }[]
): { lat: number; lon: number } | null {
  const placed = points.filter(
    (p): p is Heard =>
      p.lat !== null && p.lon !== null && Number.isFinite(p.lat) && Number.isFinite(p.lon)
  );
  if (placed.length < MIN_POINTS) return null;
  const origin = placed[0];
  const cosLat = Math.cos(origin.lat * RAD);
  const cells = new Map<string, Heard>();
  for (const p of placed) {
    const x = Math.round(((p.lon - origin.lon) * M_PER_DEG * cosLat) / CELL_M);
    const y = Math.round(((p.lat - origin.lat) * M_PER_DEG) / CELL_M);
    const k = `${x}:${y}`;
    const had = cells.get(k);
    if (!had || (p.rssi ?? NO_SIGNAL_DBM) > (had.rssi ?? NO_SIGNAL_DBM)) cells.set(k, p);
  }
  const kept = [...cells.values()];
  if (kept.length < MIN_POINTS) return null;
  const mid = { lat: median(kept.map((p) => p.lat)), lon: median(kept.map((p) => p.lon)) };
  const dists = kept.map((p) => distanceKm(mid, p));
  const limit = Math.max(OUTLIER_FACTOR * median(dists), OUTLIER_FLOOR_KM);
  const near = kept.filter((_, i) => dists[i] <= limit);
  if (near.length < MIN_POINTS) return null;
  let wSum = 0;
  let lat = 0;
  let lon = 0;
  for (const p of near) {
    const rssi = Math.min(p.rssi ?? NO_SIGNAL_DBM, WEIGHT_CEILING_DBM);
    const w = 10 ** ((rssi - WEIGHT_CEILING_DBM) / 10);
    wSum += w;
    lat += p.lat * w;
    lon += p.lon * w;
  }
  return { lat: lat / wSum, lon: lon / wSum };
}

export interface ArrowTarget {
  lat: number;
  lon: number;
  kind: 'advertised' | 'estimate';
}

const KEY_KINDS = new Set<Sender['kind']>(['advert_pubkey', 'discover_pubkey']);
const MIN_KEY_PREFIX_HEX = 4;

/** Where the arrow points for this sender, or null when nowhere sensible. */
export function arrowTarget(
  sender: Sender,
  attr: Attribution | null,
  dir: NodeDirectory,
  sameSender: { lat: number | null; lon: number | null; rssi: number | null }[]
): ArrowTarget | null {
  if (!sender.kind || sender.kind === 'channel_name') return null;
  if (attr?.rule === 'collision') return null;
  if (attr?.rule === 'node' && attr.node.lat !== null && attr.node.lon !== null) {
    return { lat: attr.node.lat, lon: attr.node.lon, kind: 'advertised' };
  }
  const id = sender.id ?? '';
  if (KEY_KINDS.has(sender.kind) && id.length >= MIN_KEY_PREFIX_HEX) {
    const matches = dir.positionedWithPrefix(id);
    if (matches.length === 1) {
      return { lat: matches[0].lat as number, lon: matches[0].lon as number, kind: 'advertised' };
    }
  }
  const est = estimateFor(sameSender);
  return est ? { ...est, kind: 'estimate' } : null;
}

/** The arrow's angle on screen (0 is straight ahead), or null without a
 * target, a usable fix or a heading. */
export function arrowFor(
  target: ArrowTarget | null,
  fix: Fix | null,
  heading: number | null,
  nowMs: number
): { angle: number; kind: ArrowTarget['kind'] } | null {
  if (!target || heading === null || !Number.isFinite(heading)) return null;
  if (!isUsableFix(fix, nowMs)) return null;
  const angle = relativeAngle(bearingDeg(fix, target), heading);
  return Number.isFinite(angle) ? { angle, kind: target.kind } : null;
}
