import { describe, it, expect } from 'vitest';
import { buildAdvertArcs, widthForHop } from '../../map/layers/advertLinksLayer';
import type { AdvertLinkEdge } from '../../types';

const now = 1_000_000_000_000; // ms

function edge(partial: Partial<AdvertLinkEdge>): AdvertLinkEdge {
  return {
    a: { pubkey: 'ff00', lat: 52, lon: 5, kind: 'contact' },
    b: { pubkey: 'aa11', lat: 53, lon: 6, kind: 'external' },
    hop_width: 2,
    count: 1,
    last_seen: Math.floor(now / 1000),
    ambiguous: false,
    ...partial,
  };
}

describe('widthForHop', () => {
  it('increases with confidence', () => {
    expect(widthForHop(1)).toBeLessThan(widthForHop(2));
    expect(widthForHop(2)).toBeLessThan(widthForHop(3));
  });
});

describe('buildAdvertArcs', () => {
  it('builds one LineString per edge with endpoints in lon,lat order', () => {
    const fc = buildAdvertArcs([edge({})], now);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry.coordinates[0]).toEqual([5, 52]);
    expect(f.geometry.coordinates[1]).toEqual([6, 53]);
    expect(f.properties.width).toBe(widthForHop(2));
    expect(f.properties.ambiguous).toBe(0);
    expect(f.properties.opacity).toBeGreaterThan(0);
  });

  it('marks ambiguous edges with ambiguous=1', () => {
    const fc = buildAdvertArcs([edge({ ambiguous: true })], now);
    expect(fc.features[0].properties.ambiguous).toBe(1);
  });

  it('fades opacity with recency (older edge is fainter)', () => {
    const fresh = buildAdvertArcs([edge({ last_seen: Math.floor(now / 1000) })], now);
    const old = buildAdvertArcs(
      [edge({ last_seen: Math.floor((now - 40 * 24 * 3600e3) / 1000) })],
      now
    );
    expect(fresh.features[0].properties.opacity).toBeGreaterThan(
      old.features[0].properties.opacity
    );
  });
});
