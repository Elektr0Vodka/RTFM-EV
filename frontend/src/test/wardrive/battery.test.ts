import { describe, expect, it } from 'vitest';

import { LOW_BATTERY_MV, batteryPercent, isLowBattery } from '../../wardrive/radio/battery';

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
});
