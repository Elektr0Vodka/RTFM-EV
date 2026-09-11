import { describe, it, expect } from 'vitest';
import { buildNodeFeatures, circleRadiusExpr, recencyTier } from '../../map/layers/nodesLayer';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_CLIENT, type Contact } from '../../types';

const now = 1_000_000; // seconds
const contact = (over: Partial<Contact>): Contact => ({
  public_key: 'aa',
  name: 'n',
  type: CONTACT_TYPE_CLIENT,
  flags: 0,
  direct_path: null,
  direct_path_len: 0,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: 52,
  lon: 5,
  last_seen: now,
  on_radio: true,
  favorite: false,
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
  ...over,
});

describe('recencyTier', () => {
  it('buckets by age', () => {
    expect(recencyTier(now, now)).toBe('recent');
    expect(recencyTier(now - 2 * 3600, now)).toBe('today');
    expect(recencyTier(now - 2 * 86400, now)).toBe('stale');
    expect(recencyTier(now - 10 * 86400, now)).toBe('old');
    expect(recencyTier(null, now)).toBe('old');
  });
});

describe('circleRadiusExpr', () => {
  it('makes repeaters larger via a case on the repeater property', () => {
    expect(circleRadiusExpr(7, 10)).toEqual(['case', ['get', 'repeater'], 10, 7]);
  });
});

describe('buildNodeFeatures', () => {
  it('emits one feature per mappable contact with type/repeater/tier props', () => {
    const fc = buildNodeFeatures(
      [
        contact({ public_key: 'a', type: CONTACT_TYPE_REPEATER }),
        contact({ public_key: 'b', lat: null }),
      ],
      now,
    );
    expect(fc.features).toHaveLength(1); // 'b' has no lat, dropped
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [5, 52] });
    expect(fc.features[0].properties).toMatchObject({
      id: 'a',
      type: CONTACT_TYPE_REPEATER,
      repeater: true,
      tier: 'recent',
    });
  });
});
