import { describe, expect, it } from 'vitest';

import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder';

import {
  buildRawPacketStatsSnapshot,
  classifyDecodedHopByteWidth,
  classifyHopByteWidth,
  summarizeRawPacketForStats,
  type RawPacketStatsSessionState,
} from '../utils/rawPacketStats';
import type { RawPacket } from '../types';

const TEXT_MESSAGE_PACKET = '09046F17C47ED00A13E16AB5B94B1CC2D1A5059C6E5A6253C60D';
// One-byte hop path (pathHashSize undefined; tokens are single bytes).
const ONE_BYTE_HOP_PACKET = TEXT_MESSAGE_PACKET;
// Two-byte hop path (decoded pathHashSize === 2).
const TWO_BYTE_HOP_PACKET = '4444444444440000000000000000000000000000000000000000000000000000';

function createSession(
  overrides: Partial<RawPacketStatsSessionState> = {}
): RawPacketStatsSessionState {
  return {
    sessionStartedAt: 700_000,
    totalObservedPackets: 4,
    trimmedObservationCount: 0,
    observations: [
      {
        observationKey: 'obs-1',
        timestamp: 850,
        payloadType: 'Advert',
        routeType: 'Flood',
        decrypted: false,
        rssi: -68,
        snr: 7,
        sourceKey: 'AA11',
        sourceLabel: 'AA11',
        pathTokenCount: 2,
        pathSignature: '01>02',
        hopByteWidth: 1,
      },
      {
        observationKey: 'obs-2',
        timestamp: 910,
        payloadType: 'TextMessage',
        routeType: 'Direct',
        decrypted: true,
        rssi: -74,
        snr: 5,
        sourceKey: 'BB22',
        sourceLabel: 'BB22',
        pathTokenCount: 0,
        pathSignature: null,
        hopByteWidth: null,
      },
      {
        observationKey: 'obs-3',
        timestamp: 960,
        payloadType: 'Advert',
        routeType: 'Flood',
        decrypted: false,
        rssi: -64,
        snr: 8,
        sourceKey: 'AA11',
        sourceLabel: 'AA11',
        pathTokenCount: 1,
        pathSignature: '02',
        hopByteWidth: 2,
      },
      {
        observationKey: 'obs-4',
        timestamp: 990,
        payloadType: 'Ack',
        routeType: 'Direct',
        decrypted: true,
        rssi: -88,
        snr: 3,
        sourceKey: null,
        sourceLabel: null,
        pathTokenCount: 0,
        pathSignature: null,
        hopByteWidth: null,
      },
    ],
    ...overrides,
  };
}

describe('buildRawPacketStatsSnapshot', () => {
  it('prefers decrypted contact identity over one-byte sourceHash for stats bucketing', () => {
    const packet: RawPacket = {
      id: 1,
      observation_id: 10,
      timestamp: 1_700_000_000,
      data: TEXT_MESSAGE_PACKET,
      payload_type: 'TextMessage',
      snr: 4,
      rssi: -72,
      decrypted: true,
      decrypted_info: {
        channel_name: null,
        sender: 'Alpha',
        channel_key: null,
        contact_key: '0a'.repeat(32),
        sender_timestamp: null,
        message: null,
      },
    };

    const summary = summarizeRawPacketForStats(packet);

    expect(summary.sourceKey).toBe('0A'.repeat(32));
    expect(summary.sourceLabel).toBe('Alpha');
  });

  it('tags unresolved one-byte source hashes so they do not collide with full contact keys', () => {
    const packet: RawPacket = {
      id: 2,
      observation_id: 11,
      timestamp: 1_700_000_000,
      data: TEXT_MESSAGE_PACKET,
      payload_type: 'TextMessage',
      snr: 4,
      rssi: -72,
      decrypted: false,
      decrypted_info: null,
    };

    const summary = summarizeRawPacketForStats(packet);

    expect(summary.sourceKey).toBe('hash1:0A');
    expect(summary.sourceLabel).toBe('0A');
  });

  it('computes counts, rankings, and rolling-window coverage from session observations', () => {
    const stats = buildRawPacketStatsSnapshot(createSession(), '5m', 1_000);

    expect(stats.packetCount).toBe(4);
    expect(stats.uniqueSources).toBe(2);
    expect(stats.pathBearingCount).toBe(2);
    expect(stats.payloadBreakdown.slice(0, 3).map((item) => item.label)).toEqual([
      'Advert',
      'Ack',
      'TextMessage',
    ]);
    expect(stats.payloadBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'GroupText', count: 0 }),
        expect.objectContaining({ label: 'Control', count: 0 }),
      ])
    );
    expect(stats.hopProfile.map((item) => item.label)).toEqual([
      '0',
      '1',
      '2-5',
      '6-10',
      '11-15',
      '16-20',
      '21-31',
      '32+',
    ]);
    expect(stats.hopProfile).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '0', count: 2 }),
        expect.objectContaining({ label: '1', count: 1 }),
        expect.objectContaining({ label: '2-5', count: 1 }),
        expect.objectContaining({ label: '6-10', count: 0 }),
        expect.objectContaining({ label: '11-15', count: 0 }),
        expect.objectContaining({ label: '16-20', count: 0 }),
        expect.objectContaining({ label: '21-31', count: 0 }),
        expect.objectContaining({ label: '32+', count: 0 }),
      ])
    );
    expect(stats.hopByteWidthProfile).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'No path', count: 2 }),
        expect.objectContaining({ label: '1 byte / hop', count: 1 }),
        expect.objectContaining({ label: '2 bytes / hop', count: 1 }),
      ])
    );
    expect(stats.strongestNeighbors[0]).toMatchObject({ label: 'AA11', bestRssi: -64 });
    expect(stats.mostActiveNeighbors[0]).toMatchObject({ label: 'AA11', count: 2 });
    expect(stats.windowFullyCovered).toBe(true);
  });

  it('flags incomplete session coverage when detailed history has been trimmed', () => {
    const stats = buildRawPacketStatsSnapshot(
      createSession({
        trimmedObservationCount: 25,
      }),
      'session',
      1_000
    );

    expect(stats.windowFullyCovered).toBe(false);
    expect(stats.packetCount).toBe(4);
  });
});

