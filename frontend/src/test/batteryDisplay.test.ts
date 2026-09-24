import { afterEach, describe, expect, it } from 'vitest';
import {
  mvToPercent,
  formatBatteryLabel,
  setActiveBatteryChemistry,
  getActiveBatteryChemistry,
  DEFAULT_BATTERY_CHEMISTRY,
} from '../utils/batteryDisplay';

afterEach(() => {
  // Tests that change the global default must not leak into other tests.
  setActiveBatteryChemistry(DEFAULT_BATTERY_CHEMISTRY);
});

describe('mvToPercent (lipo, default chemistry, real discharge curve)', () => {
  it('clamps to 100 above table ceiling', () => {
    expect(mvToPercent(4500)).toBe(100);
    expect(mvToPercent(4190)).toBe(100);
  });

  it('clamps to 0 below table floor', () => {
    expect(mvToPercent(3100)).toBe(0);
    expect(mvToPercent(2800)).toBe(0);
  });

  it('returns exact table values at boundaries', () => {
    expect(mvToPercent(4050)).toBe(90);
    expect(mvToPercent(3630)).toBe(40);
  });

  it('interpolates between table entries', () => {
    // Midpoint between 3630 (40%) and 3720 (50%) = 3675 → ~45%
    const mid = mvToPercent(3675);
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThan(50);
  });

  it('defaults to lipo when no chemistry is given and none is active', () => {
    expect(mvToPercent(4190)).toBe(mvToPercent(4190, 'lipo'));
  });
});

// Linear min-max ranges, ported from meshcore-open (lib/utils/battery_utils.dart,
// github.com/zjs81/meshcore-open, fetched and verified 2026-09-23):
// lifepo4 2600-3650mV, lipo_hv 3000-4350mV, nmc 3000-4200mV.
describe('mvToPercent (linear chemistries)', () => {
  it('lifepo4: clamps at 2600-3650mV and is linear at the midpoint', () => {
    expect(mvToPercent(2600, 'lifepo4')).toBe(0);
    expect(mvToPercent(2400, 'lifepo4')).toBe(0);
    expect(mvToPercent(3650, 'lifepo4')).toBe(100);
    expect(mvToPercent(3800, 'lifepo4')).toBe(100);
    expect(mvToPercent(2600 + (3650 - 2600) / 2, 'lifepo4')).toBe(50);
  });

  it('lipo_hv: clamps at 3000-4350mV and is linear at the midpoint', () => {
    expect(mvToPercent(3000, 'lipo_hv')).toBe(0);
    expect(mvToPercent(4350, 'lipo_hv')).toBe(100);
    expect(mvToPercent(3000 + (4350 - 3000) / 2, 'lipo_hv')).toBe(50);
  });

  it('nmc: clamps at 3000-4200mV and is linear at the midpoint', () => {
    expect(mvToPercent(3000, 'nmc')).toBe(0);
    expect(mvToPercent(4200, 'nmc')).toBe(100);
    expect(mvToPercent(3000 + (4200 - 3000) / 2, 'nmc')).toBe(50);
  });

  it('a chemistry override changes the result vs. the lipo curve at the same mV', () => {
    // 3000mV: 0% on the lipo curve (below its 3100mV floor) but mid-scale for
    // the other chemistries, which all start their range at/below 3000mV.
    expect(mvToPercent(3000, 'lipo')).toBe(0);
    expect(mvToPercent(3000, 'lifepo4')).toBeGreaterThan(0);
    expect(mvToPercent(3000, 'lipo_hv')).toBe(0); // 3000 is lipo_hv's floor too
    expect(mvToPercent(3000, 'nmc')).toBe(0); // 3000 is nmc's floor too
  });
});

describe('active global chemistry', () => {
  it('defaults to lipo', () => {
    expect(getActiveBatteryChemistry()).toBe('lipo');
  });

  it('is used when no per-call chemistry is passed', () => {
    setActiveBatteryChemistry('lifepo4');
    expect(getActiveBatteryChemistry()).toBe('lifepo4');
    expect(mvToPercent(3000)).toBe(mvToPercent(3000, 'lifepo4'));
    expect(mvToPercent(3000)).not.toBe(mvToPercent(3000, 'lipo'));
  });

  it('a per-call chemistry overrides the active global default', () => {
    setActiveBatteryChemistry('nmc');
    expect(mvToPercent(3000, 'lipo')).toBe(0);
  });
});

describe('formatBatteryLabel', () => {
  it('returns null when both toggles are off', () => {
    expect(formatBatteryLabel(4050, false, false)).toBeNull();
  });

  it('returns percentage only', () => {
    expect(formatBatteryLabel(4050, true, false)).toBe('90%');
  });

  it('returns voltage only', () => {
    expect(formatBatteryLabel(4050, false, true)).toBe('4050mV');
  });

  it('returns combined when both enabled', () => {
    expect(formatBatteryLabel(4050, true, true)).toBe('90% (4050mV)');
  });

  it('respects a chemistry override', () => {
    expect(formatBatteryLabel(3000, true, false, 'lifepo4')).not.toBe(
      formatBatteryLabel(3000, true, false, 'lipo')
    );
  });
});
