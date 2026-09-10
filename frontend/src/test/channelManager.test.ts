import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { addMissingFromSync } from '../lib/channelManager';
import type { RegistryChannel } from '../lib/channelManager';

// channelManager reads/writes localStorage — provide a clean stub
const store: Record<string, string> = {};
beforeEach(() => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => store[k] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { store[k] = v; });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(store)) delete store[k];
});

const existingChannel: RegistryChannel = {
  channel: '#amsterdam',
  category: 'city',
  subcategory: '',
  region: 'Noord-Holland',
  language: ['NL'],
  status: 'active',
  verified: true,
  recommended: false,
  alias_of: null,
  notes: '',
  tags: [],
  scopes: [],
  country: 'NL',
  firstSeen: '2024-01-01T00:00:00.000Z',
  lastHeard: '2024-06-01T00:00:00.000Z',
  added: '2024-01-01',
  packets: 42,
  source: 'finder',
};

describe('addMissingFromSync', () => {
  it('adds channels that are not in the existing registry', () => {
    const incoming = [
      { name: '#denhaag', key: '84eed36f62c7b22527dbf8883585ad14' },
      { name: '#amsterdam', key: 'd768f5a0aa65f8c54e4ea521bd49eb4f' },
    ];
    const { result, added } = addMissingFromSync(incoming, [existingChannel]);

    expect(added).toBe(1);
    expect(result).toHaveLength(2);
    const newEntry = result.find((c) => c.channel === '#denhaag');
    expect(newEntry).toBeDefined();
    expect(newEntry!.source).toBe('imported');
  });

  it('never modifies an existing entry', () => {
    const incoming = [
      { name: '#amsterdam', key: 'd768f5a0aa65f8c54e4ea521bd49eb4f' },
    ];
    const { result, added } = addMissingFromSync(incoming, [existingChannel]);

    expect(added).toBe(0);
    expect(result).toHaveLength(1);
    // Original entry is untouched
    const entry = result.find((c) => c.channel === '#amsterdam')!;
    expect(entry.packets).toBe(42);
    expect(entry.source).toBe('finder');
    expect(entry.category).toBe('city');
  });

  it('is case-insensitive when deduplicating', () => {
    const incoming = [{ name: '#Amsterdam', key: 'abc' }];
    const { result, added } = addMissingFromSync(incoming, [existingChannel]);
    expect(added).toBe(0);
    expect(result).toHaveLength(1);
  });

  it('normalises names that are missing the # prefix', () => {
    const incoming = [{ name: 'rotterdam', key: 'e3f3ad25' }];
    const { result, added } = addMissingFromSync(incoming, []);
    expect(added).toBe(1);
    expect(result[0].channel).toBe('#rotterdam');
  });

  it('returns empty result for empty input', () => {
    const { result, added } = addMissingFromSync([], [existingChannel]);
    expect(added).toBe(0);
    expect(result).toHaveLength(1);
  });

  it('new entry has firstSeen null, lastHeard null, packets 0', () => {
    const incoming = [{ name: '#test', key: 'abc123' }];
    const { result } = addMissingFromSync(incoming, []);
    expect(result[0].firstSeen).toBeNull();
    expect(result[0].lastHeard).toBeNull();
    expect(result[0].packets).toBe(0);
  });
});
