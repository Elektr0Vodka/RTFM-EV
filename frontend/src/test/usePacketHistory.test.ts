import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { usePacketHistory } from '../hooks/usePacketHistory';
import { api } from '../api';
import type { PacketFilters } from '../hooks/usePacketFilters';
import type { RawPacket } from '../types';

vi.mock('../api', () => ({ api: { getPacketHistory: vi.fn() } }));

const getPacketHistory = api.getPacketHistory as unknown as ReturnType<typeof vi.fn>;

// All filters enabled -> live-append accepts everything, no server filter params.
const allEnabled = {
  enabledTypes: new Set<string>(),
  enabledHopWidths: new Set<string>(),
  hexQuery: '',
  hexInvalid: false,
  allTypesEnabled: true,
  allHopWidthsEnabled: true,
} as unknown as PacketFilters;

const pkt = (id: number, timestamp: number, data = 'aa'): RawPacket =>
  ({ id, timestamp, data, payload_type: 'ADVERT', snr: null, rssi: null }) as unknown as RawPacket;

// All axes enabled but an active message search term.
const withSearch = {
  enabledTypes: new Set<string>(),
  enabledHopWidths: new Set<string>(),
  hexQuery: '',
  hexInvalid: false,
  searchTerm: 'alice',
  allTypesEnabled: true,
  allHopWidthsEnabled: true,
} as unknown as PacketFilters;

const pktDecoded = (
  id: number,
  timestamp: number,
  info: { sender?: string | null; channel_name?: string | null; message?: string | null } | null
): RawPacket =>
  ({
    id,
    timestamp,
    data: 'aa',
    payload_type: 'GROUP_DATA',
    snr: null,
    rssi: null,
    decrypted: info !== null,
    decrypted_info: info,
  }) as unknown as RawPacket;

describe('usePacketHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches on mount, stores oldest-first, exposes nextCursor', async () => {
    getPacketHistory.mockResolvedValue({
      packets: [pkt(9, 200), pkt(8, 100)], // newest-first from server
      next_cursor: 8,
    });
    const { result } = renderHook(() =>
      usePacketHistory({
        startTs: 0,
        endTs: 300,
        filters: allEnabled,
        isLive: false,
        livePackets: [],
      })
    );
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    expect(result.current.rows.map((r) => r.id)).toEqual([8, 9]); // oldest-first
    expect(result.current.nextCursor).toBe(8);
  });

  it('loadOlder prepends older rows and updates the cursor', async () => {
    getPacketHistory
      .mockResolvedValueOnce({ packets: [pkt(9, 200)], next_cursor: 9 })
      .mockResolvedValueOnce({ packets: [pkt(5, 50)], next_cursor: null });
    const { result } = renderHook(() =>
      usePacketHistory({
        startTs: 0,
        endTs: 300,
        filters: allEnabled,
        isLive: false,
        livePackets: [],
      })
    );
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(result.current.rows.map((r) => r.id)).toEqual([5, 9]);
    expect(result.current.nextCursor).toBeNull();
  });

  it('appends in-window live packets when live, deduped against loaded rows', async () => {
    getPacketHistory.mockResolvedValue({ packets: [pkt(9, 200)], next_cursor: null });
    const live = [pkt(9, 200), pkt(10, 250), pkt(11, 999)]; // 9 is dup, 11 is out of window
    const { result } = renderHook(() =>
      usePacketHistory({
        startTs: 0,
        endTs: 300,
        filters: allEnabled,
        isLive: true,
        livePackets: live,
      })
    );
    await waitFor(() => expect(result.current.rows.some((r) => r.id === 10)).toBe(true));
    const ids = result.current.rows.map((r) => r.id);
    expect(ids).toEqual([9, 10]); // dup 9 not repeated, 11 excluded (out of window)
  });

  it('live-append respects the message search term via decrypted_info', async () => {
    getPacketHistory.mockResolvedValue({ packets: [], next_cursor: null });
    const live = [
      pktDecoded(10, 100, { sender: 'Alice', channel_name: null, message: 'hi' }),
      pktDecoded(11, 110, { sender: 'Bob', channel_name: null, message: 'yo' }),
      pktDecoded(12, 120, null), // undecrypted: cannot match a search term
    ];
    const { result } = renderHook(() =>
      usePacketHistory({
        startTs: 0,
        endTs: 300,
        filters: withSearch,
        isLive: true,
        livePackets: live,
      })
    );
    await waitFor(() => expect(result.current.rows.some((r) => r.id === 10)).toBe(true));
    expect(result.current.rows.map((r) => r.id)).toEqual([10]);
  });

  it('does not live-append when not live', async () => {
    getPacketHistory.mockResolvedValue({ packets: [pkt(9, 200)], next_cursor: null });
    const { result } = renderHook(() =>
      usePacketHistory({
        startTs: 0,
        endTs: 300,
        filters: allEnabled,
        isLive: false,
        livePackets: [pkt(10, 250)],
      })
    );
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    expect(result.current.rows.map((r) => r.id)).toEqual([9]);
  });
});
