import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TelemetryPane } from '../components/repeater/RepeaterTelemetryPane';
import type { RepeaterStatusResponse } from '../types';

const baseStatus: RepeaterStatusResponse = {
  battery_volts: 4.1,
  tx_queue_len: 0,
  noise_floor_dbm: -118,
  last_rssi_dbm: -82,
  last_snr_db: 6,
  packets_received: 80,
  packets_sent: 40,
  airtime_seconds: 120,
  rx_airtime_seconds: 240,
  uptime_seconds: 600,
  sent_flood: 5,
  sent_direct: 35,
  recv_flood: 7,
  recv_direct: 73,
  flood_dups: 2,
  direct_dups: 1,
  full_events: 0,
  recv_errors: null,
  telemetry_history: [],
};

const state = { loading: false, attempt: 1, error: null };

describe('TelemetryPane room-server counters', () => {
  it('shows RX airtime for repeaters', () => {
    render(<TelemetryPane data={baseStatus} state={state} onRefresh={() => {}} />);
    expect(screen.getByText('RX Airtime')).toBeInTheDocument();
    expect(screen.queryByText('Posts')).not.toBeInTheDocument();
  });

  it('shows post counters instead of RX airtime for room firmware', () => {
    render(
      <TelemetryPane
        data={{ ...baseStatus, rx_airtime_seconds: null, room_posted: 12, room_post_pushes: 3 }}
        state={state}
        onRefresh={() => {}}
      />
    );
    expect(screen.queryByText('RX Airtime')).not.toBeInTheDocument();
    expect(screen.getByText('Posts')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Post pushes')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
