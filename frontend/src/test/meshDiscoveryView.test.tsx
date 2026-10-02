import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MeshDiscoveryView } from '../components/MeshDiscoveryView';
import type {
  HealthStatus,
  RadioAdvertMode,
  RadioDiscoveryResponse,
  RadioRegionDiscoveryResponse,
} from '../types';

const baseHealth: HealthStatus = {
  status: 'connected',
  radio_connected: true,
  radio_initializing: false,
  connection_info: 'Serial: /dev/ttyUSB0',
  database_size_mb: 1.2,
  oldest_undecrypted_timestamp: null,
  fanout_statuses: {},
};

function renderView(overrides?: {
  health?: HealthStatus | null;
  meshDiscovery?: RadioDiscoveryResponse | null;
  regionDiscovery?: RadioRegionDiscoveryResponse | null;
  seedAdded?: number;
  withAdvert?: boolean;
}) {
  const onDiscoverMesh = vi.fn(async () => {});
  const onDiscoverRegions = vi.fn(async (_publicKeys?: string[]) => {});
  const onSeedKnownRegions = vi.fn(async (_codes: string[]) => overrides?.seedAdded ?? 0);
  const onAdvertise = vi.fn(async (_mode: RadioAdvertMode) => {});
  render(
    <MeshDiscoveryView
      health={overrides?.health === undefined ? baseHealth : overrides.health}
      meshDiscovery={overrides?.meshDiscovery ?? null}
      meshDiscoveryLoadingTarget={null}
      onDiscoverMesh={onDiscoverMesh}
      onAdvertise={overrides?.withAdvert === false ? undefined : onAdvertise}
      regionDiscovery={overrides?.regionDiscovery ?? null}
      regionDiscoveryLoading={false}
      onDiscoverRegions={onDiscoverRegions}
      onSeedKnownRegions={onSeedKnownRegions}
    />
  );
  return { onDiscoverMesh, onDiscoverRegions, onSeedKnownRegions, onAdvertise };
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

  it('discovers regions using repeaters from the last mesh sweep', async () => {
    const { onDiscoverRegions } = renderView({
      meshDiscovery: {
        target: 'all',
        duration_seconds: 8,
        results: [
          {
            public_key: '11'.repeat(32),
            name: 'RPT-A',
            node_type: 'repeater',
            heard_count: 1,
            local_snr: 5,
            local_rssi: -100,
            remote_snr: 3,
          },
          {
            public_key: '22'.repeat(32),
            name: 'Sensor',
            node_type: 'sensor',
            heard_count: 1,
            local_snr: 5,
            local_rssi: -100,
            remote_snr: 3,
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Discover Regions' }));

    // Only the repeater's key is passed, not the sensor's.
    await waitFor(() => {
      expect(onDiscoverRegions).toHaveBeenCalledWith(['11'.repeat(32)]);
    });
  });

  it('disables region discovery when the radio is not connected', () => {
    renderView({ health: { ...baseHealth, radio_connected: false } });

    expect(screen.getByRole('button', { name: 'Discover Regions' })).toBeDisabled();
  });

  it('adds discovered regions to known regions', async () => {
    const { onSeedKnownRegions } = renderView({
      seedAdded: 1,
      regionDiscovery: {
        repeaters_queried: 2,
        repeaters_answered: 2,
        regions: ['nl-gr', 'de-by'],
        results: [],
      },
    });

    expect(screen.getByText('2/2 repeaters answered - 2 regions found')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add to Known Regions' }));

    await waitFor(() => {
      expect(onSeedKnownRegions).toHaveBeenCalledWith(['nl-gr', 'de-by']);
    });
  });

  it('sends a direct (zero-hop) advert from the Advert panel', async () => {
    const { onAdvertise } = renderView();

    expect(screen.getByText('Advert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Direct (0 hop)' }));

    await waitFor(() => {
      expect(onAdvertise).toHaveBeenCalledWith('zero_hop');
    });
    expect(onAdvertise).toHaveBeenCalledTimes(1);
  });

  it('sends a flood advert from the Advert panel', async () => {
    const { onAdvertise } = renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Flood advert' }));

    await waitFor(() => {
      expect(onAdvertise).toHaveBeenCalledWith('flood');
    });
    expect(onAdvertise).toHaveBeenCalledTimes(1);
  });

  it('disables the advert buttons when the radio is not connected', () => {
    renderView({ health: { ...baseHealth, radio_connected: false } });

    expect(screen.getByRole('button', { name: 'Direct (0 hop)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Flood advert' })).toBeDisabled();
  });

  it('hides the Advert panel without an advertise handler', () => {
    renderView({ withAdvert: false });

    expect(screen.queryByRole('button', { name: 'Direct (0 hop)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Flood advert' })).not.toBeInTheDocument();
  });
});
