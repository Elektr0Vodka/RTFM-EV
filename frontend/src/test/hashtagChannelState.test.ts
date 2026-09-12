import { describe, it, expect } from 'vitest';
import { buildNameSet, classifyHashtag } from '../lib/hashtagChannelState';

describe('buildNameSet', () => {
  it('lowercases and normalises a leading #', () => {
    const set = buildNameSet(['#Amsterdam', 'utrecht']);
    expect(set.has('#amsterdam')).toBe(true);
    expect(set.has('#utrecht')).toBe(true);
  });
});

describe('classifyHashtag', () => {
  const followed = buildNameSet(['#amsterdam']);
  const registry = buildNameSet(['#amsterdam', '#saarland']);

  it('returns "followed" when in the followed set', () => {
    expect(classifyHashtag('#amsterdam', followed, registry)).toBe('followed');
  });
  it('returns "known" when only in the registry set', () => {
    expect(classifyHashtag('#saarland', followed, registry)).toBe('known');
  });
  it('returns "unknown" when in neither', () => {
    expect(classifyHashtag('#wetter', followed, registry)).toBe('unknown');
  });
  it('is case-insensitive on the label', () => {
    expect(classifyHashtag('#AMSTERDAM', followed, registry)).toBe('followed');
  });
});
