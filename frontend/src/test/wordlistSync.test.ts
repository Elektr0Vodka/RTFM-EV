import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadSyncedWordlist,
  saveSyncedWordlist,
  mergeWordlists,
  loadRegistryWordlist,
  saveRegistryWordlist,
  registryWordlistCandidates,
} from '../lib/wordlistSync';

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

describe('registryWordlistCandidates', () => {
  it('strips a single leading # and trims', () => {
    expect(registryWordlistCandidates(['#amsterdam', '#den-haag', 'utrecht'])).toEqual([
      'amsterdam',
      'den-haag',
      'utrecht',
    ]);
  });

  it('drops empty/whitespace-only names', () => {
    expect(registryWordlistCandidates(['#', '  ', '#ok'])).toEqual(['ok']);
  });
});

describe('loadRegistryWordlist / saveRegistryWordlist', () => {
  it('round-trips a saved list under its own key', () => {
    saveRegistryWordlist(['amsterdam', 'saarland']);
    expect(loadRegistryWordlist()).toEqual(['amsterdam', 'saarland']);
  });

  it('is independent of the remote sync cache', () => {
    saveSyncedWordlist(['remote-a']);
    saveRegistryWordlist(['registry-b']);
    expect(loadSyncedWordlist()).toEqual(['remote-a']);
    expect(loadRegistryWordlist()).toEqual(['registry-b']);
  });

  it('returns [] on malformed cached JSON', () => {
    store['meshcore-wordlist-registry-cache'] = '{not valid';
    expect(loadRegistryWordlist()).toEqual([]);
  });
});
