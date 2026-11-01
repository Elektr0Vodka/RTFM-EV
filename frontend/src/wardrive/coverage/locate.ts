// Locate: where a node probably transmits from, out of where drivers heard it
// and how well. The maths of map.mesh-hunter.eu (core-hunter web/locate.js,
// upstream/master 000bb89), pinned by vectors from running that file: drop
// near-duplicates (10 m cells, the loudest kept), reject points far from the
// median, fit a path-loss model over a refined grid (the weighted centroid
// when the fit cannot run), and an RSSI-weighted density heatmap. The
// arithmetic follows theirs step by step, so the numbers agree to the float.

export interface LocatePoint {
  lat: number;
  lon: number;
  rssi: number | null;
}

export interface LocateStats {
  n: number;
  searchRadiusM: number | null;
  /** Share of the eight compass sectors the points cover. */
  encirclement: number;
}

export interface Heatmap {
  grid: Float32Array;
  rows: number;
  cols: number;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

export interface LocateResult {
  centroid: { lat: number; lon: number; rmsDb?: number } | null;
  method?: 'pathloss' | 'centroid';
  heatmap: Heatmap | null;
  strongest: LocatePoint | null;
  inliers: LocatePoint[];
  outliers: LocatePoint[];
  stats: LocateStats;
}

const R_EARTH_M = 6371000;
const RSSI_CAP = -55;
const OUTLIER_FACTOR = 4;
const MIN_OUTLIER_M = 20000;
const DEFAULT_CELL_M = 10;
const COLS = 64;
const ROWS = 64;
const PATHLOSS_EXPONENT = 2.4;
const PATHLOSS_MIN_D_M = 10;

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Linear power relative to -55 dBm (stronger counts as -55). */
export function rssiWeight(rssi: number | null | undefined): number {
  if (rssi == null || Number.isNaN(rssi)) return 0;
  const clamped = Math.min(rssi, RSSI_CAP);
  return 10 ** ((clamped - RSSI_CAP) / 10);
}

export function weightedCentroid(points: LocatePoint[]): { lat: number; lon: number } | null {
  let sw = 0;
  let slat = 0;
  let slon = 0;
  for (const p of points) {
    const w = rssiWeight(p.rssi);
    sw += w;
    slat += w * p.lat;
    slon += w * p.lon;
  }
  if (sw === 0) return null;
  return { lat: slat / sw, lon: slon / sw };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function densityGrid(points: LocatePoint[]): Heatmap {
  const grid = new Float32Array(ROWS * COLS);
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  const spanM = haversineM({ lat: minLat, lon: minLon }, { lat: maxLat, lon: maxLon });
  const baseSigma = Math.max(spanM * 0.12, 30);
  // Padded by 3 sigma, so the heatmap fades out before its edge.
  const padLat = (3 * baseSigma) / 111320;
  const padLon = (3 * baseSigma) / (111320 * Math.cos((minLat * Math.PI) / 180));
  const bounds = {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLon: minLon - padLon,
    maxLon: maxLon + padLon,
  };
  let peak = 0;
  for (let r = 0; r < ROWS; r++) {
    const lat = bounds.minLat + ((r + 0.5) / ROWS) * (bounds.maxLat - bounds.minLat);
    for (let c = 0; c < COLS; c++) {
      const lon = bounds.minLon + ((c + 0.5) / COLS) * (bounds.maxLon - bounds.minLon);
      let v = 0;
      for (const p of points) {
        const w = rssiWeight(p.rssi);
        if (w === 0) continue;
        const sigma = baseSigma * (1.1 - 0.6 * w); // a strong reception draws tighter
        const d = haversineM({ lat, lon }, p);
        v += w * Math.exp(-(d * d) / (2 * sigma * sigma));
      }
      grid[r * COLS + c] = v;
      if (v > peak) peak = v;
    }
  }
  if (peak > 0) for (let i = 0; i < grid.length; i++) grid[i] /= peak;
  return { grid, rows: ROWS, cols: COLS, bounds };
}

export function geometryStats(
  points: LocatePoint[],
  centroid: { lat: number; lon: number } | null
): LocateStats {
  if (!centroid || !points.length)
    return { n: points.length, searchRadiusM: null, encirclement: 0 };
  let sw = 0;
  let swd2 = 0;
  const sectors = new Array<boolean>(8).fill(false);
  for (const p of points) {
    const w = rssiWeight(p.rssi);
    const d = haversineM(p, centroid);
    sw += w;
    swd2 += w * d * d;
    const ang = Math.atan2(
      (p.lon - centroid.lon) * Math.cos((centroid.lat * Math.PI) / 180),
      p.lat - centroid.lat
    );
    const sector = ((Math.floor((ang + Math.PI) / (Math.PI / 4)) % 8) + 8) % 8;
    sectors[sector] = true;
  }
  const searchRadiusM = sw > 0 ? Math.sqrt(swd2 / sw) : null;
  return { n: points.length, searchRadiusM, encirclement: sectors.filter(Boolean).length / 8 };
}

export function rejectOutliers(points: LocatePoint[]): {
  inliers: LocatePoint[];
  outliers: LocatePoint[];
} {
  if (points.length < 3) return { inliers: points.slice(), outliers: [] };
  const center = { lat: median(points.map((p) => p.lat)), lon: median(points.map((p) => p.lon)) };
  const dists = points.map((p) => haversineM(p, center));
  const threshold = Math.max(OUTLIER_FACTOR * median(dists), MIN_OUTLIER_M);
  const inliers: LocatePoint[] = [];
  const outliers: LocatePoint[] = [];
  points.forEach((p, i) => (dists[i] > threshold ? outliers : inliers).push(p));
  return { inliers, outliers };
}

/** One point per 10 m cell, the loudest: a driver parked by a node counts once. */
export function dedupeSpatial(points: LocatePoint[], cellM = DEFAULT_CELL_M): LocatePoint[] {
  if (points.length < 2) return points.slice();
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((points[0].lat * Math.PI) / 180);
  const best = new Map<string, LocatePoint>();
  for (const p of points) {
    const key = `${Math.round((p.lon * mPerDegLon) / cellM)}:${Math.round((p.lat * mPerDegLat) / cellM)}`;
    const cur = best.get(key);
    if (!cur || (p.rssi ?? -Infinity) > (cur.rssi ?? -Infinity)) best.set(key, p);
  }
  return [...best.values()];
}

function pathlossCost(
  points: { lat: number; lon: number; rssi: number }[],
  lat: number,
  lon: number
) {
  let sum = 0;
  for (const p of points) {
    const d = Math.max(haversineM({ lat, lon }, p), PATHLOSS_MIN_D_M);
    sum += p.rssi + 10 * PATHLOSS_EXPONENT * Math.log10(d);
  }
  const p0 = sum / points.length;
  let err = 0;
  for (const p of points) {
    const d = Math.max(haversineM({ lat, lon }, p), PATHLOSS_MIN_D_M);
    err += (p.rssi + 10 * PATHLOSS_EXPONENT * Math.log10(d) - p0) ** 2;
  }
  return err / points.length;
}

/** The place whose distances explain the signals best under a log-distance
 * path loss (exponent 2.4), found on a 16 x 16 grid refined five times. */
export function pathlossFit(
  points: LocatePoint[]
): { lat: number; lon: number; rmsDb: number } | null {
  const pts = points.filter(
    (p): p is { lat: number; lon: number; rssi: number } =>
      Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.rssi as number)
  );
  if (pts.length < 3) return null;
  const pad = 0.02;
  let loLat = Math.min(...pts.map((p) => p.lat)) - pad;
  let hiLat = Math.max(...pts.map((p) => p.lat)) + pad;
  let loLon = Math.min(...pts.map((p) => p.lon)) - pad * 1.6;
  let hiLon = Math.max(...pts.map((p) => p.lon)) + pad * 1.6;
  let best: { cost: number; lat: number; lon: number } | null = null;
  for (let pass = 0; pass < 5; pass++) {
    const stepLat = (hiLat - loLat) / 16;
    const stepLon = (hiLon - loLon) / 16;
    let round: { cost: number; lat: number; lon: number } | null = null;
    for (let la = loLat; la <= hiLat; la += stepLat) {
      for (let lo = loLon; lo <= hiLon; lo += stepLon) {
        const cost = pathlossCost(pts, la, lo);
        if (!round || cost < round.cost) round = { cost, lat: la, lon: lo };
      }
    }
    if (!round) return null;
    best = round;
    loLat = best.lat - stepLat;
    hiLat = best.lat + stepLat;
    loLon = best.lon - stepLon;
    hiLon = best.lon + stepLon;
  }
  return best ? { lat: best.lat, lon: best.lon, rmsDb: Math.sqrt(best.cost) } : null;
}

export function locate(points: LocatePoint[]): LocateResult {
  const { inliers, outliers } = rejectOutliers(dedupeSpatial(points));
  const strongest = inliers.length
    ? inliers.reduce((a, b) => ((b.rssi ?? -Infinity) > (a.rssi ?? -Infinity) ? b : a))
    : null;
  if (inliers.length < 3) {
    return {
      centroid: null,
      heatmap: null,
      strongest,
      inliers,
      outliers,
      stats: { n: inliers.length, searchRadiusM: null, encirclement: 0 },
    };
  }
  const weighted = weightedCentroid(inliers);
  const fit = pathlossFit(inliers);
  const centroid = fit ?? weighted;
  return {
    centroid,
    method: fit ? 'pathloss' : 'centroid',
    heatmap: densityGrid(inliers),
    strongest,
    inliers,
    outliers,
    stats: geometryStats(inliers, centroid),
  };
}

/** A node's estimate on the node layer: the weighted centroid of the deduped
 * inliers (no path-loss fit), at least three points. */
export function estimateFor(
  points: LocatePoint[]
): { centroid: { lat: number; lon: number }; stats: LocateStats; n: number } | null {
  const { inliers } = rejectOutliers(dedupeSpatial(points));
  if (inliers.length < 3) return null;
  const centroid = weightedCentroid(inliers);
  if (!centroid) return null;
  return { centroid, stats: geometryStats(inliers, centroid), n: inliers.length };
}
