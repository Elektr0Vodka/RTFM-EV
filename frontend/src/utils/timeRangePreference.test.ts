import { describe, it, expect, beforeEach } from 'vitest';
import { loadStoredTimeRange, saveStoredTimeRange } from './timeRangePreference';

const KEY = 'test-time-range';

describe('timeRangePreference', () => {
  beforeEach(() => localStorage.clear());

  it('returns the fallback when nothing is stored', () => {
    expect(loadStoredTimeRange(KEY, '10m')).toEqual({
      id: '10m',
      customStart: '',
      customEnd: '',
    });
  });

  it('round-trips a saved selection', () => {
    saveStoredTimeRange(KEY, {
      id: '7d',
      customStart: '2026-09-01T00:00',
      customEnd: '2026-09-02T00:00',
    });
    expect(loadStoredTimeRange(KEY, '10m')).toEqual({
      id: '7d',
      customStart: '2026-09-01T00:00',
      customEnd: '2026-09-02T00:00',
    });
  });

  it('falls back on malformed stored JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadStoredTimeRange(KEY, '30m').id).toBe('30m');
  });

  it('uses the fallback id when the stored blob lacks one', () => {
    localStorage.setItem(KEY, JSON.stringify({ customStart: 'x' }));
    const loaded = loadStoredTimeRange(KEY, '1h');
    expect(loaded.id).toBe('1h');
    expect(loaded.customStart).toBe('x');
  });
});
