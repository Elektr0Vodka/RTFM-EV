import { describe, it, expect } from 'vitest';
import { buildExternalFeatures } from '../../map/layers/externalNodesLayer';
import type { ExternalMapNode } from '../../types';

const node = (over: Partial<ExternalMapNode>): ExternalMapNode => ({
  pubkey: 'aa'.repeat(32),
  name: 'Ext',
  role: 'repeater',
  lat: 52.1,
  lon: 4.9,
  last_seen: 1000,
  advert_count: 1,
  mobile: false,
  ...over,
});

describe('buildExternalFeatures', () => {
  it('maps nodes to GeoJSON point features with [lon,lat] and carried props', () => {
    const fc = buildExternalFeatures([
      node({ pubkey: 'bb'.repeat(32), name: 'A', role: 'client' }),
    ]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [4.9, 52.1] });
    expect(fc.features[0].properties).toMatchObject({
      pubkey: 'bb'.repeat(32),
      name: 'A',
      role: 'client',
      last_seen: 1000,
    });
  });

  it('falls back to a pubkey-prefix name when unnamed', () => {
    const fc = buildExternalFeatures([node({ name: '' })]);
    expect(fc.features[0].properties.name).toBe('aa'.repeat(32).slice(0, 12));
  });

  it('drops nodes without coordinates', () => {
    const fc = buildExternalFeatures([
      node({ lat: null as unknown as number }),
      node({ pubkey: 'cc'.repeat(32) }),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.pubkey).toBe('cc'.repeat(32));
  });
});
