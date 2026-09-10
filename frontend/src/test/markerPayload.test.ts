import { describe, it, expect } from 'vitest';
import {
  buildMarkerPayload,
  sanitizeMarkerLabel,
  parseMarker,
} from '../utils/meshcoreOpenPayloads';

describe('sanitizeMarkerLabel', () => {
  it('removes pipes and trims', () => {
    expect(sanitizeMarkerLabel('  a|b|c  ')).toBe('abc');
  });
});

describe('buildMarkerPayload', () => {
  it('formats coords to 6 decimals with a poi flag', () => {
    expect(buildMarkerPayload(52.123456789, 4.1, 'Home')).toBe('m:52.123457,4.100000|Home|poi');
  });

  it('allows an empty label', () => {
    expect(buildMarkerPayload(1, 2, '')).toBe('m:1.000000,2.000000||poi');
  });

  it('sanitizes a pipe out of the label', () => {
    expect(buildMarkerPayload(1, 2, 'a|b')).toBe('m:1.000000,2.000000|ab|poi');
  });
});

describe('parseMarker', () => {
  it('parses a full payload', () => {
    expect(parseMarker('m:52.123456,4.123456|Home|poi')).toEqual({
      lat: 52.123456,
      lon: 4.123456,
      label: 'Home',
      flags: 'poi',
    });
  });

  it('parses an empty label', () => {
    expect(parseMarker('m:1.5,2.5||poi')).toEqual({ lat: 1.5, lon: 2.5, label: '', flags: 'poi' });
  });

  it('parses negative coordinates', () => {
    const parsed = parseMarker('m:-33.865143,-151.209900|Sydney|poi');
    expect(parsed?.lat).toBeCloseTo(-33.865143, 6);
    expect(parsed?.lon).toBeCloseTo(-151.2099, 6);
  });

  it('rejects out-of-range coordinates', () => {
    expect(parseMarker('m:200,4|x|poi')).toBeNull();
  });

  it('rejects 0,0 (treated as unset)', () => {
    expect(parseMarker('m:0,0|x|poi')).toBeNull();
  });

  it('rejects text missing the second pipe', () => {
    expect(parseMarker('m:1.5,2.5|Home')).toBeNull();
  });

  it('rejects non-marker text', () => {
    expect(parseMarker('hello world')).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(parseMarker('  m:1.5,2.5|Home|poi  ')?.label).toBe('Home');
  });
});
