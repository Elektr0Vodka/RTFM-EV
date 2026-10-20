import { describe, expect, it } from 'vitest';

import {
  batteryKnown,
  LOW_BATTERY_MV,
  batteryPercent,
  isLowBattery,
} from '../../wardrive/radio/battery';

describe('companion battery', () => {
  it('maps volts like the firmware does', () => {
    expect(batteryPercent(3600)).toBe(50);
    expect(batteryPercent(4300)).toBe(100);
    expect(batteryPercent(2900)).toBe(0);
  });

  it('gives no percentage for a multi-cell pack', () => {
    expect(batteryPercent(7400)).toBeNull();
  });

  it('calls a pack low below the firmware threshold', () => {
    expect(LOW_BATTERY_MV).toBe(3500);
    expect(isLowBattery(3499)).toBe(true);
    expect(isLowBattery(3500)).toBe(false);
    expect(isLowBattery(null)).toBe(false);
  });

  it('treats 0 mV (a board without battery sensing) as unknown, not empty', () => {
    expect(batteryKnown(0)).toBe(false);
    expect(batteryKnown(999)).toBe(false);
    expect(batteryKnown(3000)).toBe(true);
    expect(batteryPercent(0)).toBeNull();
    expect(isLowBattery(0)).toBe(false);
  });
});
