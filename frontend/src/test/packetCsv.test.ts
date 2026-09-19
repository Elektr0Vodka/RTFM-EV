import { describe, it, expect } from 'vitest';

import {
  PACKET_CSV_COLUMN_KEYS,
  buildPacketCsv,
  packetCsvFilename,
  type PacketCsvColumnKey,
} from '../utils/packetCsv';
import type { RawPacket } from '../types';

const HEADERS = Object.fromEntries(PACKET_CSV_COLUMN_KEYS.map((k) => [k, k])) as Record<
  PacketCsvColumnKey,
  string
>;

function pkt(overrides: Partial<RawPacket> = {}): RawPacket {
  return {
    id: 1,
    timestamp: 1_700_000_000,
    data: 'abcd',
    payload_type: 'ADVERT',
    snr: null,
    rssi: null,
    decrypted: false,
    decrypted_info: null,
    ...overrides,
  } as RawPacket;
}

describe('buildPacketCsv', () => {
  it('emits a header row plus one row per packet, in column order', () => {
    const csv = buildPacketCsv([pkt({ id: 1 }), pkt({ id: 2 })], HEADERS);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(PACKET_CSV_COLUMN_KEYS.join(','));
  });

  it('renders the controllable fields for a packet', () => {
    const csv = buildPacketCsv(
      [
        pkt({
          timestamp: 1_700_000_000,
          payload_type: 'GROUP_DATA',
          snr: 4.25,
          rssi: -90,
          decrypted: true,
          data: 'a1b2',
        }),
      ],
      HEADERS
    );
    const cols = csv.split('\r\n')[1].split(',');
    const at = (k: PacketCsvColumnKey) => cols[PACKET_CSV_COLUMN_KEYS.indexOf(k)];
    expect(at('timestamp_unix')).toBe('1700000000');
    expect(at('payload_type')).toBe('GROUP_DATA');
    expect(at('snr')).toBe('4.25');
    expect(at('rssi')).toBe('-90');
    expect(at('decrypted')).toBe('yes');
    expect(at('data_hex')).toBe('A1B2');
  });

  it('leaves snr/rssi blank when absent and marks undecrypted rows "no"', () => {
    const csv = buildPacketCsv([pkt({ snr: null, rssi: null, decrypted: false })], HEADERS);
    const cols = csv.split('\r\n')[1].split(',');
    const at = (k: PacketCsvColumnKey) => cols[PACKET_CSV_COLUMN_KEYS.indexOf(k)];
    expect(at('snr')).toBe('');
    expect(at('rssi')).toBe('');
    expect(at('decrypted')).toBe('no');
  });

  it('filenames as packet-history_YYYYMMDD_HHMMSS.csv', () => {
    const name = packetCsvFilename(new Date(2026, 8, 19, 22, 40, 5));
    expect(name).toBe('packet-history_20260919_224005.csv');
  });
});
