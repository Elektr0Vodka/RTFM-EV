import { describe, expect, it } from 'vitest';

import { foldPacketsByContent, getRawPacketContentKey } from '../utils/rawPacketContent';
import type { RawPacket } from '../types';

// A real GroupText frame (header + path + encrypted payload).
const GROUP_TEXT_PACKET_HEX =
  '1500E69C7A89DD0AF6A2D69F5823B88F9720731E4B887C56932BF889255D8D926D99195927144323A42DD8A158F878B518B8304DF55E80501C7D02A9FFD578D3518283156BBA257BF8413E80A237393B2E4149BBBC864371140A9BBC4E23EB9BF203EF0D029214B3E3AAC3C0295690ACDB89A28619E7E5F22C83E16073AD679D25FA904D07E5ACF1DB5A7C77D7E1719FB9AE5BF55541EE0D7F59ED890E12CF0FEED6700818';

function makePacket(overrides: Partial<RawPacket> = {}): RawPacket {
  return {
    id: 1,
    observation_id: 1,
    timestamp: 1_700_000_000,
    data: 'aabbccdd',
    payload_type: 'Unknown',
    snr: null,
    rssi: null,
    decrypted: false,
    decrypted_info: null,
    ...overrides,
  };
}

describe('getRawPacketContentKey', () => {
  it('returns the same key for byte-identical packets', () => {
    const a = makePacket({ id: 1, observation_id: 1, data: 'aabbccdd' });
    const b = makePacket({ id: 2, observation_id: 2, data: 'aabbccdd' });
    expect(getRawPacketContentKey(a)).toBe(getRawPacketContentKey(b));
  });

  it('returns different keys for different content', () => {
    const a = makePacket({ id: 1, observation_id: 1, data: 'aabbccdd' });
    const b = makePacket({ id: 2, observation_id: 2, data: '11223344' });
    expect(getRawPacketContentKey(a)).not.toBe(getRawPacketContentKey(b));
  });

  it('extracts the path-independent payload from a decodable frame', () => {
    const packet = makePacket({ data: GROUP_TEXT_PACKET_HEX });
    const key = getRawPacketContentKey(packet);
    // A decodable frame yields the payload segment (path/header stripped), so
    // the key is shorter than the full frame and carries the payload marker.
    expect(key.startsWith('p:')).toBe(true);
    expect(key.length - 2).toBeLessThan(GROUP_TEXT_PACKET_HEX.length);
  });

  it('falls back to the full frame for undecodable hex', () => {
    const key = getRawPacketContentKey(makePacket({ data: 'zz' }));
    expect(key).toBe('d:ZZ');
  });
});

describe('foldPacketsByContent', () => {
  it('collapses same-content packets into one entry and counts copies', () => {
    const packets = [
      makePacket({ id: 1, observation_id: 1, timestamp: 100, data: 'aaaa' }),
      makePacket({ id: 2, observation_id: 2, timestamp: 300, data: 'aaaa' }),
      makePacket({ id: 3, observation_id: 3, timestamp: 200, data: 'bbbb' }),
    ];

    const folded = foldPacketsByContent(packets);

    expect(folded).toHaveLength(2);
    const aaaa = folded.find((f) => f.packet.data === 'aaaa');
    const bbbb = folded.find((f) => f.packet.data === 'bbbb');
    expect(aaaa?.count).toBe(2);
    expect(bbbb?.count).toBe(1);
    // Representative is the newest sighting of the group.
    expect(aaaa?.packet.timestamp).toBe(300);
  });

  it('leaves distinct packets untouched with a count of one', () => {
    const packets = [
      makePacket({ id: 1, observation_id: 1, data: 'aaaa' }),
      makePacket({ id: 2, observation_id: 2, data: 'bbbb' }),
    ];
    const folded = foldPacketsByContent(packets);
    expect(folded).toHaveLength(2);
    expect(folded.every((f) => f.count === 1)).toBe(true);
  });
});
