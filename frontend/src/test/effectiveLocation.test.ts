import { describe, it, expect } from 'vitest';
import { getEffectiveLocation } from '../utils/pathUtils';
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
