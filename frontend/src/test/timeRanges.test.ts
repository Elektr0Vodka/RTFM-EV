import { describe, it, expect } from 'vitest';

import { ALL_TIME_RANGE, CUSTOM_RANGE_ID, resolveRange } from '../utils/timeRanges';

describe('resolveRange', () => {
  const nowSec = 1_000_000;

  it('resolves a fixed-length preset to [now - seconds, now]', () => {
    expect(resolveRange('24h', { nowSec })).toEqual({
      startTs: nowSec - 24 * 60 * 60,
      endTs: nowSec,
    });
  });

  it('resolves the "All time" extra to [0, now] (no lower bound)', () => {
    expect(resolveRange(ALL_TIME_RANGE.id, { nowSec, extras: [ALL_TIME_RANGE] })).toEqual({
      startTs: 0,
      endTs: nowSec,
    });
  });

  it('returns null for an unknown id (extra not provided)', () => {
    expect(resolveRange(ALL_TIME_RANGE.id, { nowSec })).toBeNull();
  });

  it('resolves a custom range from its explicit bounds', () => {
    expect(resolveRange(CUSTOM_RANGE_ID, { nowSec, customStartSec: 10, customEndSec: 20 })).toEqual(
      { startTs: 10, endTs: 20 }
    );
  });
});
