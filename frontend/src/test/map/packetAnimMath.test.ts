import { describe, it, expect } from 'vitest';
import {
  livenessOpacity,
  pulseProgress,
  pulsePosition,
  glowIntensity,
  snrColor,
  LINK_FRESH_MS,
  LINK_DIM_MS,
  LINK_FLOOR,
  PULSE_MS,
  GLOW_MS,
} from '../../map/packets/packetAnimMath';

describe('livenessOpacity', () => {
  it('is full within the fresh window', () => {
    expect(livenessOpacity(0)).toBe(1);
    expect(livenessOpacity(LINK_FRESH_MS - 1)).toBe(1);
  });
  it('fades to the floor by the dim window and never below', () => {
    expect(livenessOpacity(LINK_DIM_MS)).toBeCloseTo(LINK_FLOOR, 5);
    expect(livenessOpacity(LINK_DIM_MS * 10)).toBe(LINK_FLOOR);
  });
  it('is negative-age safe', () => {
    expect(livenessOpacity(-500)).toBe(1);
  });
});

describe('pulseProgress', () => {
  it('maps elapsed to 0..1 clamped', () => {
    expect(pulseProgress(1000, 1000)).toBe(0);
    expect(pulseProgress(1000, 1000 + PULSE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(pulseProgress(1000, 1000 + PULSE_MS * 2)).toBe(1);
  });
});

describe('pulsePosition', () => {
  it('is the source at t=0 and target at t=1 in lon/lat', () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [10, 10];
    expect(pulsePosition(a, b, 0)).toEqual([0, 0, 0]);
    const end = pulsePosition(a, b, 1);
    expect([end[0], end[1]]).toEqual([10, 10]);
  });
  it('bows upward at the midpoint (height > 0)', () => {
    expect(pulsePosition([0, 0], [10, 0], 0.5)[2]).toBeGreaterThan(0);
  });
});

describe('glowIntensity', () => {
  it('is 1 at receive and 0 after GLOW_MS', () => {
    expect(glowIntensity(0)).toBeCloseTo(1, 5);
    expect(glowIntensity(GLOW_MS)).toBe(0);
    expect(glowIntensity(GLOW_MS + 100)).toBe(0);
  });
});

describe('snrColor', () => {
  it('returns an rgb triple and shifts with snr', () => {
    const lo = snrColor(-20);
    const hi = snrColor(12);
    expect(lo).toHaveLength(3);
    expect(hi).toHaveLength(3);
    expect(lo).not.toEqual(hi);
  });
  it('handles null snr with a neutral color', () => {
    expect(snrColor(null)).toHaveLength(3);
  });
});
