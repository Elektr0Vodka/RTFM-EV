import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MeshRelayReceptionPanel } from '../components/MeshRelayReceptionPanel';
import type {
  RelayDetailResponse,
  RelayReceptionResponse,
} from '../components/MeshRelayReceptionPanel';
import type { TimeWindow } from '../components/meshHealthShared';

const LONG: TimeWindow = { key: '24h', label: '24h', hours: 24, autoRefresh: false };

function response(offset: number): RelayReceptionResponse {
  return {
    start_ts: 1_700_000_000,
    end_ts: 1_700_086_400,
    receptions: 300,
    total_packets: 240,
    multi_relay_packets: 40,
    packets: [
      {
        payload_hash: 'ab'.repeat(32),
        payload_type: 'GROUP_TEXT',
        route_type: 'Flood',
        first_seen: 1_700_000_100,
        last_seen: 1_700_000_110,
        copies: 1,
        relays: [
          {
            last_hop_hex: 'bb',
            count: 1,
            best_snr: 6.5,
            last_snr: 6.5,
            best_rssi: -90,
            last_rssi: -90,
            last_seen: 1_700_000_110,
            resolved_pubkey: 'bb'.repeat(32),
            resolved_name: 'Relay Bee',
            candidates: 1,
          },
        ],
        preview: null,
        message_id: null,
      },
    ],
    packet_offset: offset,
    packet_total: 120,
    relays: [
      {
        last_hop_hex: 'bbbb',
        relay_hexes: ['bbbb', 'bb'],
        receptions: 300,
        packets: 120,
        first_arrivals: 90,
        unique_packets: 80,
        best_snr: 9,
        avg_snr: 5,
        last_snr: 6.5,
        best_rssi: -80,
        avg_rssi: -95,
        last_rssi: -90,
        last_seen: 1_700_000_110,
        resolved_pubkey: 'bb'.repeat(32),
        resolved_name: 'Relay Bee',
        candidates: 1,
      },
    ],
    raw_since: 1_700_050_000,
    history_from: 1_699_999_200,
  };
}

const DETAIL: RelayDetailResponse = {
  start_ts: 1_700_000_000,
  end_ts: 1_700_086_400,
  relay_hexes: ['bb', 'bbbb'],
  bucket_seconds: 1800,
  totals: {
    receptions: 300,
    packets: 120,
    first_arrivals: 90,
    unique_packets: 80,
    window_packets: 240,
    best_snr: 9,
    avg_snr: 5,
    best_rssi: -80,
    avg_rssi: -95,
    last_seen: 1_700_000_110,
  },
  series: [
    {
      ts: 1_700_000_000,
      receptions: 3,
      packets: 2,
      first_arrivals: 1,
      avg_snr: 5,
      best_snr: 9,
      avg_rssi: -95,
      best_rssi: -80,
    },
  ],
  payload_types: [{ key: 'GROUP_TEXT', count: 250 }],
  hop_counts: [{ key: '2', count: 300 }],
  recent: [
    {
      payload_hash: 'ab'.repeat(32),
      observed_at: 1_700_000_110,
      payload_type: 'GROUP_TEXT',
      route_type: 'Flood',
      hop_count: 2,
      snr: 6.5,
      rssi: -90,
      path_hex: 'aabb',
      first: true,
      relays: 3,
      preview: 'hello mesh',
      message_id: 7,
    },
  ],
  raw_since: 1_700_050_000,
  history_from: 1_699_999_200,
};

describe('MeshRelayReceptionPanel paging and relay details', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const lastListUrl = () => listUrls()[listUrls().length - 1];
  const listUrls = () =>
    fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('relay-reception?'));

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn((url: string) => {
      const u = String(url);
      const body = u.includes('/relay-reception/relay?')
        ? DETAIL
        : response(Number(new URL(u, 'http://x').searchParams.get('offset') ?? 0));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('shows window-wide totals and the history note', async () => {
    render(<MeshRelayReceptionPanel selectedWindow={LONG} refreshKey={0} />);
    await screen.findByText('Copies received');
    expect(screen.getByText('240')).toBeInTheDocument(); // packets tile (window-wide)
    expect(screen.getByText('40')).toBeInTheDocument(); // multi-relay tile
    expect(screen.getByTestId('relay-history-note')).toBeInTheDocument();
  });

  it('pages the per-packet table and changes the page size', async () => {
    render(<MeshRelayReceptionPanel selectedWindow={LONG} refreshKey={0} />);
    const pager = await screen.findByTestId('relay-reception-pager');
    expect(listUrls()[0]).toContain('limit=50&offset=0');
    expect(within(pager).getByText('1-1 of 120')).toBeInTheDocument();

    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastListUrl()).toContain('limit=50&offset=50'));
    await waitFor(() => expect(within(pager).getByText('51-51 of 120')).toBeInTheDocument());

    fireEvent.change(within(pager).getByRole('combobox'), { target: { value: '25' } });
    await waitFor(() => expect(lastListUrl()).toContain('limit=25&offset=0'));
    expect(localStorage.getItem('rtfm-relay-reception-page-size')).toBe('25');
  });

  it('expands a relay row into its history', async () => {
    render(<MeshRelayReceptionPanel selectedWindow={LONG} refreshKey={0} />);
    const summary = await screen.findByTestId('relay-reception-summary');
    expect(within(summary).getByText('75%')).toBeInTheDocument(); // 90 of 120 first

    fireEvent.click(within(summary).getByRole('button', { name: 'Show details for Relay Bee' }));

    const detail = await screen.findByTestId('relay-detail');
    const detailUrl = fetchMock.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes('/relay-reception/relay?'));
    expect(detailUrl).toContain('relay=bbbb&relay=bb');
    expect(within(detail).getByText('First arrivals')).toBeInTheDocument();
    expect(within(detail).getByText('50% of all packets')).toBeInTheDocument();
    expect(within(detail).getByText('hello mesh')).toBeInTheDocument();
    expect(within(detail).getByText('first')).toBeInTheDocument();

    fireEvent.click(within(summary).getByRole('button', { name: 'Hide details for Relay Bee' }));
    await waitFor(() => expect(screen.queryByTestId('relay-detail')).not.toBeInTheDocument());
  });
});
