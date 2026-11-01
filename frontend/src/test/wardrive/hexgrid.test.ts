// @vitest-environment node
// The wardrive hex cells: CoreScope's grid, checked against the vectors in
// tests/fixtures/wardrive_hex_vectors.json (made by core-hunter's port), the
// same file the backend test reads.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  cellAt,
  cellCenter,
  cellRing,
  hexResForZoom,
  hexSize,
  neighbours,
} from '../../wardrive/map/hexgrid';

interface Vectors {
  points: { name: string; lat: number; lon: number; cells: Record<string, string> }[];
  ring_zwolle_res9_latlon: [number, number][];
}

const VECTORS = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../tests/fixtures/wardrive_hex_vectors.json'), 'utf-8')
) as Vectors;
const R = 6378137;
const merc = (lat: number, lon: number) => [
  (R * lon * Math.PI) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

describe('hex grid', () => {
  it.each(VECTORS.points.map((p) => [p.name, p] as const))(
    'matches the reference at %s',
    (_n, p) => {
      for (const [res, cell] of Object.entries(p.cells))
        expect(cellAt(p.lat, p.lon, +res)).toBe(cell);
    }
  );

  it('puts a cell centre near its points', () => {
    for (const p of VECTORS.points) {
      for (const res of [7, 9, 11]) {
        const c = cellCenter(cellAt(p.lat, p.lon, res))!;
        const [x0, y0] = merc(p.lat, p.lon);
        const [x1, y1] = merc(c.lat, c.lon);
        expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThanOrEqual(hexSize(res));
      }
    }
  });

  it('draws the reference corners as a closed [lon, lat] ring', () => {
    const ring = cellRing(VECTORS.points[0].cells['9'])!;
    expect(ring).toHaveLength(7);
    expect(ring[0]).toEqual(ring[6]);
    ring.forEach(([lon, lat], i) => {
      const [rLat, rLon] = VECTORS.ring_zwolle_res9_latlon[i];
      expect(lat).toBeCloseTo(rLat, 9);
      expect(lon).toBeCloseTo(rLon, 9);
    });
  });

  it('gives six neighbours one step away', () => {
    const cell = cellAt(52.5168, 6.083, 9);
    const near = neighbours(cell);
    expect(new Set(near).size).toBe(6);
    const c = cellCenter(cell)!;
    const [cx, cy] = merc(c.lat, c.lon);
    for (const id of near) {
      const o = cellCenter(id)!;
      const [ox, oy] = merc(o.lat, o.lon);
      expect(Math.hypot(ox - cx, oy - cy) / (Math.sqrt(3) * hexSize(9))).toBeCloseTo(1, 2);
    }
  });

  it('maps zoom to resolution as rx does', () => {
    expect(hexResForZoom(12)).toBe(9);
    expect(hexResForZoom(19.5)).toBe(15);
    expect(hexResForZoom(3)).toBe(6);
    expect(hexResForZoom(15)).toBe(11);
  });

  it.each(['', '9:1', 'x:1:2', '9:1:2:3', '9:a:b'])('gives nothing for %j', (bad) => {
    expect(cellCenter(bad)).toBeNull();
    expect(cellRing(bad)).toBeNull();
    expect(neighbours(bad)).toEqual([]);
  });
});
