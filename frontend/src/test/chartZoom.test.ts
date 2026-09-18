import { describe, it, expect } from 'vitest';
import { clampWindow, zoomAtFraction, panByFraction, WHEEL_IN, WHEEL_OUT } from '../lib/chartZoom';

// The math is ported from DutchMeshCore-Observers/web/js/lib/svgchart.js
// (barViewClamp + the bindTimeZoom wheel/drag handlers), generalized from a
// [0,n] index domain to an arbitrary [min,max] domain (unix seconds or index).

describe('clampWindow', () => {
  it('keeps a view within [0,n] and honors a minimum span (reference cases)', () => {
    expect(clampWindow([0, 10], [0, 10], 2)).toEqual([0, 10]); // full range unchanged
    expect(clampWindow([-3, 4], [0, 10], 2)).toEqual([0, 7]); // past 0: shift right, span kept
    expect(clampWindow([7, 14], [0, 10], 2)).toEqual([3, 10]); // past n: shift left, span kept
    expect(clampWindow([5, 5.5], [0, 10], 2)).toEqual([4.25, 6.25]); // sub-min grows around midpoint
    expect(clampWindow([9.5, 10], [0, 10], 2)).toEqual([8, 10]); // min-span growth near edge shifts in
    expect(clampWindow([2, 3], [0, 1], 2)).toEqual([0, 1]); // minSpan > n shrinks to n
  });

  it('works with non-zero-based bounds (time domain in seconds)', () => {
    expect(clampWindow([1000, 2000], [500, 3000], 30)).toEqual([1000, 2000]); // inside, unchanged
    expect(clampWindow([400, 900], [500, 3000], 30)).toEqual([500, 1000]); // past low: shift right
    expect(clampWindow([2800, 3300], [500, 3000], 30)).toEqual([2500, 3000]); // past high: shift left
    expect(clampWindow([0, 5000], [500, 3000], 30)).toEqual([500, 3000]); // wider than full -> full
  });
});

describe('zoomAtFraction', () => {
  it('zooms in toward the cursor, keeping the anchored value fixed', () => {
    // span 10 * 0.8 = 8, cursor at frac 0.5 (value 5) stays centered.
    expect(zoomAtFraction([0, 10], [0, 10], 0.5, WHEEL_IN, 2)).toEqual([1, 9]);
  });

  it('anchors at the left edge without drifting', () => {
    expect(zoomAtFraction([0, 10], [0, 10], 0, WHEEL_IN, 2)).toEqual([0, 8]);
  });

  it('does not zoom past the minimum span', () => {
    // span 2 * 0.8 = 1.6, clamped up to minSpan 2 -> unchanged.
    expect(zoomAtFraction([4, 6], [0, 10], 0.5, WHEEL_IN, 2)).toEqual([4, 6]);
  });

  it('does not zoom out past the full range', () => {
    expect(zoomAtFraction([2, 4], [0, 10], 0.5, WHEEL_OUT, 2)).toEqual([1.75, 4.25]);
    // repeated zoom-out saturates at the full range.
    let v: [number, number] = [0, 10];
    for (let i = 0; i < 5; i++) v = zoomAtFraction(v, [0, 10], 0.5, WHEEL_OUT, 2);
    expect(v).toEqual([0, 10]);
  });

  it('keeps the cursor value fixed across a mid-range zoom (invariance)', () => {
    const full: [number, number] = [0, 100];
    const view: [number, number] = [20, 80];
    const frac = 0.3;
    const before = view[0] + frac * (view[1] - view[0]);
    const next = zoomAtFraction(view, full, frac, WHEEL_IN, 2);
    const after = next[0] + frac * (next[1] - next[0]);
    expect(after).toBeCloseTo(before, 10);
  });
});

describe('panByFraction', () => {
  it('shifts the window by a fraction of its span', () => {
    expect(panByFraction([2, 4], [0, 10], 0.5, 2)).toEqual([3, 5]);
  });

  it('clamps at the bounds while preserving span', () => {
    expect(panByFraction([8, 10], [0, 10], 0.5, 2)).toEqual([8, 10]);
    expect(panByFraction([0, 2], [0, 10], -0.5, 2)).toEqual([0, 2]);
  });
});

describe('wheel factors', () => {
  it('zoom-in shrinks and zoom-out grows the span', () => {
    expect(WHEEL_IN).toBeLessThan(1);
    expect(WHEEL_OUT).toBeGreaterThan(1);
  });
});
