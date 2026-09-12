import { describe, it, expect } from 'vitest';
import { computeRegionSeed } from '../lib/regionSeed';

describe('computeRegionSeed', () => {
  it('adds reported codes not already in known regions, preserving existing order', () => {
    const { merged, added } = computeRegionSeed(['nl'], ['nl', 'nl-nh', 'eu']);
    expect(merged).toEqual(['nl', 'nl-nh', 'eu']);
    expect(added).toEqual(['nl-nh', 'eu']);
  });

  it('drops the wildcard and blanks', () => {
    const { merged, added } = computeRegionSeed([], ['*', '', '  ', 'nl']);
    expect(merged).toEqual(['nl']);
    expect(added).toEqual(['nl']);
  });

  it('dedupes reported case-insensitively and skips ones already known', () => {
    const { merged, added } = computeRegionSeed(['NL'], ['nl', 'NL-NH', 'nl-nh']);
    expect(merged).toEqual(['NL', 'NL-NH']);
    expect(added).toEqual(['NL-NH']);
  });

  it('trims surrounding whitespace on reported codes', () => {
    const { added } = computeRegionSeed([], ['  nl-nh-dhr  ']);
    expect(added).toEqual(['nl-nh-dhr']);
  });

  it('returns no additions when reported is empty', () => {
    const { merged, added } = computeRegionSeed(['nl', 'eu'], []);
    expect(merged).toEqual(['nl', 'eu']);
    expect(added).toEqual([]);
  });

  it('returns no additions when every reported code is already known', () => {
    const { merged, added } = computeRegionSeed(['nl', 'eu'], ['nl', 'eu']);
    expect(merged).toEqual(['nl', 'eu']);
    expect(added).toEqual([]);
  });
});
