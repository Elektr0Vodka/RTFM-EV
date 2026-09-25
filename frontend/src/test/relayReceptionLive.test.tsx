import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeshRelayReceptionPanel } from '../components/MeshRelayReceptionPanel';
import type { TimeWindow } from '../components/meshHealthShared';
import { recordRawPacket, resetRawPacketStore } from '../stores/rawPacketStore';
import type { RawPacket } from '../types';

const EMPTY = { start_ts: 0, end_ts: 1, receptions: 0, packets: [], relays: [] };

const SHORT: TimeWindow = { key: '1h', label: '1h', hours: 1, autoRefresh: true };
const LONG: TimeWindow = { key: '24h', label: '24h', hours: 24, autoRefresh: false };

let observation = 0;
function packet(relay: boolean): RawPacket {
  observation += 1;
  return {
    id: observation,
    observation_id: observation,
    timestamp: 1_700_000_000,
    data: '15',
    payload_type: 'GROUP_TEXT',
    snr: 5,
    rssi: -90,
    decrypted: false,
    decrypted_info: null,
    relay_reception: relay,
    last_hop_hex: relay ? 'bb' : null,
  };
}

describe('MeshRelayReceptionPanel live refresh (raw_packet WS)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const relayFetches = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('relay-reception')).length;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetRawPacketStore();
    fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(EMPTY) } as Response)
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-fetches once per burst of recorded flood copies, not for other packets', async () => {
    render(<MeshRelayReceptionPanel selectedWindow={SHORT} refreshKey={0} />);
    await screen.findByText('Copies received');
    expect(relayFetches()).toBe(1);

    act(() => recordRawPacket(packet(false)));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(relayFetches()).toBe(1);

    act(() => {
      recordRawPacket(packet(true));
      recordRawPacket(packet(true));
      recordRawPacket(packet(true));
    });
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(relayFetches()).toBe(2);
  });

  it('polls every 30 s as a fallback when no packet arrives', async () => {
    render(<MeshRelayReceptionPanel selectedWindow={SHORT} refreshKey={0} />);
    await screen.findByText('Copies received');
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(relayFetches()).toBe(2);
  });

  it('stays manual on long windows', async () => {
    render(<MeshRelayReceptionPanel selectedWindow={LONG} refreshKey={0} />);
    await screen.findByText('Copies received');
    act(() => recordRawPacket(packet(true)));
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(relayFetches()).toBe(1);
  });
});
