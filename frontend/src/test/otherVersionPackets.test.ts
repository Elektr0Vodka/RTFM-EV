import { describe, expect, it } from 'vitest';
import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder';

import {
  KNOWN_PAYLOAD_TYPES,
  OTHER_VERSION_TYPE,
  feedPayloadTypeName,
  summarizeRawPacketForStats,
} from '../utils/rawPacketStats';
import { decodePacketSummary, inspectRawPacket } from '../utils/rawPacketInspector';
import { matchesPacketFilters } from '../utils/packetFilterPredicate';
import type { RawPacket } from '../types';

// Real advert (tests/fixtures/websocket_events.json "advertisement_chat_node").
// Header 0x11 = version 0, ADVERT, FLOOD.
const ADVERT_V0 =
  '1100AE92564C5C9884854F04F469BBB2BAB8871A078053AF6CF4AA2C014B18CE8A832DBF6669128E9476F36320F21D1B37FF1CF31680F50F4B17EDABCC7CF8C47D3C5E1DF3AFD0C8721EA06A8078462EF241DEF80AD6922751F206E3BB121DFB604F4146D60D913628D902602DB5F8466C696768746C657373F09FA59D';
// Same packet with header version bits = 1 (0x51). MeshCore 1.18.0 drops it.
const ADVERT_V1 = '51' + ADVERT_V0.slice(2);

function packet(data: string): RawPacket {
  return {
    id: 1,
    timestamp: 1700000000,
    data,
    payload_type: 'OTHER_VERSION',
    snr: null,
    rssi: null,
    decrypted: false,
    decrypted_info: null,
  };
}

const ALL_HOP_WIDTHS = new Set<string>();

describe('header version 1-3 packets', () => {
  it('are named OtherVersion, not their inner type', () => {
    expect(feedPayloadTypeName(MeshCoreDecoder.decode(ADVERT_V1))).toBe(OTHER_VERSION_TYPE);
    expect(feedPayloadTypeName(MeshCoreDecoder.decode(ADVERT_V0))).toBe('Advert');
  });

  it('are a filterable feed type', () => {
    expect(KNOWN_PAYLOAD_TYPES).toContain(OTHER_VERSION_TYPE);
  });

  it('show the version and inner type in the feed summary', () => {
    const summary = decodePacketSummary(packet(ADVERT_V1));
    expect(summary.summary).toBe('Other version (v2, Advert)');
    expect(summary.summary).not.toContain('Flightless');
  });

  it('report OtherVersion as the payload type in the detail view', () => {
    expect(inspectRawPacket(packet(ADVERT_V1)).payloadTypeName).toBe(OTHER_VERSION_TYPE);
  });

  it('show the payload as raw bytes, not as decoded advert fields', () => {
    const fields = inspectRawPacket(packet(ADVERT_V1)).payloadFields;
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe('Payload Bytes');
    expect(fields[0].description).toContain('header version 2');
    expect(inspectRawPacket(packet(ADVERT_V0)).payloadFields.length).toBeGreaterThan(1);
  });

  it('count as OtherVersion in the packet stats', () => {
    expect(summarizeRawPacketForStats(packet(ADVERT_V1)).payloadType).toBe(OTHER_VERSION_TYPE);
  });

  it('match only the OtherVersion type filter', () => {
    const base = {
      enabledHopWidths: ALL_HOP_WIDTHS,
      hexQuery: '',
      searchTerm: '',
      allTypesEnabled: false,
      allHopWidthsEnabled: true,
    };
    expect(
      matchesPacketFilters(
        packet(ADVERT_V1),
        { ...base, enabledTypes: new Set([OTHER_VERSION_TYPE]) },
        []
      )
    ).toBe(true);
    expect(
      matchesPacketFilters(packet(ADVERT_V1), { ...base, enabledTypes: new Set(['Advert']) }, [])
    ).toBe(false);
  });
});
