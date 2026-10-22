import { describe, it, expect } from 'vitest';
import { isMaxHops, latestAdvertHops, passesHopFilter } from '../../map/hopFilter';
import type { ContactAdvertPath } from '../../types';

const advertPath = (over: Partial<ContactAdvertPath>): ContactAdvertPath => ({
  path: '',
  path_len: 0,
  next_hop: null,
  first_seen: 0,
  last_seen: 0,
  heard_count: 1,
  ...over,
});

describe('latestAdvertHops', () => {
  it('takes the hop count of the most recently heard path, keyed by lowercase pubkey', () => {
    const hops = latestAdvertHops([
      {
        public_key: 'AABB',
        paths: [
          advertPath({ path_len: 3, last_seen: 100 }),
          advertPath({ path_len: 0, last_seen: 300 }),
          advertPath({ path_len: 1, last_seen: 200 }),
        ],
      },
    ]);
    expect(hops.get('aabb')).toBe(0);
  });

  it('keeps the first (backend-ordered) path on a last_seen tie', () => {
    const hops = latestAdvertHops([
      {
        public_key: 'cc',
        paths: [
          advertPath({ path_len: 2, last_seen: 50 }),
          advertPath({ path_len: 4, last_seen: 50 }),
        ],
      },
    ]);
    expect(hops.get('cc')).toBe(2);
  });

  it('leaves out a contact with no paths', () => {
    expect(latestAdvertHops([{ public_key: 'dd', paths: [] }]).has('dd')).toBe(false);
  });
});

describe('passesHopFilter', () => {
  it('passes everything with no limit, including unknown hop counts', () => {
    expect(passesHopFilter(undefined, null)).toBe(true);
    expect(passesHopFilter(7, null)).toBe(true);
  });

  it('passes nodes at or below the limit', () => {
    expect(passesHopFilter(0, 0)).toBe(true);
    expect(passesHopFilter(1, 0)).toBe(false);
    expect(passesHopFilter(2, 2)).toBe(true);
    expect(passesHopFilter(3, 2)).toBe(false);
  });

  it('hides nodes with an unknown hop count while a limit is set', () => {
    expect(passesHopFilter(undefined, 5)).toBe(false);
  });
});

describe('isMaxHops', () => {
  it('accepts the offered options only', () => {
    expect(isMaxHops(null)).toBe(true);
    expect(isMaxHops(0)).toBe(true);
    expect(isMaxHops(5)).toBe(true);
    expect(isMaxHops(6)).toBe(false);
    expect(isMaxHops(-1)).toBe(false);
    expect(isMaxHops('2')).toBe(false);
  });
});
