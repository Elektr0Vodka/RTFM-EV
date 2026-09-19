import { describe, it, expect } from 'vitest';

import { resolvePathHopNames } from '../utils/pathHopNames';
import type { Contact } from '../types';

const contact = (public_key: string, name: string | null): Contact =>
  ({ public_key, name }) as unknown as Contact;

describe('resolvePathHopNames', () => {
  const contacts = [
    contact('ab12cd0000', 'Alice'),
    contact('ab99ff0000', 'Alex'),
    contact('cd34ef0000', 'Bob'),
  ];

  it('resolves a uniquely-matching prefix to its contact name', () => {
    expect(resolvePathHopNames(['cd'], contacts)).toEqual([
      { hex: 'cd', name: 'Bob', resolved: true },
    ]);
  });

  it('keeps an ambiguous prefix as raw hex', () => {
    expect(resolvePathHopNames(['ab'], contacts)).toEqual([
      { hex: 'ab', name: null, resolved: false },
    ]);
  });

  it('keeps an unknown prefix as raw hex', () => {
    expect(resolvePathHopNames(['ff'], contacts)).toEqual([
      { hex: 'ff', name: null, resolved: false },
    ]);
  });

  it('matches case-insensitively and preserves the original hex casing', () => {
    expect(resolvePathHopNames(['CD34'], contacts)).toEqual([
      { hex: 'CD34', name: 'Bob', resolved: true },
    ]);
  });

  it('returns raw hex when there are no contacts', () => {
    expect(resolvePathHopNames(['cd'], [])).toEqual([{ hex: 'cd', name: null, resolved: false }]);
  });
});
