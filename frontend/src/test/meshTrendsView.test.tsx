import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StatisticsResponse } from '../types';

const mocks = vi.hoisted(() => ({
  api: {
    getStatistics: vi.fn(),
    getRawFeedStats: vi.fn(),
  },
}));

vi.mock('../api', () => ({ api: mocks.api }));

import { MeshTrendsView } from '../components/MeshTrendsView';
import { resetRawPacketStore } from '../stores/rawPacketStore';

const mockStats: StatisticsResponse = {
  busiest_channels_24h: [
    { channel_key: 'AA'.repeat(16), channel_name: 'general', message_count: 42 },
  ],
  contact_count: 10,
  repeater_count: 3,
  channel_count: 5,
  total_packets: 200,
  decrypted_packets: 150,
  undecrypted_packets: 50,
  total_dms: 25,
  total_channel_messages: 80,
  total_outgoing: 12,
  contacts_heard: { last_hour: 1, last_24_hours: 4, last_week: 9 },
  repeaters_heard: { last_hour: 0, last_24_hours: 2, last_week: 3 },
  known_channels_active: { last_hour: 1, last_24_hours: 3, last_week: 5 },
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
    sample_interval_seconds: 300,
    coverage_seconds: 0,
    latest_noise_floor_dbm: null,
    latest_timestamp: null,
    samples: [],
  },
  mqtt_brokers: [
    {
      config_id: 'broker-1',
      name: 'eu.broker',
      type: 'mqtt_community',
      status: 'connected',
      last_error: null,
      messages_published: 5,
      publish_failures: 0,
      reconnects: 1,
    },
  ],
};

describe('MeshTrendsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRawPacketStore();
    mocks.api.getStatistics.mockResolvedValue(mockStats);
    mocks.api.getRawFeedStats.mockResolvedValue(null);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('defaults to the Historical tab and renders server statistics including the MQTT block', async () => {
    render(<MeshTrendsView contacts={[]} />);

    expect(screen.getByRole('tab', { name: /Historical/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await waitFor(() => expect(mocks.api.getStatistics).toHaveBeenCalled());
    expect(await screen.findByText('Network')).toBeInTheDocument();
    // MQTT per-broker stats now live on this page, not in Settings.
    expect(screen.getByText('eu.broker')).toBeInTheDocument();
  });

  it('switches to the Live tab and shows session packet stats', async () => {
    render(<MeshTrendsView contacts={[]} />);

    fireEvent.click(screen.getByRole('tab', { name: /Live/ }));

    expect(screen.getByRole('tab', { name: /Live/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Packet Types')).toBeInTheDocument();
    expect(screen.getByText('Traffic Timeline')).toBeInTheDocument();
  });

  it('persists the selected tab to localStorage', async () => {
    render(<MeshTrendsView contacts={[]} />);

    fireEvent.click(screen.getByRole('tab', { name: /Live/ }));
    expect(localStorage.getItem('rtfm-mesh-trends-tab')).toBe('live');
  });
});
