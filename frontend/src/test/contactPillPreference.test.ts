import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTACT_PILL_KEYS,
  contactPillFor,
  loadContactPill,
  saveContactPill,
} from '../utils/contactPillPreference';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
  type Contact,
} from '../types';

function contact(type: number): Contact {
  return {
    public_key: 'aa'.repeat(32),
    name: 'x',
    type,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  };
}

describe('contactPillPreference', () => {
  beforeEach(() => localStorage.clear());

  it('classifies each contact type into the right bucket', () => {
    expect(contactPillFor(contact(CONTACT_TYPE_CLIENT))).toBe('companions');
    expect(contactPillFor(contact(CONTACT_TYPE_SENSOR))).toBe('sensors');
    expect(contactPillFor(contact(CONTACT_TYPE_REPEATER))).toBe('repeaters');
    expect(contactPillFor(contact(CONTACT_TYPE_ROOM))).toBe('rooms');
  });

  it('treats unknown/other types as companions (catch-all)', () => {
    expect(contactPillFor(contact(99))).toBe('companions');
  });

  it('defaults to all when nothing stored', () => {
    expect(loadContactPill()).toBe('all');
  });

  it('round-trips a saved pill', () => {
    saveContactPill('repeaters');
    expect(loadContactPill()).toBe('repeaters');
  });

  it('falls back to all on an unknown stored value', () => {
    localStorage.setItem('remoteterm-sidebar-contacts-pill', 'bogus');
    expect(loadContactPill()).toBe('all');
  });

  it('exposes the canonical pill order', () => {
    expect(CONTACT_PILL_KEYS).toEqual(['all', 'companions', 'sensors', 'repeaters', 'rooms']);
  });
});
