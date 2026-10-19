import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePacketFilters } from '../hooks/usePacketFilters';
import {
  getDamagedFrames,
  recordDamagedFrame,
  resetDamagedFrameStore,
} from '../stores/damagedFrameStore';
import { getRawPackets, resetRawPacketStore } from '../stores/rawPacketStore';
import type { RawPacket } from '../types';
import {
  DAMAGED_PAYLOAD_TYPE,
  isDamaged,
  rxBadFrameToRawPacket,
  withDamagedFrames,
  type RxBadFrame,
} from '../utils/damagedFrames';
import { decodePacketSummary, inspectRawPacketWithOptions } from '../utils/rawPacketInspector';
import { KNOWN_PAYLOAD_TYPES } from '../utils/rawPacketStats';
import { parseWsEvent } from '../wsEvents';

// A valid flood advert header: a damaged frame must never be read as one.
const ADVERT_LIKE = '1100' + 'ab'.repeat(100);

function frame(status: number, extra: Partial<RxBadFrame> = {}): RxBadFrame {
  return {
    id: 7,
    observation_id: 900,
    timestamp: 1000,
    data: ADVERT_LIKE,
    status,
    snr: -2.5,
    rssi: -95,
    ...extra,
  };
}

const livePacket: RawPacket = {
  id: 1,
  observation_id: 1,
  timestamp: 999,
  data: '1100',
  payload_type: 'ADVERT',
  snr: null,
  rssi: null,
  decrypted: false,
  decrypted_info: null,
};

beforeEach(() => {
  resetDamagedFrameStore();
  resetRawPacketStore();
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

describe('damaged frames', () => {
  it('turns an rx_bad_frame event into a feed row that is never decoded', () => {
    const packet = rxBadFrameToRawPacket(frame(1));
    expect(packet).toMatchObject({
      id: 7,
      observation_id: 900,
      payload_type: DAMAGED_PAYLOAD_TYPE,
      damaged_status: 1,
      decrypted: false,
      decrypted_info: null,
    });
    expect(isDamaged(packet)).toBe(true);
    expect(isDamaged(livePacket)).toBe(false);
  });

  it('summarises by status without decoding the bytes', () => {
    expect(decodePacketSummary(rxBadFrameToRawPacket(frame(1))).summary).toBe(
      'Damaged frame (CRC error)'
    );
    expect(decodePacketSummary(rxBadFrameToRawPacket(frame(2))).summary).toBe(
      'Damaged frame (header damaged)'
    );
    expect(decodePacketSummary(rxBadFrameToRawPacket(frame(3))).summary).toBe(
      'Damaged frame (read error)'
    );
  });

  it('inspects as raw frame bytes only', () => {
    const inspection = inspectRawPacketWithOptions(rxBadFrameToRawPacket(frame(1)));
    expect(inspection.decoded).toBeNull();
    expect(inspection.payloadFields).toEqual([]);
    expect(inspection.packetFields.map((f) => f.name)).toEqual(['Frame Bytes']);
    expect(inspection.packetFields[0].value).toBe(ADVERT_LIKE);
  });

  it('is a switch, not a payload type', () => {
    const types: readonly string[] = KNOWN_PAYLOAD_TYPES;
    expect(types).not.toContain(DAMAGED_PAYLOAD_TYPE);
    expect(types).not.toContain('Damaged');
  });

  it('keeps damaged frames out of the raw packet store', () => {
    recordDamagedFrame(frame(1));
    expect(getDamagedFrames()).toHaveLength(1);
    expect(getRawPackets()).toEqual([]);
  });

  it('adds damaged frames to the feed only when shown', () => {
    const damaged = [rxBadFrameToRawPacket(frame(1))];
    expect(withDamagedFrames([livePacket], damaged, false)).toEqual([livePacket]);
    expect(withDamagedFrames([livePacket], damaged, true)).toEqual([livePacket, damaged[0]]);
  });

  it('parses the WebSocket event', () => {
    const parsed = parseWsEvent(JSON.stringify({ type: 'rx_bad_frame', data: frame(2) }));
    expect(parsed.type).toBe('rx_bad_frame');
  });

  it('hides damaged frames by default and remembers the switch', () => {
    const { result } = renderHook(() => usePacketFilters());
    expect(result.current.showDamaged).toBe(false);
    expect(result.current.activeFilterCount).toBe(0);
    act(() => result.current.setShowDamaged(true));
    expect(result.current.showDamaged).toBe(true);
    expect(result.current.activeFilterCount).toBe(1);
    const again = renderHook(() => usePacketFilters());
    expect(again.result.current.showDamaged).toBe(true);
  });
});

describe('damaged frame rows', () => {
  it('show the damage, no lock and no decoded advert', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { createElement } = await import('react');
    const { RawPacketList } = await import('../components/RawPacketList');
    render(createElement(RawPacketList, { packets: [rxBadFrameToRawPacket(frame(1))] }));
    expect(screen.getByText('Damaged frame (CRC error)')).toBeInTheDocument();
    expect(screen.queryByText('Encrypted')).not.toBeInTheDocument();
    expect(screen.queryByText(/Advert/)).not.toBeInTheDocument();
  });
});
