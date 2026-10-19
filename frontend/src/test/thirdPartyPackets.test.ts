import { describe, expect, it } from 'vitest';
import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder';

import { isNotEncrypted, recognizeThirdParty } from '../utils/thirdPartyPackets';
import { feedPayloadTypeName, KNOWN_PAYLOAD_TYPES } from '../utils/rawPacketStats';
import { decodePacketSummary, inspectRawPacket } from '../utils/rawPacketInspector';
import type { RawPacket } from '../types';

const be = (v: number, bytes: number) => {
  const out: string[] = [];
  let x = v < 0 ? 2 ** (bytes * 8) + v : v;
  for (let i = 0; i < bytes; i++) {
    out.unshift((x % 256).toString(16).padStart(2, '0'));
    x = Math.floor(x / 256);
  }
  return out.join('');
};
const ascii = (s: string) =>
  Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

// MeshCoreNG MCL1 tracker report (big-endian), name "NG".
const MCL1 =
  ascii('MCL1') +
  '0100' +
  '1a2b3c4d' +
  be(52_370_000, 4) +
  be(4_890_000, 4) +
  be(12, 2) +
  be(150, 2) +
  be(9000, 2) +
  '07' +
  be(3900, 2) +
  be(1_790_000_000, 4) +
  '02' +
  ascii('NG');
const LOCATION_HEX = '3500' + MCL1; // type 0x0D, FLOOD, no path
const ATLAS_HEX = '3200' + '0100' + '00'.repeat(12); // type 0x0C, DIRECT, position without extras
const CUBECELL_HEX = '2e00' + '81' + '02' + '1c' + '11223344' + 'aabbccddeeff0011'; // CONTROL
const RAW = (payload: string, path = '00') => '3e' + path + payload; // RAW_CUSTOM, DIRECT
const SAR_VOICE = RAW('56' + '01020304' + '03' + 'ab'.repeat(20), '01aa');
const SAR_IMAGE_FETCH = RAW('69' + '01020304' + '00' + 'a1a2a3a4a5a6' + '02' + '0507');
const SAR_SWARM_ASK = RAW('6d' + '01' + '02' + '01020304' + 'a1a2a3a4a5a6' + '01' + '09');
const SIGURD_PING = RAW('d0' + ascii('ING:00112233'));
const SIGURD_PONG = RAW('d0' + ascii('ONG:00112233:Base:-60'));
const RNS_RAW = RAW('20' + 'aabb' + 'ccdd' + '1234' + '00' + '03' + 'ee'.repeat(30));

function packet(data: string, payload_type = 'Unknown'): RawPacket {
  return {
    id: 1,
    timestamp: 1700000000,
    data,
    payload_type,
    snr: null,
    rssi: null,
    decrypted: false,
    decrypted_info: null,
  };
}

const recognize = (hex: string) => recognizeThirdParty(MeshCoreDecoder.decode(hex));

describe('MeshCoreNG', () => {
  it('decodes an MCL1 Location report', () => {
    const tp = recognize(LOCATION_HEX)!;
    expect(tp.typeName).toBe('MeshCoreNG');
    expect(tp.summary).toBe('MeshCoreNG Location · node 1a2b3c4d · 52.370000, 4.890000 · NG');
    expect(tp.fields.find((f) => f.name === 'Battery')?.value).toBe('3900 mV');
  });

  it('names an Atlas position', () => {
    expect(recognize(ATLAS_HEX)?.summary).toBe('MeshCoreNG Atlas · position');
  });

  it('is a filterable feed type and shows in the header breakdown', () => {
    expect(KNOWN_PAYLOAD_TYPES).toContain('MeshCoreNG');
    expect(feedPayloadTypeName(MeshCoreDecoder.decode(LOCATION_HEX))).toBe('MeshCoreNG');
    const header = inspectRawPacket(packet(LOCATION_HEX)).packetFields.find(
      (f) => f.headerBreakdown
    )!;
    const typeField = header.headerBreakdown!.fields.find((f) => f.field === 'Payload Type')!;
    expect(typeField.value).toBe('MeshCoreNG Location (not official)');
  });

  it('rejects a wrong magic or length', () => {
    expect(recognize('3500' + ascii('MCL2') + MCL1.slice(8))).toBeNull();
    expect(recognize(LOCATION_HEX + 'aa')).toBeNull();
  });
});

describe('CubeCell discovery response', () => {
  it('is named a response, not a request', () => {
    const tp = recognize(CUBECELL_HEX)!;
    expect(tp.typeName).toBe('Control');
    expect(tp.summary).toBe(
      'Discovery response (CubeCell layout) · repeater · SNR 28 · key aabbccddeeff0011'
    );
    expect(decodePacketSummary(packet(CUBECELL_HEX)).summary).toContain('CubeCell');
  });
});

describe('RAW_CUSTOM byte-0 table', () => {
  it.each([
    [SAR_VOICE, 'MeshCore SAR voice fragment · session 01020304 · #3'],
    [SAR_IMAGE_FETCH, 'MeshCore SAR image fetch · session 01020304 · 2 missing'],
    [SAR_SWARM_ASK, 'MeshCore SAR swarm request · session 01020304'],
    [SIGURD_PING, 'SigurdOS ping · tag 00112233'],
    [SIGURD_PONG, 'SigurdOS pong · tag 00112233 · Base · -60 dBm'],
    [RNS_RAW, 'Reticulum fragment (likely) · packet 1234 · 1/3'],
  ])('labels %s', (hex, summary) => {
    expect(recognize(hex)?.summary).toBe(summary);
    expect(decodePacketSummary(packet(hex)).summary.startsWith(summary)).toBe(true);
  });

  it('leaves an unknown first byte alone', () => {
    expect(recognize(RAW('ff0102030405'))).toBeNull();
  });
});

describe('isNotEncrypted', () => {
  it('is true for FUOTA, MeshCoreNG and recognised RAW_CUSTOM, false otherwise', () => {
    const fuota =
      '3a00' +
      '01ab' +
      'deadbeef' +
      'c400' +
      '00380000' +
      '01000000' +
      '05000000' +
      '1122334455667788' +
      '047f';
    expect(isNotEncrypted(packet(fuota))).toBe(true);
    expect(isNotEncrypted(packet(LOCATION_HEX))).toBe(true);
    expect(isNotEncrypted(packet(SIGURD_PING))).toBe(true);
    expect(isNotEncrypted(packet('1500aabbcc'))).toBe(false); // GroupText
  });
});
