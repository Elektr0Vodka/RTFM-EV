import { describe, it, expect } from 'vitest';
import { clampBox, zoomBoxAtPoint, panBox, type ChartBox } from '../lib/chartZoom2d';
import { WHEEL_IN } from '../lib/chartZoom';

// chartZoom2d composes the tested 1-D math (chartZoom.ts) per axis, so these
// tests focus on the two axes being handled independently and correctly.

const FULL: ChartBox = { x: [0, 10], y: [-20, 0] };

describe('clampBox', () => {
  it('clamps each axis into the full box independently', () => {
    expect(clampBox({ x: [-3, 4], y: [-30, -10] }, FULL, 2, 2)).toEqual({
      x: [0, 7], // past low: shift right, span kept
      y: [-20, 0], // wider than full span -> full
    });
  });

  it('leaves an in-bounds box unchanged', () => {
    expect(clampBox({ x: [2, 6], y: [-15, -5] }, FULL, 2, 2)).toEqual({
      x: [2, 6],
      y: [-15, -5],
    });
  });
});

describe('zoomBoxAtPoint', () => {
  it('zooms both axes toward the anchored point, keeping it fixed', () => {
    // x span 10 * 0.8 = 8 anchored at frac 0.5 -> [1,9];
    // y span 20 * 0.8 = 16 anchored at frac 0.5 -> [-18,-2].
    expect(zoomBoxAtPoint(FULL, FULL, 0.5, 0.5, WHEEL_IN, 2, 2)).toEqual({
      x: [1, 9],
      y: [-18, -2],
    });
  });

  it('anchors independently per axis (different fractions)', () => {
    const out = zoomBoxAtPoint(FULL, FULL, 0, 1, WHEEL_IN, 2, 2);
    expect(out.x).toEqual([0, 8]); // left edge anchored
    expect(out.y).toEqual([-16, 0]); // top edge (max y) anchored
  });
});

describe('panBox', () => {
  it('shifts both axes by fractions of their spans and clamps', () => {
    // x: shift +0.1*10 = +1 -> [1,11] clamps to [0,10]? span 10 == full -> full.
    // Use a zoomed-in box so panning is observable.
    const view: ChartBox = { x: [2, 6], y: [-12, -8] };
    const out = panBox(view, FULL, 0.25, -0.5, 2, 2);
    expect(out.x).toEqual([3, 7]); // +0.25 * 4 = +1
    expect(out.y).toEqual([-14, -10]); // -0.5 * 4 = -2
  });

  it('does not pan past the full box', () => {
    const view: ChartBox = { x: [8, 10], y: [-4, 0] };
    const out = panBox(view, FULL, 1, 1, 2, 2);
    expect(out.x).toEqual([8, 10]); // already at right edge
    expect(out.y).toEqual([-4, 0]); // already at top edge
  });
});
