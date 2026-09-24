import { describe, it, expect } from 'vitest';
import { heardContactsOnly, isWithinLinkRange } from '../../map/linkDistance';
import type { Contact } from '../../types';

const AMSTERDAM = { lat: 52.37, lon: 4.9 };
const UTRECHT = { lat: 52.09, lon: 5.12 };
const LONDON = { lat: 51.51, lon: -0.13 };

describe('isWithinLinkRange', () => {
  it('always passes when the cap is 0 (no limit)', () => {
    expect(isWithinLinkRange(AMSTERDAM, LONDON, 0)).toBe(true);
  });

  it('keeps a short link and drops one beyond the cap', () => {
    expect(isWithinLinkRange(AMSTERDAM, UTRECHT, 100)).toBe(true);
    // Amsterdam to London is roughly 360 km.
    expect(isWithinLinkRange(AMSTERDAM, LONDON, 100)).toBe(false);
    expect(isWithinLinkRange(AMSTERDAM, LONDON, 400)).toBe(true);
  });
});

describe('heardContactsOnly', () => {
  it('drops contacts this server has never heard', () => {
    const heard = { public_key: 'aa', last_seen: 100 } as Contact;
    const never = { public_key: 'bb', last_seen: null } as Contact;
    expect(heardContactsOnly([heard, never])).toEqual([heard]);
  });
});
