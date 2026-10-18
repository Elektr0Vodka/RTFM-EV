import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BatterySample, NoiseFloorSample, StatisticsResponse } from '../types';

const mocks = vi.hoisted(() => ({
  api: {
    getBatteryHistory: vi.fn(),
    getBatteryRange: vi.fn(),
    getNoiseFloorHistory: vi.fn(),
    getAirtimeRange: vi.fn(),
    getRadioIdentities: vi.fn(),
  },
}));

vi.mock('../api', () => ({ api: mocks.api }));
// The radar draws on a canvas, which jsdom does not implement.
vi.mock('../components/mynode/radar/DirectRadar', () => ({ DirectRadar: () => null }));

import MyNodeView from '../components/MyNodeView';
import { resetRawPacketStore } from '../stores/rawPacketStore';

const WINDOW_KEY = 'rtfm-mynode-window';
const NOW = Math.floor(Date.now() / 1000);

const noise = (dbm: number): NoiseFloorSample[] => [{ timestamp: NOW - 60, noise_floor_dbm: dbm }];
const battery = (mv: number): BatterySample[] => [{ timestamp: NOW - 60, battery_mv: mv }];

const config = {
  public_key: 'ab'.repeat(32),
  name: 'Test node',
  lat: 0,
  lon: 0,
  tx_power: 20,
  max_tx_power: 22,
  radio: { freq: 869.618, bw: 62.5, sf: 7, cr: 5 },
  path_hash_mode: 0,
  path_hash_mode_supported: false,
};

// The 24h stats the page loads on mount; its noise floor sample (-77 dBm) must
// not replace the samples of a restored historical window.
const stats: StatisticsResponse = {
  busiest_channels_24h: [],
  contact_count: 0,
  repeater_count: 0,
  channel_count: 0,
  total_packets: 0,
  decrypted_packets: 0,
  undecrypted_packets: 0,
  total_dms: 0,
  total_channel_messages: 0,
  total_outgoing: 0,
  contacts_heard: { last_hour: 0, last_24_hours: 0, last_week: 0 },
  repeaters_heard: { last_hour: 0, last_24_hours: 0, last_week: 0 },
  known_channels_active: { last_hour: 0, last_24_hours: 0, last_week: 0 },
  path_hash_width_24h: {
    total_packets: 0,
    single_byte: 0,
    double_byte: 0,
    triple_byte: 0,
    single_byte_pct: 0,
    double_byte_pct: 0,
    triple_byte_pct: 0,
  },
  region_scope_24h: {
    total_messages: 0,
    scoped_messages: 0,
    scoped_pct: 0,
    false_positive_floor: 0,
    total_senders: 0,
    scoped_senders: 0,
    scoped_senders_pct: 0,
  },
  packets_per_hour_72h: [],
  noise_floor_24h: {
    sample_interval_seconds: 60,
    coverage_seconds: 60,
    latest_noise_floor_dbm: -77,
    latest_timestamp: NOW - 60,
    samples: noise(-77),
  },
  mqtt_brokers: [],
};

const historicalStats = {
  start_ts: 0,
  end_ts: NOW,
  total_packets: 0,
  total_bytes: 0,
  packets_per_minute: 0,
  avg_rssi: null,
  avg_snr: null,
  best_rssi: null,
  type_counts: {},
  has_signal_data: false,
  has_type_data: false,
  neighbors_by_count: [],
  neighbors_by_signal: [],
};

// The backend always answers with bin_count bins.
const timeseriesBins = Array.from({ length: 40 }, (_, i) => ({
  start_ts: NOW - (40 - i) * 60,
  packet_count: 0,
  byte_count: 0,
}));

// The live signal card reads the same noise floor mock and shows -111 dBm too
// once its own request lands, so read the value from the window's chart only.
const noiseFloorChart = () => within(screen.getByText('Noise Floor').parentElement!);

const json = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response);

