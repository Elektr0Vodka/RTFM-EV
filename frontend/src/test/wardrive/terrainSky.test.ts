import { describe, expect, it } from 'vitest';

import { SKY_STOPS, skyFor } from '../../wardrive/map/sky';
import {
  DEFAULT_EXAGGERATION,
  EXAGGERATION_STEPS,
  hillshadeFor,
  isDemTileError,
  parseExaggeration,
  terrainPlan,
} from '../../wardrive/map/terrain';

const luma = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('terrain', () => {
  it('offers rx exaggeration steps, 7 by default', () => {
    expect(EXAGGERATION_STEPS).toEqual([1, 2, 4, 7, 10]);
    expect(DEFAULT_EXAGGERATION).toBe(7);
    expect(parseExaggeration('3')).toBe(7);
    expect(parseExaggeration(null)).toBe(7);
    expect(parseExaggeration('10')).toBe(10);
  });

  it('shades with the exaggeration', () => {
    expect(hillshadeFor(7)).toBeCloseTo(0.7);
    expect(hillshadeFor(10)).toBe(1);
    expect(hillshadeFor(0)).toBe(0.1);
  });

  it('draws terrain in 3D only, the mesh once the elevation data is in', () => {
    expect(terrainPlan({ mode3D: false, ready: true, exaggeration: 7 })).toEqual({
      hillshade: false,
      mesh: false,
      exaggeration: 7,
    });
    expect(terrainPlan({ mode3D: true, ready: false, exaggeration: 4 })).toEqual({
      hillshade: true,
      mesh: false,
      exaggeration: 4,
    });
    expect(terrainPlan({ mode3D: true, ready: true, exaggeration: 3 }).mesh).toBe(true);
    expect(terrainPlan({ mode3D: true, ready: true, exaggeration: 3 }).exaggeration).toBe(7);
  });

  it('keeps quiet about elevation tiles that fail', () => {
    expect(isDemTileError({ sourceId: 'wd-dem', tile: {} })).toBe(true);
    expect(isDemTileError({ sourceId: 'wd-dem-shade', tile: {} })).toBe(true);
    expect(isDemTileError({ sourceId: 'wd-dem' })).toBe(false);
    expect(isDemTileError({ sourceId: 'basemap', tile: {} })).toBe(false);
  });
});

describe('sky', () => {
  it('uses the day stop at two in the afternoon', () => {
    const day = SKY_STOPS.find((s) => s.h === 14)!;
    expect(skyFor(14, 'light')).toMatchObject({
      'sky-color': day.sky,
      'horizon-color': day.horizon,
      'fog-color': day.fog,
      'sky-horizon-blend': 0.6,
    });
  });

  it('wraps past midnight', () => {
    expect(skyFor(25, 'light')).toEqual(skyFor(1, 'light'));
    expect(skyFor(-23, 'light')).toEqual(skyFor(1, 'light'));
  });

  it('caps a bright sky over a dark map and leaves the night alone', () => {
    expect(luma(skyFor(14, 'dark')['horizon-color'])).toBeLessThanOrEqual(90.5);
    expect(skyFor(0, 'dark')).toEqual(skyFor(0, 'light'));
  });

  it('blends between stops', () => {
    const c = luma(skyFor(6.25, 'light')['sky-color']);
    const a = luma(SKY_STOPS.find((s) => s.h === 5.5)!.sky);
    const b = luma(SKY_STOPS.find((s) => s.h === 7)!.sky);
    expect(c).toBeGreaterThan(a);
    expect(c).toBeLessThan(b);
  });
});
