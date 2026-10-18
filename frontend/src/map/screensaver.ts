import type { Map as MlMap } from 'maplibre-gl';

// Map screensaver: after a user-set idle time the camera tilts and moves on its
// own. "orbit" circles one point (the selected node, else the map centre);
// "flyover" glides between heard nodes. Waking restores the saved camera.

export type ScreensaverMode = 'orbit' | 'flyover';
export const SCREENSAVER_MODES: readonly ScreensaverMode[] = ['orbit', 'flyover'];

export const SCREENSAVER_MIN_MINUTES = 1;
export const SCREENSAVER_MAX_MINUTES = 120;
export const SCREENSAVER_DEFAULT_MINUTES = 5;

/** Camera tilt while the screensaver runs (maplibre's default max is 60). */
export const SCREENSAVER_PITCH = 55;
/** Orbit speed: degrees per second (a full circle takes two minutes). */
const ORBIT_DEG_PER_SEC = 3;
/** Each chained orbit segment rotates this far; linear easing keeps it smooth. */
const ORBIT_SEGMENT_DEG = 90;
/** Zoom the flyover arrives at over each node. */
const FLYOVER_ZOOM = 13;
/** Slow circle over a node before flying to the next one. */
const FLYOVER_HOLD_MS = 12_000;
const FLYOVER_HOLD_DEG = 36;
/** The next flyover target is drawn from this many nearest unvisited nodes. */
const FLYOVER_NEAREST = 4;

export type LngLat = [number, number];

export interface CameraState {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

interface PositionedNode {
  lat?: number | null;
  lon?: number | null;
  last_seen?: number | null;
}

/** Positions of nodes this server has actually heard (last_seen set). */
export function flyoverPoints(nodes: readonly PositionedNode[]): LngLat[] {
  const out: LngLat[] = [];
  for (const n of nodes) {
    if (n.last_seen == null) continue;
    if (typeof n.lat !== 'number' || typeof n.lon !== 'number') continue;
    if (!Number.isFinite(n.lat) || !Number.isFinite(n.lon)) continue;
    if (n.lat === 0 && n.lon === 0) continue;
    out.push([n.lon, n.lat]);
  }
  return out;
}

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Initial great-circle bearing from a to b, in degrees [0, 360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Flight time for one leg: slow and cinematic, longer for longer legs. */
export function flyLegDurationMs(km: number): number {
  return Math.round(Math.min(40_000, Math.max(8_000, 6_000 + km * 700)));
}

/**
 * Pick the next node to fly to: a random one among the few nearest nodes not
 * yet visited this round, so the path wanders locally instead of zig-zagging
 * across the whole area. When every node has been visited the round restarts.
 * Returns -1 when there is nowhere else to go.
 */
export function pickNextFlyoverIndex(
  points: readonly LngLat[],
  from: LngLat,
  visited: Set<number>,
  rng: () => number = Math.random
): number {
  if (points.length === 0) return -1;
  const far = (i: number) => distanceKm(from, points[i]) > 0.05;
  let candidates = points.map((_, i) => i).filter((i) => !visited.has(i) && far(i));
  if (candidates.length === 0) {
    visited.clear();
    candidates = points.map((_, i) => i).filter(far);
  }
  if (candidates.length === 0) return -1;
  candidates.sort((a, b) => distanceKm(from, points[a]) - distanceKm(from, points[b]));
  const pool = candidates.slice(0, FLYOVER_NEAREST);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

export function readCamera(map: MlMap): CameraState {
  const c = map.getCenter();
  return {
    center: [c.lng, c.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

const linear = (t: number) => t;

export interface ScreensaverRun {
  stop: () => void;
}

/**
 * Start moving the camera. Each step is a maplibre animation followed by a
 * timer for its duration, so a step never depends on moveend (which other
 * camera calls can also fire). `stop` cancels the timer and the animation; it
 * does not restore the camera (the caller owns the saved view).
 */
export function runScreensaver(
  map: MlMap,
  opts: {
    mode: ScreensaverMode;
    /** Orbit centre override (the selected node), else the map centre. */
    orbitCenter: LngLat | null;
    /** Flyover: fly to this node first, then tour on from there. */
    flyFrom?: LngLat | null;
    /** Read fresh for every flyover leg, so new nodes join the tour. */
    getPoints: () => LngLat[];
    rng?: () => number;
  }
): ScreensaverRun {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const after = (ms: number, fn: () => void) => {
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) fn();
    }, ms);
  };

  const orbitFrom = (center: LngLat) => {
    const intro = 2500;
    map.easeTo({ center, pitch: SCREENSAVER_PITCH, duration: intro, essential: true });
    const spin = () => {
      const duration = (ORBIT_SEGMENT_DEG / ORBIT_DEG_PER_SEC) * 1000;
      map.easeTo({
        center,
        bearing: map.getBearing() + ORBIT_SEGMENT_DEG,
        pitch: SCREENSAVER_PITCH,
        duration,
        easing: linear,
        essential: true,
      });
      after(duration, spin);
    };
    after(intro, spin);
  };

  const visited = new Set<number>();
  let firstStop = opts.flyFrom ?? null;
  const flyLeg = () => {
    const points = opts.getPoints();
    const c = map.getCenter();
    const from: LngLat = [c.lng, c.lat];
    let to: LngLat;
    if (firstStop) {
      to = firstStop;
      const own = points.findIndex((p) => distanceKm(p, to) <= 0.05);
      if (own >= 0) visited.add(own);
      firstStop = null;
    } else {
      const idx = pickNextFlyoverIndex(points, from, visited, opts.rng);
      if (idx < 0) {
        // Fewer than two distinct places: circle the one there is (or the centre).
        orbitFrom(points[0] ?? from);
        return;
      }
      visited.add(idx);
      to = points[idx];
    }
    const heading = bearingDeg(from, to);
    const duration = flyLegDurationMs(distanceKm(from, to));
    map.flyTo({
      center: to,
      zoom: FLYOVER_ZOOM,
      pitch: SCREENSAVER_PITCH,
      bearing: heading,
      duration,
      curve: 1.2,
      essential: true,
    });
    after(duration, () => {
      map.easeTo({
        bearing: heading + FLYOVER_HOLD_DEG,
        pitch: SCREENSAVER_PITCH,
        duration: FLYOVER_HOLD_MS,
        easing: linear,
        essential: true,
      });
      after(FLYOVER_HOLD_MS, flyLeg);
    });
  };

  if (opts.mode === 'flyover') {
    flyLeg();
  } else {
    const c = map.getCenter();
    orbitFrom(opts.orbitCenter ?? [c.lng, c.lat]);
  }

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      map.stop();
    },
  };
}
