import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSelection, saveSelection, DEFAULT_SELECTION } from '../lib/wordlistSelection';

const store: Record<string, string> = {};
beforeEach(() => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => store[k] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
    store[k] = v;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(store)) delete store[k];
});

describe('wordlistSelection', () => {
  it('returns the default when nothing is stored', () => {
    expect(loadSelection()).toEqual(DEFAULT_SELECTION);
  });

  it('round-trips a saved selection', () => {
    saveSelection({ english: false, dutch: true, customIds: [1, 2] });
    expect(loadSelection()).toEqual({ english: false, dutch: true, customIds: [1, 2] });
  });

  it('falls back to default on malformed JSON', () => {
    store['meshcore-wordlist-selection'] = '{not json';
    expect(loadSelection()).toEqual(DEFAULT_SELECTION);
  });

  it('filters non-number custom ids', () => {
    store['meshcore-wordlist-selection'] = JSON.stringify({
      english: true,
      dutch: false,
      customIds: [1, 'x', null, 3],
    });
    expect(loadSelection().customIds).toEqual([1, 3]);
  });

  it('fills missing fields from the default', () => {
    store['meshcore-wordlist-selection'] = JSON.stringify({ dutch: true });
    expect(loadSelection()).toEqual({ english: true, dutch: true, customIds: [] });
  });
});
