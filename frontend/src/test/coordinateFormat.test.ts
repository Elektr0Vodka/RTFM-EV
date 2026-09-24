import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  COORDINATE_FORMAT_KEY,
  formatCoordinates,
  formatDms,
  formatMgrs,
  getSavedCoordinateFormat,
  setSavedCoordinateFormat,
  useCoordinateFormat,
} from '../utils/coordinateFormat';

beforeEach(() => {
  localStorage.clear();
});

describe('formatCoordinates', () => {
  it('keeps the decimal format as before', () => {
    expect(formatCoordinates(52.0907, 5.1214, 'decimal')).toBe('52.09070, 5.12140');
    expect(formatCoordinates(52.0907, 5.1214, 'decimal', 6)).toBe('52.090700, 5.121400');
  });

  it('formats degrees, minutes, seconds with hemispheres', () => {
    expect(formatDms(52.0907, 5.1214)).toBe(`52°05'26.5"N 5°07'17.0"E`);
    expect(formatDms(-33.8568, -70.6693)).toBe(`33°51'24.5"S 70°40'09.5"W`);
  });

  it('carries DMS rounding into minutes and degrees', () => {
    // 59.99999 minutes rounds to the next degree, not 60 minutes.
    expect(formatDms(51.99999999, 4.99999999)).toBe(`52°00'00.0"N 5°00'00.0"E`);
  });

  it('formats MGRS with spaces at 1 m precision', () => {
    // mgrs@2.2.0 forward([5.1214, 52.0907], 5) === '31UFT4533273249'
    expect(formatMgrs(52.0907, 5.1214)).toBe('31U FT 45332 73249');
    expect(formatCoordinates(52.0907, 5.1214, 'mgrs')).toBe('31U FT 45332 73249');
  });

  it('falls back to decimal where MGRS does not apply (poles)', () => {
    expect(formatMgrs(85, 10)).toBeNull();
    expect(formatCoordinates(85, 10, 'mgrs')).toBe('85.00000, 10.00000');
  });
});

describe('coordinate format preference', () => {
  it('defaults to decimal and ignores unknown values', () => {
    expect(getSavedCoordinateFormat()).toBe('decimal');
    localStorage.setItem(COORDINATE_FORMAT_KEY, 'utm');
    expect(getSavedCoordinateFormat()).toBe('decimal');
  });

  it('persists and notifies subscribers', () => {
    const { result } = renderHook(() => useCoordinateFormat());
    expect(result.current).toBe('decimal');
    act(() => setSavedCoordinateFormat('mgrs'));
    expect(result.current).toBe('mgrs');
    expect(localStorage.getItem(COORDINATE_FORMAT_KEY)).toBe('mgrs');
  });
});
