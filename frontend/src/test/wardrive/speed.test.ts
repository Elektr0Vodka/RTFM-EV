import { describe, expect, it } from 'vitest';

import type { Fix } from '../../wardrive/messages';
import { SpeedTracker, formatSpeed } from '../../wardrive/speed';

const NOW = 1_800_000_000_000;
// 0.0009 degrees of latitude is about 100 m.
const fix = (at: number, lat = 52, extra: Partial<Fix> = {}): Fix => ({
  lat,
  lon: 5,
  accM: 5,
  at,
  ...extra,
});

describe('wardrive speed', () => {
  it('derives speed from two fixes', () => {
    const t = new SpeedTracker();
    t.push(fix(NOW - 10000, 52));
    t.push(fix(NOW, 52.0009));
    expect(t.speedMps(NOW)).toBeCloseTo(10, 0);
  });

  it('prefers the speed the source reports', () => {
    const t = new SpeedTracker();
    t.push(fix(NOW - 10000, 52));
    t.push(fix(NOW, 52.0009, { speedMps: 5 }));
    expect(t.speedMps(NOW)).toBe(5);
  });

  it('ignores fixes less than 2 s apart when deriving', () => {
    const t = new SpeedTracker();
    t.push(fix(NOW - 1000, 52));
    t.push(fix(NOW, 52.0009));
    expect(t.speedMps(NOW)).toBeNull();
  });

  it('has no speed without a fresh fix', () => {
    const t = new SpeedTracker();
    expect(t.speedMps(NOW)).toBeNull();
    t.push(fix(NOW - 11000, 52, { speedMps: 5 }));
    expect(t.speedMps(NOW)).toBeNull();
  });

  it('formats in the chosen unit', () => {
    expect(formatSpeed(10, 'metric')).toBe('36 km/h');
    expect(formatSpeed(10, 'imperial')).toBe('22 mph');
    expect(formatSpeed(10, 'smoots')).toBe('36 km/h');
    expect(formatSpeed(null, 'metric')).toBe('-');
  });
});
