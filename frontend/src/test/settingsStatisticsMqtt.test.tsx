import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsStatisticsSection } from '../components/settings/SettingsStatisticsSection';
import type { MqttBrokerStats, StatisticsResponse } from '../types';

const { getStatistics } = vi.hoisted(() => ({ getStatistics: vi.fn() }));

vi.mock('../api', () => ({
  api: { getStatistics },
}));

function makeStats(mqttBrokers: MqttBrokerStats[]): StatisticsResponse {
  const activity = { last_hour: 0, last_24_hours: 0, last_week: 0 };
  return {
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
    contacts_heard: activity,
    repeaters_heard: activity,
    known_channels_active: activity,
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
      sample_interval_seconds: 0,
      coverage_seconds: 0,
      latest_noise_floor_dbm: null,
      latest_timestamp: null,
      samples: [],
    },
    mqtt_brokers: mqttBrokers,
  };
}

describe('SettingsStatisticsSection MQTT block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a row per broker with counts', async () => {
    getStatistics.mockResolvedValue(
      makeStats([
        {
          config_id: 'a',
          name: 'Private',
          type: 'mqtt_private',
          status: 'connected',
          last_error: null,
          messages_published: 12,
          publish_failures: 1,
          reconnects: 3,
        },
      ])
    );

    render(<SettingsStatisticsSection />);

    expect(await screen.findByText('MQTT Brokers')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('hides the block when there are no brokers', async () => {
    getStatistics.mockResolvedValue(makeStats([]));

    render(<SettingsStatisticsSection />);

    // Wait for an always-present section to confirm the page rendered.
    await waitFor(() => expect(screen.getByText('Packets')).toBeInTheDocument());
    expect(screen.queryByText('MQTT Brokers')).not.toBeInTheDocument();
  });
});
