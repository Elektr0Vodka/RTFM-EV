import { describe, it, expect } from 'vitest';
import {
  isLocale,
  resolveLocale,
  interpolate,
  translate,
  type Catalog,
  type Locale,
} from '../i18n/i18n';

const catalogs: Record<Locale, Catalog> = {
  en: {
    common_hi: 'Hello {name}',
    chat_packets: { one: '{count} packet', other: '{count} packets' },
    only_en: 'English only',
  },
  nl: {
    common_hi: 'Hallo {name}',
    chat_packets: { one: '{count} pakket', other: '{count} pakketten' },
  } as Catalog,
  de: {} as Catalog,
};

describe('isLocale / resolveLocale', () => {
  it('accepts valid locales, rejects others', () => {
    expect(isLocale('nl')).toBe(true);
    expect(isLocale('xx')).toBe(false);
    expect(resolveLocale('de')).toBe('de');
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale('xx')).toBe('en');
  });
});

describe('interpolate', () => {
  it('replaces {name} tokens and leaves unknown ones', () => {
    expect(interpolate('Hello {name}', { name: 'Bob' })).toBe('Hello Bob');
    expect(interpolate('a {x}-{y} b', { x: 1, y: 2 })).toBe('a 1-2 b');
    expect(interpolate('keep {missing}', {})).toBe('keep {missing}');
  });
});

describe('translate', () => {
  it('interpolates strings', () => {
    expect(translate(catalogs, 'nl', 'common_hi', { name: 'Bob' })).toBe('Hallo Bob');
  });
  it('selects plural form via Intl.PluralRules', () => {
    expect(translate(catalogs, 'en', 'chat_packets', { count: 1 })).toBe('1 packet');
    expect(translate(catalogs, 'en', 'chat_packets', { count: 3 })).toBe('3 packets');
    expect(translate(catalogs, 'nl', 'chat_packets', { count: 2 })).toBe('2 pakketten');
  });
  it('falls back locale -> en -> key', () => {
    // de is empty -> English value
    expect(translate(catalogs, 'de', 'common_hi', { name: 'Bob' })).toBe('Hello Bob');
    // key missing everywhere -> raw key
    expect(translate(catalogs, 'en', 'does_not_exist')).toBe('does_not_exist');
    // present only in en -> used from any locale
    expect(translate(catalogs, 'nl', 'only_en')).toBe('English only');
  });
});
