import { describe, it, expect } from 'vitest';
import {
  buildNodeFeatures,
  circleRadiusExpr,
  recencyTier,
  observedIdTag,
  LABEL_MIN_ZOOM,
  NODE_LABEL_FONT,
} from '../../map/layers/nodesLayer';
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
  radio_policy: 'auto',
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
      now
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

describe('observedIdTag', () => {
  const pk = '0123456789abcdef0123456789abcdef'; // 32 hex chars

  it('sizes the tag to the observed hash width (mode+1 bytes, uppercase)', () => {
    expect(observedIdTag(pk, 0)).toBe('01'); // 1 byte  -> 2 hex
    expect(observedIdTag(pk, 1)).toBe('0123'); // 2 bytes -> 4 hex
    expect(observedIdTag(pk, 2)).toBe('012345'); // 3 bytes -> 6 hex
  });

  it('defaults unknown / out-of-range modes to 1 byte', () => {
    expect(observedIdTag(pk, -1)).toBe('01');
    expect(observedIdTag(pk, 3)).toBe('01');
    expect(observedIdTag(pk, null)).toBe('01');
    expect(observedIdTag(pk, undefined)).toBe('01');
    expect(observedIdTag(pk, 1.5)).toBe('01');
  });

  it('returns what exists when the pubkey is shorter than the width', () => {
    expect(observedIdTag('ab', 2)).toBe('AB');
  });
});

describe('buildNodeFeatures label property', () => {
  const pk = '0123456789abcdef0123456789abcdef';

  it("defaults to an empty label ('off')", () => {
    const fc = buildNodeFeatures([contact({ public_key: pk, name: 'Alice' })], now);
    expect(fc.features[0].properties.label).toBe('');
  });

  it("uses the advert name in 'name' mode, falling back to a 12-char prefix", () => {
    const named = buildNodeFeatures([contact({ public_key: pk, name: 'Alice' })], now, 'name');
    expect(named.features[0].properties.label).toBe('Alice');
    const unnamed = buildNodeFeatures([contact({ public_key: pk, name: null })], now, 'name');
    expect(unnamed.features[0].properties.label).toBe(pk.slice(0, 12));
  });

  it("uses the observed-width ID tag in 'tag' mode", () => {
    const fc = buildNodeFeatures(
      [contact({ public_key: pk, direct_path_hash_mode: 1 })],
      now,
      'tag'
    );
    expect(fc.features[0].properties.label).toBe('0123');
  });
});

describe('label layer config', () => {
  it('hides labels below the density zoom threshold', () => {
    expect(LABEL_MIN_ZOOM).toBe(11);
  });

  it('requests a single font, not a stack (a stack 404s on the OFM/openmaptiles glyph servers)', () => {
    // Regression guard: a multi-font text-font makes MapLibre request the
    // comma-joined stack as one glyph key, which our basemap glyph servers do
    // not serve, so node labels silently vanish on the default (Nova) basemap.
    expect(NODE_LABEL_FONT).toHaveLength(1);
    expect(NODE_LABEL_FONT[0]).toBe('Noto Sans Regular');
  });
});
