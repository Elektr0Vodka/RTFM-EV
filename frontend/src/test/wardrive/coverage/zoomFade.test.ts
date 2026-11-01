import { describe, expect, it } from 'vitest';

import {
  cellOpacityExpr,
  barOpacityExpr,
  cellSizes,
  hexShare,
  pointOpacityExpr,
  pointShare,
  sizeShare,
} from '../../../wardrive/coverage/zoomFade';

describe('what each layer mode shows by zoom', () => {
  it('fades points in over zoom 13.25 to 18.25 in Auto, flat', () => {
    expect(pointShare(12, 'auto', false)).toBe(0);
    expect(pointShare(13.25, 'auto', false)).toBe(0);
    expect(pointShare(15.75, 'auto', false)).toBeCloseTo(0.5);
    expect(pointShare(18.25, 'auto', false)).toBe(1);
  });

  it('stands points up from zoom 19 in Auto, 3D', () => {
    expect(pointShare(18.9, 'auto', true)).toBe(0);
    expect(pointShare(19, 'auto', true)).toBe(1);
  });

  it('keeps Points and Hex fixed', () => {
    expect(pointShare(5, 'points', false)).toBe(1);
    expect(pointShare(20, 'hex', true)).toBe(0);
    expect(hexShare(20, 'points', false)).toBe(0);
    expect(hexShare(20, 'hex', true)).toBe(1);
  });

  it('lowers the cells under the pillars in Auto, 3D', () => {
    expect(hexShare(18, 'auto', true)).toBe(1);
    expect(hexShare(19, 'auto', true)).toBe(0.95);
  });
});

describe('two cell sizes blend around each size change', () => {
  it('shows the current size and its nearest neighbour, even sizes in slot a', () => {
    // hexResForZoom: 9 from zoom 11, 10 from zoom 13.
    expect(cellSizes(12.9)).toEqual({ a: 10, b: 9 });
    expect(cellSizes(11.2)).toEqual({ a: 8, b: 9 });
    expect(cellSizes(3)).toEqual({ a: 6, b: 7 });
    expect(cellSizes(20)).toEqual({ a: 14, b: 15 });
  });

  it('hands over from one size to the next across the step', () => {
    for (const z of [12.4, 12.6, 12.8, 13, 13.2, 13.4]) {
      expect(sizeShare(9, z, false) + sizeShare(10, z, false)).toBeCloseTo(1);
    }
    expect(sizeShare(9, 12, false)).toBe(1);
    expect(sizeShare(10, 14, false)).toBe(1);
    expect(sizeShare(10, 12, false)).toBe(0);
  });

  it('never fades out the coarsest or the finest size at the ends', () => {
    expect(sizeShare(6, 0, false)).toBe(1);
    expect(sizeShare(15, 22, true)).toBe(1);
  });
});

describe('MapLibre expressions', () => {
  it('ramps the point opacity by zoom in Auto, flat', () => {
    const expr = pointOpacityExpr('auto', false) as unknown[];
    expect(expr.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    const stops = expr.slice(3).filter((_, i) => i % 2 === 0) as number[];
    expect(stops).toEqual([...stops].sort((a, b) => a - b));
    expect(stops[0]).toBe(13.25);
  });

  it('is the plain feature opacity outside Auto', () => {
    expect(pointOpacityExpr('points', false)).toEqual(['get', 'op']);
  });

  it('gives each cell size an opacity ramp over its own zooms', () => {
    const expr = cellOpacityExpr(10, 'hex', false) as unknown[];
    expect(expr[0]).toBe('interpolate');
    const stops = expr.slice(3).filter((_, i) => i % 2 === 0) as number[];
    expect(stops).toEqual([...stops].sort((a, b) => a - b));
    expect(Math.min(...stops)).toBeCloseTo(12.525);
  });

  it('ramps the 3D bars of a size with plain numbers (no feature values in extrusion opacity)', () => {
    const expr = barOpacityExpr(10, 'hex') as unknown[];
    expect(expr.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    const values = expr.slice(3).filter((_, i) => i % 2 === 1);
    expect(values.every((v) => typeof v === 'number')).toBe(true);
    expect(Math.max(...(values as number[]))).toBeCloseTo(0.75);
    expect(Math.min(...(values as number[]))).toBe(0);
  });
});
