import { describe, it, expect } from 'vitest';
import { getEffectiveLocation, resolveNodeCoord } from '../utils/pathUtils';
import type { Contact } from '../types';

function contact(overrides: Partial<Contact>): Contact {
  return {
    public_key: 'a'.repeat(64),
    name: 'n',
    type: 0,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...overrides,
  } as Contact;
}

describe('getEffectiveLocation', () => {
  it('prefers advertised coords when valid', () => {
    const c = contact({ lat: 52, lon: 5, manual_lat: 10, manual_lon: 10 });
    expect(getEffectiveLocation(c)).toEqual({ lat: 52, lon: 5 });
  });

  it('falls back to manual when advertised invalid', () => {
    const c = contact({ lat: null, lon: null, manual_lat: 10, manual_lon: 11 });
    expect(getEffectiveLocation(c)).toEqual({ lat: 10, lon: 11 });
  });

  it('returns null when neither is valid', () => {
    expect(getEffectiveLocation(contact({}))).toBeNull();
  });

  it('ignores a lone manual coordinate', () => {
    const c = contact({ manual_lat: 10, manual_lon: null });
    expect(getEffectiveLocation(c)).toBeNull();
  });
});

describe('resolveNodeCoord', () => {
  const self = { lat: 40, lon: -70 };

  function index(...contacts: Contact[]): Map<string, Contact[]> {
    const m = new Map<string, Contact[]>();
    for (const c of contacts) m.set(c.public_key.slice(0, 12), [c]);
    return m;
  }

  it("resolves 'self' to the local node", () => {
    expect(resolveNodeCoord('self', self, new Map())).toEqual(self);
  });

  it("returns undefined for 'self' when the local node is unplaced", () => {
    expect(resolveNodeCoord('self', null, new Map())).toBeUndefined();
  });

  it('resolves an advertised-located contact by prefix', () => {
    const c = contact({ public_key: 'b'.repeat(64), lat: 52, lon: 5 });
    expect(resolveNodeCoord('b'.repeat(12), self, index(c))).toEqual({ lat: 52, lon: 5 });
  });

  it('resolves a manual-only contact to its override coordinates', () => {
    const c = contact({
      public_key: 'c'.repeat(64),
      lat: null,
      lon: null,
      manual_lat: 51,
      manual_lon: 4,
    });
    expect(resolveNodeCoord('c'.repeat(12), self, index(c))).toEqual({ lat: 51, lon: 4 });
  });

  it('returns undefined for an unlocated contact', () => {
    const c = contact({ public_key: 'd'.repeat(64) });
    expect(resolveNodeCoord('d'.repeat(12), self, index(c))).toBeUndefined();
  });

  it('returns undefined when the prefix is ambiguous (multiple matches)', () => {
    const m = new Map<string, Contact[]>([
      [
        'ee',
        [
          contact({ public_key: 'e'.repeat(64), manual_lat: 51, manual_lon: 4 }),
          contact({ public_key: 'e'.repeat(64) }),
        ],
      ],
    ]);
    expect(resolveNodeCoord('ee', self, m)).toBeUndefined();
  });
});
