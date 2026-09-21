import { afterEach, describe, expect, it } from 'vitest';

import { formatFieldDisplay, fieldPlaceholder, parseFieldDisplay } from '../utils/dateFieldFormat';
import { resolveDateTimeFormat, setActiveDateTimeFormat } from '../utils/dateTimeFormat';

function useFormat(pref: '12h_mdy' | '24h_dmy' | 'auto', locale = 'en') {
  setActiveDateTimeFormat(resolveDateTimeFormat(pref, locale));
}

afterEach(() => {
  setActiveDateTimeFormat(resolveDateTimeFormat('auto', 'en'));
});

describe('formatFieldDisplay', () => {
  it('date: dd/mm/yyyy under 24h_dmy, mm/dd/yyyy under 12h_mdy', () => {
    useFormat('24h_dmy');
    expect(formatFieldDisplay('2026-09-21', 'date')).toBe('21/09/2026');
    useFormat('12h_mdy');
    expect(formatFieldDisplay('2026-09-21', 'date')).toBe('09/21/2026');
  });

  it('datetime: 24-hour clock under 24h_dmy', () => {
    useFormat('24h_dmy');
    expect(formatFieldDisplay('2026-09-21T14:05', 'datetime')).toBe('21/09/2026 14:05');
  });

  it('datetime: 12-hour clock with AM/PM under 12h_mdy', () => {
    useFormat('12h_mdy');
    expect(formatFieldDisplay('2026-09-21T14:05', 'datetime')).toBe('09/21/2026 02:05 PM');
    expect(formatFieldDisplay('2026-09-21T00:30', 'datetime')).toBe('09/21/2026 12:30 AM');
  });

  it('returns empty string for blank/invalid input', () => {
    expect(formatFieldDisplay('', 'date')).toBe('');
    expect(formatFieldDisplay('not-a-date', 'date')).toBe('');
  });
});

describe('fieldPlaceholder', () => {
  it('reflects the active format', () => {
    useFormat('24h_dmy');
    expect(fieldPlaceholder('date')).toBe('dd/mm/yyyy');
    expect(fieldPlaceholder('datetime')).toBe('dd/mm/yyyy HH:mm');
    useFormat('12h_mdy');
    expect(fieldPlaceholder('date')).toBe('mm/dd/yyyy');
    expect(fieldPlaceholder('datetime')).toBe('mm/dd/yyyy hh:mm AM');
  });
});

describe('parseFieldDisplay', () => {
  it('parses dd/mm/yyyy under 24h_dmy back to native YYYY-MM-DD', () => {
    useFormat('24h_dmy');
    expect(parseFieldDisplay('21/09/2026', 'date')).toBe('2026-09-21');
  });

  it('parses mm/dd/yyyy under 12h_mdy', () => {
    useFormat('12h_mdy');
    expect(parseFieldDisplay('09/21/2026', 'date')).toBe('2026-09-21');
  });

  it('parses datetime with 24h and with AM/PM', () => {
    useFormat('24h_dmy');
    expect(parseFieldDisplay('21/09/2026 14:05', 'datetime')).toBe('2026-09-21T14:05');
    useFormat('12h_mdy');
    expect(parseFieldDisplay('09/21/2026 02:05 PM', 'datetime')).toBe('2026-09-21T14:05');
    expect(parseFieldDisplay('09/21/2026 12:30 AM', 'datetime')).toBe('2026-09-21T00:30');
  });

  it('accepts - and . separators and 2-digit years', () => {
    useFormat('24h_dmy');
    expect(parseFieldDisplay('21-09-2026', 'date')).toBe('2026-09-21');
    expect(parseFieldDisplay('21.09.26', 'date')).toBe('2026-09-21');
  });

  it('blank clears (empty string); garbage returns null', () => {
    useFormat('24h_dmy');
    expect(parseFieldDisplay('   ', 'date')).toBe('');
    expect(parseFieldDisplay('nonsense', 'date')).toBeNull();
    expect(parseFieldDisplay('45/13/2026', 'date')).toBeNull();
  });

  it('round-trips format -> parse', () => {
    useFormat('24h_dmy');
    const native = '2026-01-07T09:03';
    const shown = formatFieldDisplay(native, 'datetime');
    expect(parseFieldDisplay(shown, 'datetime')).toBe(native);
  });
});
