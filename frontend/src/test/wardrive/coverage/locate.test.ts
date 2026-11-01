// Locate against vectors from running map.mesh-hunter.eu's own locate.js
// (core-hunter upstream/master 000bb89 web/locate.js; generator in the
// coverage map ledger).
import { describe, expect, it } from 'vitest';

import {
  locate,
  rssiWeight,
  type Heatmap,
  type LocatePoint,
} from '../../../wardrive/coverage/locate';
import vectors from './locateVectors.json';

interface Vector {
  points: LocatePoint[];
  centroid: { lat: number; lon: number; rmsDb?: number } | null;
  method: string | null;
  strongest: LocatePoint | null;
  inliers: number;
  outliers: number;
  stats: { n: number; searchRadiusM: number | null; encirclement: number };
  heat: {
    rows: number;
    cols: number;
    bounds: Record<string, number>;
    samples: number[];
    peakAt: number;
  } | null;
}

const CASES = Object.entries(vectors).filter(([k]) => k !== 'rssiWeight') as [string, Vector][];

describe('Locate, as map.mesh-hunter.eu computes it', () => {
  it.each(CASES)('%s', (_name, v) => {
    const r = locate(v.points);
    expect(r.method ?? null).toBe(v.method);
    expect(r.inliers.length).toBe(v.inliers);
    expect(r.outliers.length).toBe(v.outliers);
    expect(r.strongest).toEqual(v.strongest);
    expect(r.stats.n).toBe(v.stats.n);
    expect(r.stats.encirclement).toBe(v.stats.encirclement);
    if (v.stats.searchRadiusM === null) expect(r.stats.searchRadiusM).toBeNull();
    else expect(r.stats.searchRadiusM).toBeCloseTo(v.stats.searchRadiusM, 6);
    if (v.centroid === null) {
      expect(r.centroid).toBeNull();
    } else {
      expect(r.centroid!.lat).toBeCloseTo(v.centroid.lat, 9);
      expect(r.centroid!.lon).toBeCloseTo(v.centroid.lon, 9);
    }
    if (v.heat === null) {
      expect(r.heatmap).toBeNull();
    } else {
      expect(r.heatmap!.rows).toBe(v.heat.rows);
      expect(r.heatmap!.cols).toBe(v.heat.cols);
      for (const [k, val] of Object.entries(v.heat.bounds)) {
        expect(r.heatmap!.bounds[k as keyof Heatmap['bounds']]).toBeCloseTo(val, 9);
      }
      const at = [0, 100, 1000, 2080, 4095];
      at.forEach((i, j) => expect(r.heatmap!.grid[i]).toBeCloseTo(v.heat!.samples[j], 5));
      expect(Array.from(r.heatmap!.grid).indexOf(1)).toBe(v.heat.peakAt);
    }
  });

  it('weighs signal in linear power, capped at -55 dBm', () => {
    const got = [-120, -100, -80, -55, -40, null].map((x) => rssiWeight(x));
    got.forEach((g, i) => expect(g).toBeCloseTo(vectors.rssiWeight[i], 12));
  });
});
