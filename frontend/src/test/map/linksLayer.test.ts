import { describe, it, expect } from 'vitest';
import { buildLinkArcs, livenessOpacity, type ResolveCoord } from '../../map/layers/linksLayer';
import type { PacketNetworkLink } from '../../networkGraph/packetNetworkGraph';

const now = 1_000_000_000_000; // ms

describe('livenessOpacity', () => {
  it('is max when fresh and floors when stale', () => {
    expect(livenessOpacity(now, now)).toBeCloseTo(0.85, 5);
    expect(livenessOpacity(now - 40 * 24 * 3600e3, now)).toBeCloseTo(0.12, 5);
  });
  it('floors when timestamp missing', () => {
    expect(livenessOpacity(null, now)).toBeCloseTo(0.12, 5);
  });
  it('interpolates between fresh and stale', () => {
    // Halfway between FRESH (1d) and STALE (14d): (1d + 14d) / 2 = 7.5d.
    const mid = now - 7.5 * 24 * 3600e3;
    expect(livenessOpacity(mid, now)).toBeCloseTo(0.85 - 0.5 * (0.85 - 0.12), 5);
  });
});

describe('buildLinkArcs', () => {
  const coords: Record<string, { lat: number; lon: number }> = {
    a: { lat: 52, lon: 5 },
    b: { lat: 53, lon: 6 },
  };
  const resolve: ResolveCoord = (id) => coords[id];

  it('builds a LineString per link whose endpoints both resolve to coordinates', () => {
    const links: PacketNetworkLink[] = [
      { sourceId: 'a', targetId: 'b', lastActivity: now },
      { sourceId: 'a', targetId: 'missing', lastActivity: now }, // dropped
    ];
    const fc = buildLinkArcs(links, resolve, now);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe('LineString');
    expect(fc.features[0].geometry.coordinates[0]).toEqual([5, 52]);
    expect(fc.features[0].geometry.coordinates[1]).toEqual([6, 53]);
    expect(fc.features[0].properties.liveness).toBeCloseTo(0.85, 5);
  });
});
