import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MeshDiscoveryView } from '../components/MeshDiscoveryView';
import type { HealthStatus, RadioDiscoveryResponse } from '../types';

const baseHealth: HealthStatus = {
  status: 'connected',
  radio_connected: true,
  radio_initializing: false,
  connection_info: 'Serial: /dev/ttyUSB0',
  database_size_mb: 1.2,
  oldest_undecrypted_timestamp: null,
  fanout_statuses: {},
  bots_disabled: false,
};

function renderView(overrides?: {
  health?: HealthStatus | null;
  meshDiscovery?: RadioDiscoveryResponse | null;
}) {
  const onDiscoverMesh = vi.fn(async () => {});
  render(
    <MeshDiscoveryView
      health={overrides?.health === undefined ? baseHealth : overrides.health}
      meshDiscovery={overrides?.meshDiscovery ?? null}
      meshDiscoveryLoadingTarget={null}
      onDiscoverMesh={onDiscoverMesh}
    />
  );
  return { onDiscoverMesh };
}

describe('MeshDiscoveryView', () => {
  it('runs a repeater sweep', async () => {
    const { onDiscoverMesh } = renderView();

    expect(screen.getByRole('heading', { name: 'Mesh Discovery' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discover Repeaters' }));

    await waitFor(() => {
      expect(onDiscoverMesh).toHaveBeenCalledWith('repeaters');
    });
  });

  it('disables the sweep buttons when the radio is not connected', () => {
    renderView({ health: { ...baseHealth, radio_connected: false } });

    expect(screen.getByRole('button', { name: 'Discover Repeaters' })).toBeDisabled();
  });

  it('renders the last sweep results', () => {
    renderView({
      meshDiscovery: {
        target: 'all',
        duration_seconds: 8,
        results: [
          {
            public_key: '11'.repeat(32),
            name: null,
            node_type: 'repeater',
            heard_count: 2,
            local_snr: 7.5,
            local_rssi: -101,
            remote_snr: 4,
          },
        ],
      },
    });

    expect(screen.getByText('Last sweep: 1 node')).toBeInTheDocument();
    expect(screen.getByText('repeater')).toBeInTheDocument();
    expect(screen.getByText('heard 2 times')).toBeInTheDocument();
    expect(screen.getByText('8s listen window')).toBeInTheDocument();
  });
});
