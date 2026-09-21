import { afterEach, describe, expect, it } from 'vitest';

import {
  formatDateTime,
  resolveDateTimeFormat,
  setActiveDateTimeFormat,
} from '../utils/dateTimeFormat';

// A fixed instant: 2026-03-09T14:05:00Z. Using an explicit UTC time and asserting
// against the same via the 'UTC' timeZone keeps the tests timezone-independent.
const INSTANT = Date.UTC(2026, 2, 9, 14, 5, 0);

describe('resolveDateTimeFormat', () => {
  it('12h_mdy forces a 12-hour clock and US date order', () => {
    expect(resolveDateTimeFormat('12h_mdy', 'nl')).toEqual({ hour12: true, locale: 'en-US' });
  });

  it('24h_dmy forces a 24-hour clock and dd/mm date order', () => {
    expect(resolveDateTimeFormat('24h_dmy', 'en')).toEqual({ hour12: false, locale: 'en-GB' });
  });

  it('auto follows the UI language', () => {
    expect(resolveDateTimeFormat('auto', 'en')).toEqual({ hour12: true, locale: 'en-US' });
    expect(resolveDateTimeFormat('auto', 'nl')).toEqual({ hour12: false, locale: 'nl-NL' });
    expect(resolveDateTimeFormat('auto', 'de')).toEqual({ hour12: false, locale: 'de-DE' });
    // Unknown language falls back to the English default.
    expect(resolveDateTimeFormat('auto', 'fr')).toEqual({ hour12: true, locale: 'en-US' });
  });
});

describe('formatDateTime', () => {
  afterEach(() => {
    // Restore the module default so tests do not leak state.
    setActiveDateTimeFormat(resolveDateTimeFormat('auto', 'en'));
  });

  it('uses a 12-hour clock under 12h_mdy', () => {
    setActiveDateTimeFormat(resolveDateTimeFormat('12h_mdy', 'en'));
    const out = formatDateTime(INSTANT, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    expect(out).toMatch(/PM/i);
    expect(out).toContain('02');
  });

  it('uses a 24-hour clock under 24h_dmy', () => {
    setActiveDateTimeFormat(resolveDateTimeFormat('24h_dmy', 'en'));
    const out = formatDateTime(INSTANT, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    expect(out).not.toMatch(/[AP]M/i);
    expect(out).toContain('14');
  });

  it('applies dd/mm date order under 24h_dmy and mm/dd under 12h_mdy', () => {
    const opts: Intl.DateTimeFormatOptions = {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    };
    setActiveDateTimeFormat(resolveDateTimeFormat('24h_dmy', 'en'));
    expect(formatDateTime(INSTANT, opts)).toBe('09/03/2026');
    setActiveDateTimeFormat(resolveDateTimeFormat('12h_mdy', 'en'));
    expect(formatDateTime(INSTANT, opts)).toBe('03/09/2026');
  });

  it('does not inject hour12 when no time field is requested', () => {
    setActiveDateTimeFormat(resolveDateTimeFormat('24h_dmy', 'en'));
    const out = formatDateTime(INSTANT, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    expect(out).not.toMatch(/[AP]M/i);
  });
});
