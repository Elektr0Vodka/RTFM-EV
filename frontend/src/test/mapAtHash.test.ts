import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseHashConversation, getConversationHash } from '../utils/urlHash';

describe('map/at hash', () => {
  let originalHash: string;
  beforeEach(() => {
    originalHash = window.location.hash;
  });
  afterEach(() => {
    window.location.hash = originalHash;
  });

  it('parses #map/at/<lat>,<lon>', () => {
    window.location.hash = '#map/at/52.123456,4.123456';
    expect(parseHashConversation()).toEqual({
      type: 'map',
      name: 'map',
      mapFocusLatLon: [52.123456, 4.123456],
    });
  });

  it('parses negative coordinates', () => {
    window.location.hash = '#map/at/-33.865143,-151.2099';
    const parsed = parseHashConversation();
    expect(parsed?.mapFocusLatLon?.[0]).toBeCloseTo(-33.865143, 6);
    expect(parsed?.mapFocusLatLon?.[1]).toBeCloseTo(-151.2099, 6);
  });

  it('falls back to plain map for a malformed at-hash', () => {
    window.location.hash = '#map/at/notcoords';
    expect(parseHashConversation()).toEqual({ type: 'map', name: 'map' });
  });

  it('builds #map/at from a map conversation with mapFocusLatLon', () => {
    expect(
      getConversationHash({
        type: 'map',
        id: 'map',
        name: 'Node Map',
        mapFocusLatLon: [52.123456, 4.123456],
      })
    ).toBe('#map/at/52.123456,4.123456');
  });

  it('builds plain #map when no focus is set', () => {
    expect(getConversationHash({ type: 'map', id: 'map', name: 'Node Map' })).toBe('#map');
  });
});
