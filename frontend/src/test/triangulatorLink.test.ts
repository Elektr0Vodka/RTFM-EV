import { describe, expect, it } from 'vitest';
import { buildTriangulatorUrl, TRIANGULATOR_BASE_URL } from '../utils/triangulatorLink';

const KEY = 'F40FD1f0b0dedcb2650457bf90d81f3c1b174242449e9012ec38aba5db2d87ee';

describe('buildTriangulatorUrl', () => {
  it('uses the first three hash bytes of a full key, lowercased', () => {
    expect(buildTriangulatorUrl(KEY)).toBe(`${TRIANGULATOR_BASE_URL}?prefixes=f40fd1`);
  });

  it('keeps whole bytes for shorter prefix-only keys', () => {
    expect(buildTriangulatorUrl('ab')).toBe(`${TRIANGULATOR_BASE_URL}?prefixes=ab`);
    expect(buildTriangulatorUrl('abcd')).toBe(`${TRIANGULATOR_BASE_URL}?prefixes=abcd`);
    expect(buildTriangulatorUrl('abcde')).toBe(`${TRIANGULATOR_BASE_URL}?prefixes=abcd`);
  });

  it('returns null for keys that cannot form a prefix', () => {
    expect(buildTriangulatorUrl('')).toBeNull();
    expect(buildTriangulatorUrl('a')).toBeNull();
    expect(buildTriangulatorUrl('zz')).toBeNull();
  });
});
