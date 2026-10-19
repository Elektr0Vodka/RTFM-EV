import { describe, expect, it } from 'vitest';

import { rssiColor } from '../../wardrive/map/geo';
import { rssiTier, tierColor } from '../../wardrive/signal';

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