let releaseConfig: () => void;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetRawPacketStore();
  localStorage.clear();
  vi.clearAllMocks();
  // Window-scoped fetches answer at once; the page-load fetches answer later,
  // so they land after the restored window's data, as on a real refresh.
  mocks.api.getNoiseFloorHistory.mockResolvedValue(noise(-111));
  mocks.api.getBatteryRange.mockResolvedValue(battery(4100));
  mocks.api.getAirtimeRange.mockResolvedValue([]);
  mocks.api.getRadioIdentities.mockResolvedValue({ radios: [], has_unassigned_history: false });
  mocks.api.getBatteryHistory.mockResolvedValue({ samples: battery(3000) });
  const configGate = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  fetchMock = vi.fn((url: string) => {
    if (url === './api/radio/config') return configGate.then(() => json(config));
    if (url === './api/statistics') return json(stats);
    if (url === './api/health') return json({}, false);
    if (url.startsWith('./api/packets/timeseries')) return json({ bins: timeseriesBins });
    if (url.startsWith('./api/packets/historical-stats')) return json(historicalStats);
    return json({}, false);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('My Node restored time window', () => {
  it('keeps the noise floor and battery of a restored historical window after the page load', async () => {
    localStorage.setItem(WINDOW_KEY, JSON.stringify({ id: '7d', customStart: '', customEnd: '' }));
    render(<MyNodeView contacts={[]} />);

    await waitFor(() => expect(mocks.api.getBatteryRange).toHaveBeenCalled());
    await waitFor(() => expect(mocks.api.getNoiseFloorHistory).toHaveBeenCalled());
    releaseConfig();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('./api/statistics'));
    await waitFor(() => expect(noiseFloorChart().getByText(/-111 dBm/)).toBeInTheDocument());
    expect(screen.queryByText(/-77 dBm/)).not.toBeInTheDocument();
    expect(screen.getByText(/4\.10V/)).toBeInTheDocument();
    expect(screen.queryByText(/3\.00V/)).not.toBeInTheDocument();
  });

  it('still seeds the live 20m window from the page load', async () => {
    localStorage.setItem(WINDOW_KEY, JSON.stringify({ id: '20m', customStart: '', customEnd: '' }));
    render(<MyNodeView contacts={[]} />);
    releaseConfig();

    await waitFor(() => expect(screen.getByText(/-77 dBm/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/3\.00V/)).toBeInTheDocument());
  });

  it('re-applies a restored custom range on load', async () => {
    const customStart = '2026-10-01T00:00';
    const customEnd = '2026-10-02T00:00';
    const s = Math.floor(new Date(customStart).getTime() / 1000);
    const e = Math.floor(new Date(customEnd).getTime() / 1000);
    localStorage.setItem(WINDOW_KEY, JSON.stringify({ id: 'custom', customStart, customEnd }));
    render(<MyNodeView contacts={[]} />);
    releaseConfig();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `./api/packets/timeseries?start_ts=${s}&end_ts=${e}&bin_count=40`
      )
    );
    expect(mocks.api.getAirtimeRange).toHaveBeenCalledWith(s, e, 40, null);
    expect(mocks.api.getNoiseFloorHistory).toHaveBeenCalledWith(s, e, null);
    expect(mocks.api.getBatteryRange).toHaveBeenCalledWith(s, e, null);

    await waitFor(() => expect(noiseFloorChart().getByText(/-111 dBm/)).toBeInTheDocument());
    expect(screen.getByText(/4\.10V/)).toBeInTheDocument();
  });

  it('offers Share on the radar card once neighbours are known', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === './api/radio/config') return json(config);
      if (url.startsWith('./api/packets/historical-stats'))
        return json({
          ...historicalStats,
          neighbors_by_count: [
            {
              public_key: 'cd'.repeat(32),
              name: 'Alpha',
              heard_count: 3,
              first_seen: NOW - 50,
              last_seen: NOW,
              lat: 52,
              lon: 5,
              min_path_len: 0,
              best_snr: 6,
            },
          ],
        });
      if (url.startsWith('./api/packets/timeseries')) return json({ bins: timeseriesBins });
      if (url === './api/statistics') return json(stats);
      return json({}, false);
    });
    localStorage.setItem(WINDOW_KEY, JSON.stringify({ id: '7d', customStart: '', customEnd: '' }));
    render(<MyNodeView contacts={[]} />);
    expect(
      await screen.findByTitle('Share who my node hears directly as an image')
    ).toBeInTheDocument();
    // Switching to Custom with no range yet must not keep the 7d neighbours
    // under the new label (the card would show them as "Custom").
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    await waitFor(() =>
      expect(screen.queryByTitle('Share who my node hears directly as an image')).toBeNull()
    );
  });

  it('asks for the directly heard neighbours of the custom range, not all time', async () => {
    const customStart = '2026-10-01T00:00';
    const customEnd = '2026-10-02T00:00';
    const s = Math.floor(new Date(customStart).getTime() / 1000);
    const e = Math.floor(new Date(customEnd).getTime() / 1000);
    localStorage.setItem(WINDOW_KEY, JSON.stringify({ id: 'custom', customStart, customEnd }));
    render(<MyNodeView contacts={[]} />);
    releaseConfig();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `./api/packets/historical-stats?start_ts=${s}&end_ts=${e}`
      )
    );
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.startsWith('./api/packets/historical-stats?start_ts=0&'))).toBe(
      false
    );
  });
});
