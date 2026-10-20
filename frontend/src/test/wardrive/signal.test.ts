import { describe, expect, it } from 'vitest';

import { rssiColor } from '../../wardrive/map/geo';
import { parseAttenuator, plotOffset, rssiTier, tierColor } from '../../wardrive/signal';

describe('wardrive signal tiers', () => {
  it('uses the RX app bands', () => {
    expect(rssiTier(-70)).toBe('hot');
    expect(rssiTier(-80)).toBe('hot');
    expect(rssiTier(-80.5)).toBe('warm');
    expect(rssiTier(-95)).toBe('mid');
    expect(rssiTier(-105)).toBe('cool');
    expect(rssiTier(-115)).toBe('cold');
    expect(rssiTier(-116)).toBe('faint');
    expect(rssiTier(null)).toBe('none');
    expect(rssiTier(Number.NaN)).toBe('none');
  });

  it('plots with the calibration and the attenuator added back', () => {
    expect(plotOffset(5, -20)).toBe(25);
    expect(plotOffset(0, 0)).toBe(0);
    expect(rssiTier(-95, 20)).toBe('hot');
    expect(rssiTier(-150, 30)).toBe('faint');
    expect(rssiTier(null, 30)).toBe('none');
  });

  it('reads a stored attenuator, anything else is none', () => {
    expect(parseAttenuator('-20')).toBe(-20);
    expect(parseAttenuator('5')).toBe(0);
    expect(parseAttenuator(null)).toBe(0);
  });

  it('has a colourblind ramp next to the normal one', () => {
    expect(tierColor('hot', false)).toBe('#ef4444');
    expect(tierColor('hot', true)).not.toBe(tierColor('hot', false));
    expect(tierColor('none', true)).toBe(tierColor('none', false));
  });

  it('colours the coverage map with the same tiers', () => {
    expect(rssiColor(-112)).toBe(tierColor('cold', false));
    expect(rssiColor(-120)).toBe(tierColor('faint', false));
  });
});
