import { describe, it, expect } from 'vitest';
import { formatNumber } from '../utils/localeFormat';

describe('formatNumber', () => {
  it('uses locale-specific grouping', () => {
    expect(formatNumber('en', 1234567)).toBe('1,234,567');
    expect(formatNumber('de', 1234567)).toBe('1.234.567');
    // nl uses a dot as thousands separator too
    expect(formatNumber('nl', 1234567)).toBe('1.234.567');
  });
});