describe('classifyHopByteWidth', () => {
  it('buckets zero-hop traffic as "No path"', () => {
    expect(classifyHopByteWidth(0, null, null)).toBe('No path');
    expect(classifyHopByteWidth(0, 2, '0000')).toBe('No path');
  });

  it('buckets by explicit hop-byte width when present', () => {
    expect(classifyHopByteWidth(2, 1, '01>02')).toBe('1 byte / hop');
    expect(classifyHopByteWidth(3, 2, '0000>1111>2222')).toBe('2 bytes / hop');
    expect(classifyHopByteWidth(1, 3, '3fa002')).toBe('3 bytes / hop');
  });

  it('infers width from the first path token when width is absent', () => {
    expect(classifyHopByteWidth(1, null, '6f')).toBe('1 byte / hop');
    expect(classifyHopByteWidth(1, null, 'abcd')).toBe('2 bytes / hop');
  });

  it('buckets path-bearing traffic with no derivable width as "Unknown width"', () => {
    // Odd-length token cannot be a whole number of bytes; width undecidable.
    expect(classifyHopByteWidth(1, null, 'abc')).toBe('Unknown width');
    // A first token wider than 3 bytes falls outside the known buckets.
    expect(classifyHopByteWidth(1, null, 'aabbccdd')).toBe('Unknown width');
  });
});

describe('classifyDecodedHopByteWidth', () => {
  it('classifies a one-byte hop packet from its decoded path', () => {
    expect(classifyDecodedHopByteWidth(MeshCoreDecoder.decode(ONE_BYTE_HOP_PACKET))).toBe(
      '1 byte / hop'
    );
  });

  it('classifies a two-byte hop packet from its decoded path', () => {
    expect(classifyDecodedHopByteWidth(MeshCoreDecoder.decode(TWO_BYTE_HOP_PACKET))).toBe(
      '2 bytes / hop'
    );
  });

  it('classifies an invalid/undecodable packet as "No path"', () => {
    expect(classifyDecodedHopByteWidth(MeshCoreDecoder.decode('00'))).toBe('No path');
  });

  it('matches the stats snapshot Hop Byte Width buckets by construction', () => {
    // The filter and the stats chart must agree: both route through
    // classifyHopByteWidth, so a one-byte packet lands in the same bucket here
    // and in the snapshot's hopByteWidth breakdown.
    const observation = summarizeRawPacketForStats({
      id: 1,
      observation_id: 1,
      timestamp: 1,
      data: ONE_BYTE_HOP_PACKET,
      decrypted: false,
      payload_type: 'TextMessage',
      rssi: null,
      snr: null,
      decrypted_info: null,
    });
    expect(
      classifyHopByteWidth(
        observation.pathTokenCount,
        observation.hopByteWidth,
        observation.pathSignature
      )
    ).toBe('1 byte / hop');
  });
});
