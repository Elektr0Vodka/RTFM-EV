import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeshcomodSettings } from '../components/settings/MeshcomodSettings';
import { api } from '../api';
import type { HealthStatus } from '../types';

function health(is_meshcomod: boolean): HealthStatus {
  return {
    status: 'ok',
    radio_connected: true,
    radio_initializing: false,
    connection_info: 'TCP',
    radio_device_info: {
      model: 'X',
      firmware_build: 'b',
      firmware_version: 'v1.17.0.4-DMC-EV-d5',
      max_contacts: 350,
      max_channels: 40,
      is_meshcomod,
    },
    database_size_mb: 1,
  } as HealthStatus;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('MeshcomodSettings', () => {
  it('renders nothing when not meshcomod', () => {
    const { container } = render(<MeshcomodSettings health={health(false)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows CAD and GPS controls when meshcomod', async () => {
    vi.spyOn(api, 'getMeshcomodConfig').mockResolvedValue({
      cad_supported: true,
      cad_enabled: true,
      gps_supported: true,
      gps_enabled: false,
      gps_interval: 0,
    });
    render(<MeshcomodSettings health={health(true)} />);
    expect(await screen.findByLabelText(/CAD/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/GPS/i)).toBeInTheDocument();
  });

  it('disables CAD when unsupported', async () => {
    vi.spyOn(api, 'getMeshcomodConfig').mockResolvedValue({
      cad_supported: false,
      cad_enabled: null,
      gps_supported: true,
      gps_enabled: false,
      gps_interval: 0,
    });
    render(<MeshcomodSettings health={health(true)} />);
    expect(await screen.findByLabelText(/CAD/i)).toBeDisabled();
  });

  it('submits cad_enabled on toggle', async () => {
    vi.spyOn(api, 'getMeshcomodConfig').mockResolvedValue({
      cad_supported: true,
      cad_enabled: true,
      gps_supported: true,
      gps_enabled: false,
      gps_interval: 0,
    });
    const patch = vi.spyOn(api, 'updateMeshcomodConfig').mockResolvedValue({
      cad_supported: true,
      cad_enabled: false,
      gps_supported: true,
      gps_enabled: false,
      gps_interval: 0,
    });
    render(<MeshcomodSettings health={health(true)} />);
    const cad = await screen.findByLabelText(/CAD/i);
    await userEvent.click(cad);
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ cad_enabled: false }));
  });
});
