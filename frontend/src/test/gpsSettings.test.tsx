import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GpsSettings } from '../components/settings/GpsSettings';
import { api } from '../api';
import { __resetGpsConfigCache } from '../hooks/useGpsConfig';
import type { HealthStatus } from '../types';

function health(is_meshcomod: boolean, radio_connected = true): HealthStatus {
  return {
    status: 'ok',
    radio_connected,
    radio_initializing: false,
    connection_info: 'TCP',
    radio_device_info: {
      model: 'X',
      firmware_build: 'b',
      firmware_version: 'v1.17.0',
      max_contacts: 350,
      max_channels: 40,
      is_meshcomod,
    },
    database_size_mb: 1,
  } as HealthStatus;
}

beforeEach(() => {
  vi.restoreAllMocks();
  __resetGpsConfigCache();
});

describe('GpsSettings', () => {
  it('renders nothing for meshcomod radios (handled by MeshcomodSettings)', () => {
    const getSpy = vi.spyOn(api, 'getGpsConfig');
    const { container } = render(<GpsSettings health={health(true)} />);
    expect(container).toBeEmptyDOMElement();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders nothing when the radio does not report the gps var', async () => {
    vi.spyOn(api, 'getGpsConfig').mockResolvedValue({
      gps_supported: false,
      gps_enabled: null,
      gps_interval: null,
    });
    const { container } = render(<GpsSettings health={health(false)} />);
    await waitFor(() => expect(api.getGpsConfig).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when not connected', () => {
    const getSpy = vi.spyOn(api, 'getGpsConfig');
    const { container } = render(<GpsSettings health={health(false, false)} />);
    expect(container).toBeEmptyDOMElement();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('shows the GPS toggle for a non-meshcomod radio that reports the var', async () => {
    vi.spyOn(api, 'getGpsConfig').mockResolvedValue({
      gps_supported: true,
      gps_enabled: false,
      gps_interval: 0,
    });
    render(<GpsSettings health={health(false)} />);
    expect(await screen.findByLabelText(/Enable GPS/i)).toBeInTheDocument();
  });

  it('submits gps_enabled on toggle', async () => {
    vi.spyOn(api, 'getGpsConfig').mockResolvedValue({
      gps_supported: true,
      gps_enabled: false,
      gps_interval: 0,
    });
    const patch = vi.spyOn(api, 'updateGpsConfig').mockResolvedValue({
      gps_supported: true,
      gps_enabled: true,
      gps_interval: 0,
    });
    render(<GpsSettings health={health(false)} />);
    const toggle = await screen.findByLabelText(/Enable GPS/i);
    await userEvent.click(toggle);
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ gps_enabled: true }));
  });
});
