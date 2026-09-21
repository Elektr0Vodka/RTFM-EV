import { describe, it, expect } from 'vitest';
import { bearingDeg, haversineKm, snrColor } from '../components/mynode/radar/signalCore';

describe('bearingDeg', () => {
  it('returns cardinal bearings from an origin', () => {
    expect(Math.round(bearingDeg(0, 0, 1, 0))).toBe(0); // north
    expect(Math.round(bearingDeg(0, 0, 0, 1))).toBe(90); // east
    expect(Math.round(bearingDeg(0, 0, -1, 0))).toBe(180); // south
    expect(Math.round(bearingDeg(0, 0, 0, -1))).toBe(270); // west
  });
});

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(52, 5, 52, 5)).toBeCloseTo(0, 6);
  });
  it('matches a known one-degree-latitude distance (~111 km)', () => {
    expect(haversineKm(0, 0, 1, 0)).toBeGreaterThan(110);
    expect(haversineKm(0, 0, 1, 0)).toBeLessThan(112);
  });
});

describe('snrColor', () => {
  it('clamps low and high SNR to the hue endpoints', () => {
    expect(snrColor(-100)).toBe('hsl(0, 70%, 50%)');
    expect(snrColor(100)).toBe('hsl(120, 70%, 50%)');
  });
  it('treats null as the low endpoint', () => {
    expect(snrColor(null)).toBe('hsl(0, 70%, 50%)');
  });
});
