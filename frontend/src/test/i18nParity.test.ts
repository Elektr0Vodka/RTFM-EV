import { describe, it, expect } from 'vitest';
import en from '../i18n/locales/en.json';
import nl from '../i18n/locales/nl.json';
import de from '../i18n/locales/de.json';

const keys = (o: Record<string, unknown>) =>
  Object.keys(o)
    .filter((k) => !k.startsWith('_'))
    .sort();

describe('catalog parity', () => {
  const enKeys = keys(en as Record<string, unknown>);
  it('nl has exactly the same keys as en', () => {
    expect(keys(nl as Record<string, unknown>)).toEqual(enKeys);
  });
  it('de has exactly the same keys as en', () => {
    expect(keys(de as Record<string, unknown>)).toEqual(enKeys);
  });
});
