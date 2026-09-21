import { describe, it, expect } from 'vitest';
import {
  clampZoom,
  radarRange,
  defaultView,
  zoomAt,
  panBy,
  radarTooltipLines,
  RADAR_MAX_ZOOM,
  VIEW_MIN_SCALE,
  VIEW_MAX_SCALE,
} from '../components/mynode/radar/radar';

describe('clampZoom', () => {
  it('floors invalid or sub-1 input to 1', () => {
    expect(clampZoom(undefined as unknown as number)).toBe(1);
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(-3)).toBe(1);
  });
  it('caps at RADAR_MAX_ZOOM', () => {
    expect(RADAR_MAX_ZOOM).toBe(8);
    expect(clampZoom(8)).toBe(8);
    expect(clampZoom(99)).toBe(8);
    expect(clampZoom(3)).toBe(3);
  });
});

describe('radarRange', () => {
  it('keeps the outer ring at dMax at zoom 1 (16x log span)', () => {
    expect(radarRange(32, 1)).toEqual({ dOuter: 32, dMin: 2 });
  });
  it('shrinks the outer distance by the zoom factor', () => {
    expect(radarRange(32, 4)).toEqual({ dOuter: 8, dMin: 0.5 });
  });
  it('guards a non-positive dMax to 1', () => {
    expect(radarRange(0, 1)).toEqual({ dOuter: 1, dMin: 1 / 16 });
  });
});

describe('view transforms', () => {
  it('defaultView is identity', () => {
    expect(defaultView()).toEqual({ scale: 1, panX: 0, panY: 0 });
  });
  it('zoomAt at centre multiplies scale and keeps pan zero', () => {
    expect(zoomAt(defaultView(), 150, 150, 2, 150, 150)).toEqual({
      scale: 2,
      panX: 0,
      panY: 0,
    });
  });
  it('zoomAt keeps the point under the cursor fixed', () => {
    const c0x = 150;
    const c0y = 150;
    const v0 = defaultView();
    const mx = 200;
    const my = 150;
    const bx = (mx - (c0x + v0.panX)) / v0.scale;
    const by = (my - (c0y + v0.panY)) / v0.scale;
    const v = zoomAt(v0, mx, my, 2, c0x, c0y);
    expect(c0x + v.panX + v.scale * bx).toBeCloseTo(mx, 9);
    expect(c0y + v.panY + v.scale * by).toBeCloseTo(my, 9);
  });
  it('zoomAt clamps to [VIEW_MIN_SCALE, VIEW_MAX_SCALE]', () => {
    expect(VIEW_MIN_SCALE).toBe(1);
    expect(VIEW_MAX_SCALE).toBe(12);
    expect(zoomAt(defaultView(), 200, 150, 0.5, 150, 150)).toEqual({
      scale: 1,
      panX: 0,
      panY: 0,
    });
    let v = defaultView();
    for (let i = 0; i < 40; i++) v = zoomAt(v, 150, 150, 2, 150, 150);
    expect(v.scale).toBe(12);
  });
  it('panBy shifts pan by the delta', () => {
    expect(panBy({ scale: 3, panX: 10, panY: -5 }, 4, 6)).toEqual({
      scale: 3,
      panX: 14,
      panY: 1,
    });
  });
});

describe('radarTooltipLines', () => {
  it('shows name, reception stats, and distance/bearing', () => {
    const lines = radarTooltipLines({
      node: { id: 'a', name: 'NodeP', lat: 1, lon: 1, snr: 7, receptions: 2 },
      distKm: 1.2,
      brg: 30,
    }).map((l) => l.text);
    expect(lines[0]).toBe('NodeP');
    expect(lines.some((t) => t.includes('best 7.0 dB'))).toBe(true);
    expect(lines.some((t) => t.includes('2 receptions'))).toBe(true);
    expect(lines.some((t) => t.includes('1.2 km @ 30'))).toBe(true);
  });
  it('omits SNR when unknown and uses singular reception', () => {
    const lines = radarTooltipLines({
      node: { id: 'b', name: 'Q', lat: 1, lon: 1, snr: null, receptions: 1 },
      distKm: 2,
      brg: 90,
    }).map((l) => l.text);
    expect(lines.some((t) => t.includes('dB'))).toBe(false);
    expect(lines.some((t) => t.includes('1 reception') && !t.includes('receptions'))).toBe(true);
  });
});
