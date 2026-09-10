import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSyncedWordlist, saveSyncedWordlist, mergeWordlists } from '../lib/wordlistSync';

// wordlistSync reads/writes localStorage - provide a clean stub
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

describe('mergeWordlists', () => {
  it('dedupes case-insensitively, preserving first-seen order and casing', () => {
    expect(mergeWordlists(['amsterdam', 'Rotterdam'], ['ROTTERDAM', 'utrecht'])).toEqual([
      'amsterdam',
      'Rotterdam',
      'utrecht',
    ]);
  });

  it('drops blanks and trims', () => {
    expect(mergeWordlists(['  ', 'den haag ', ''], ['den haag'])).toEqual(['den haag']);
  });

  it('handles any number of lists', () => {
    expect(mergeWordlists(['a'], ['b'], ['a', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('loadSyncedWordlist / saveSyncedWordlist', () => {
  it('round-trips a saved list', () => {
    saveSyncedWordlist(['nl-gr', 'saarland']);
    expect(loadSyncedWordlist()).toEqual(['nl-gr', 'saarland']);
  });

  it('returns [] when nothing is cached', () => {
    expect(loadSyncedWordlist()).toEqual([]);
  });

  it('returns [] on malformed cached JSON', () => {
    store['meshcore-wordlist-sync-cache'] = '{not valid json';
    expect(loadSyncedWordlist()).toEqual([]);
  });

  it('filters non-string entries from a cached array', () => {
    store['meshcore-wordlist-sync-cache'] = JSON.stringify(['ok', 5, null, 'fine']);
    expect(loadSyncedWordlist()).toEqual(['ok', 'fine']);
  });

  it('returns [] when cached value is not an array', () => {
    store['meshcore-wordlist-sync-cache'] = JSON.stringify({ nope: true });
    expect(loadSyncedWordlist()).toEqual([]);
  });
});
