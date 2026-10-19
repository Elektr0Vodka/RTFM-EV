import { describe, expect, it } from 'vitest';
import { PayloadType } from '@michaelhart/meshcore-decoder';

import {
  decodePacketSummary,
  describeCiphertextStructure,
  formatHexByHop,
  inspectRawPacket,
} from '../utils/rawPacketInspector';
import type { RawPacket } from '../types';

const FUOTA_OFFER_HEX =
  '3a00' +
  '01ab' +
  'deadbeef' +
  'c400' +
  '00380000' +
  '01000000' +
  '05000000' +
  '1122334455667788' +
  '047f';

function fuotaPacket(): RawPacket {
  return {
    id: 1,
    timestamp: 1700000000,
    data: FUOTA_OFFER_HEX,
    payload_type: 'FUOTA',
    snr: null,
    rssi: null,
    decrypted: false,
    decrypted_info: null,
  };
}

describe('FUOTA packets', () => {
  it('summarise by kind and campaign', () => {
    const summary = decodePacketSummary(fuotaPacket()).summary;
    expect(summary).toContain('FUOTA');
    expect(summary).toContain('deadbeef');
  });

  it('show FUOTA fields in the detail view', () => {
    const inspection = inspectRawPacket(fuotaPacket());
    expect(inspection.payloadTypeName).toBe('FUOTA');
    const campaign = inspection.payloadFields.find((f) => f.name === 'Campaign ID');
    expect(campaign).toBeDefined();
    expect([campaign!.startByte, campaign!.endByte]).toEqual([2, 5]);
    expect(
      inspection.payloadFields.some((f) => f.description.includes('assumed little-endian'))
    ).toBe(true);
  });
});

describe('rawPacketInspector helpers', () => {
  it('formats path hex as hop-delimited groups', () => {
    expect(formatHexByHop('A1B2C3D4E5F6', 2)).toBe('A1B2 → C3D4 → E5F6');
    expect(formatHexByHop('AABBCC', 1)).toBe('AA → BB → CC');
  });

  it('leaves non-hop-aligned hex unchanged', () => {
    expect(formatHexByHop('A1B2C3', 2)).toBe('A1B2C3');
    expect(formatHexByHop('A1B2', null)).toBe('A1B2');
  });

  it('describes undecryptable ciphertext with multiline bullets', () => {
    expect(describeCiphertextStructure(PayloadType.GroupText, 9, 'fallback')).toContain(
      '\n• Timestamp (4 bytes)'
    );
    expect(describeCiphertextStructure(PayloadType.GroupText, 9, 'fallback')).toContain(
      '\n• Flags (1 byte)'
    );
    expect(describeCiphertextStructure(PayloadType.TextMessage, 12, 'fallback')).toContain(
      '\n• Message (remaining bytes)'
    );
  });
});
