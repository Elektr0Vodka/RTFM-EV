import { describe, it, expect } from 'vitest';

import { buildHistoryParams } from '../utils/packetHistoryQuery';
import { SF_FILTER_BUCKETS } from '../utils/radioSf';
import {
  KNOWN_PAYLOAD_TYPES,
  HOP_BYTE_WIDTH_BUCKETS,
  ROUTE_FILTER_TYPES,
} from '../utils/rawPacketStats';

describe('buildHistoryParams', () => {
  it('omits payload_types/hop_widths/hex when all enabled and no hex', () => {
    const p = buildHistoryParams({
      startTs: 100,
      endTs: 200,
      enabledTypes: new Set(KNOWN_PAYLOAD_TYPES),
      enabledHopWidths: new Set(HOP_BYTE_WIDTH_BUCKETS),
      hexQuery: '',
      searchTerm: '',
      limit: 500,
    });
    expect(p.getAll('payload_types')).toEqual([]);
    expect(p.getAll('hop_widths')).toEqual([]);
    expect(p.get('hex')).toBeNull();
    expect(p.get('search')).toBeNull();
    expect(p.get('policy_only')).toBeNull();
    expect(p.get('after_ts')).toBe('100');
    expect(p.get('before_ts')).toBe('200');
    expect(p.get('limit')).toBe('500');
    expect(p.get('before_id')).toBeNull();
  });

  it('sends only the enabled subset plus cursor, hex, and search', () => {
    const p = buildHistoryParams({
      startTs: 0,
      endTs: 10,
      enabledTypes: new Set(['Advert']),
      enabledHopWidths: new Set(['No path']),
      hexQuery: 'abcd',
      searchTerm: 'alice',
      policyOnly: true,
      limit: 500,
      beforeId: 42,
    });
    expect(p.get('policy_only')).toBe('true');
    expect(p.getAll('payload_types')).toEqual(['Advert']);
    expect(p.getAll('hop_widths')).toEqual(['No path']);
    expect(p.get('hex')).toBe('abcd');
    expect(p.get('search')).toBe('alice');
    expect(p.get('before_id')).toBe('42');
  });

  it('sends route_types only when some routes are off', () => {
    const base = {
      startTs: 0,
      endTs: 10,
      enabledTypes: new Set(KNOWN_PAYLOAD_TYPES),
      enabledHopWidths: new Set(HOP_BYTE_WIDTH_BUCKETS),
      hexQuery: '',
      searchTerm: '',
      limit: 500,
    };
    expect(
      buildHistoryParams({ ...base, enabledRoutes: new Set(ROUTE_FILTER_TYPES) }).getAll(
        'route_types'
      )
    ).toEqual([]);
    expect(
      buildHistoryParams({
        ...base,
        enabledRoutes: new Set(['Flood', 'TransportFlood']),
      }).getAll('route_types')
    ).toEqual(['Flood', 'TransportFlood']);
  });

  it('floors fractional timestamps', () => {
    const p = buildHistoryParams({
      startTs: 100.9,
      endTs: 200.4,
      enabledTypes: new Set(KNOWN_PAYLOAD_TYPES),
      enabledHopWidths: new Set(HOP_BYTE_WIDTH_BUCKETS),
      hexQuery: '',
      searchTerm: '',
      limit: 500,
    });
    expect(p.get('after_ts')).toBe('100');
    expect(p.get('before_ts')).toBe('200');
  });
});

describe('buildHistoryParams SF axis', () => {
  const base = {
    startTs: 1,
    endTs: 2,
    enabledTypes: new Set(KNOWN_PAYLOAD_TYPES),
    enabledHopWidths: new Set(HOP_BYTE_WIDTH_BUCKETS),
    hexQuery: '',
    searchTerm: '',
    limit: 10,
  };

  it('omits radio_sfs when every SF is shown', () => {
    const p = buildHistoryParams({ ...base, enabledSfs: new Set(SF_FILTER_BUCKETS) });
    expect(p.getAll('radio_sfs')).toEqual([]);
  });

  it('sends the shown SFs as numbers and Unknown as is', () => {
    const p = buildHistoryParams({ ...base, enabledSfs: new Set(['SF8', 'Unknown']) });
    expect(p.getAll('radio_sfs').sort()).toEqual(['8', 'Unknown']);
  });

  it('sends none when every SF is unticked, so nothing matches', () => {
    const p = buildHistoryParams({ ...base, enabledSfs: new Set<string>() });
    expect(p.getAll('radio_sfs')).toEqual(['none']);
  });
});
