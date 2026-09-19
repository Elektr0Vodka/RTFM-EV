import { describe, it, expect } from 'vitest';

import { buildHistoryParams } from '../utils/packetHistoryQuery';
import { KNOWN_PAYLOAD_TYPES, HOP_BYTE_WIDTH_BUCKETS } from '../utils/rawPacketStats';

describe('buildHistoryParams', () => {
  it('omits payload_types/hop_widths/hex when all enabled and no hex', () => {
    const p = buildHistoryParams({
      startTs: 100,
      endTs: 200,
      enabledTypes: new Set(KNOWN_PAYLOAD_TYPES),
      enabledHopWidths: new Set(HOP_BYTE_WIDTH_BUCKETS),
      hexQuery: '',
      limit: 500,
    });
    expect(p.getAll('payload_types')).toEqual([]);
    expect(p.getAll('hop_widths')).toEqual([]);
    expect(p.get('hex')).toBeNull();
    expect(p.get('after_ts')).toBe('100');
    expect(p.get('before_ts')).toBe('200');
    expect(p.get('limit')).toBe('500');
    expect(p.get('before_id')).toBeNull();
  });

  it('sends only the enabled subset plus cursor and hex', () => {
    const p = buildHistoryParams({
      startTs: 0,
      endTs: 10,
      enabledTypes: new Set(['Advert']),
      enabledHopWidths: new Set(['No path']),
      hexQuery: 'abcd',
      limit: 500,
      beforeId: 42,
    });
    expect(p.getAll('payload_types')).toEqual(['Advert']);
    expect(p.getAll('hop_widths')).toEqual(['No path']);
    expect(p.get('hex')).toBe('abcd');
    expect(p.get('before_id')).toBe('42');
  });

  it('floors fractional timestamps', () => {
    const p = buildHistoryParams({
      startTs: 100.9,
      endTs: 200.4,
      enabledTypes: new Set(KNOWN_PAYLOAD_TYPES),
      enabledHopWidths: new Set(HOP_BYTE_WIDTH_BUCKETS),
      hexQuery: '',
      limit: 500,
    });
    expect(p.get('after_ts')).toBe('100');
    expect(p.get('before_ts')).toBe('200');
  });
});
