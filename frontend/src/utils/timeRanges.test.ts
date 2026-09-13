import { describe, it, expect } from 'vitest';
import { BASE_TIME_RANGES, CUSTOM_RANGE_ID, resolveRange, type TimeRange } from './timeRanges';

describe('timeRanges', () => {
  it('has the 11 base ranges in order', () => {
    expect(BASE_TIME_RANGES.map((r) => r.id)).toEqual([
      '20m',
      '1h',
      '3h',
      '6h',
      '12h',
      '24h',
      '48h',
      '3d',
      '7d',
      '14d',
      '30d',
    ]);
  });

  it('resolves a base id to now - seconds .. now', () => {
    const now = 1_000_000;
    expect(resolveRange('1h', { nowSec: now })).toEqual({ startTs: now - 3600, endTs: now });
    expect(resolveRange('48h', { nowSec: now })).toEqual({ startTs: now - 172800, endTs: now });
  });

  it('resolves custom from provided seconds', () => {
    expect(resolveRange(CUSTOM_RANGE_ID, { customStartSec: 100, customEndSec: 200 })).toEqual({
      startTs: 100,
      endTs: 200,
    });
  });

  it('returns null for custom without both bounds', () => {
    expect(resolveRange(CUSTOM_RANGE_ID, { customStartSec: 100 })).toBeNull();
  });

  it('resolves an extra with null seconds (All) to startTs 0', () => {
    const extras: TimeRange[] = [{ id: 'all', labelKey: 'x', seconds: null }];
    expect(resolveRange('all', { nowSec: 500, extras })).toEqual({ startTs: 0, endTs: 500 });
  });

  it('returns null for an unknown id', () => {
    expect(resolveRange('nope', { nowSec: 1 })).toBeNull();
  });
});
