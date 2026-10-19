import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeshcomodSettings } from '../components/settings/MeshcomodSettings';
import { api } from '../api';
import { __resetMeshcomodConfigCache } from '../hooks/useMeshcomodConfig';
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
  __resetMeshcomodConfigCache();
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

describe('MeshcomodSettings Full capture', () => {
  const base = {
    cad_supported: true,
    cad_enabled: false,
    gps_supported: false,
    gps_enabled: null,
    gps_interval: null,
  };

  it('says so when the firmware has no Full capture', async () => {
    vi.spyOn(api, 'getMeshcomodConfig').mockResolvedValue({
      ...base,
      full_capture_supported: false,
      full_capture_flags: 0,
      rx_ring_drops: 0,
    });
    render(<MeshcomodSettings health={health(true)} />);
    expect(
      await screen.findByText('This firmware does not support Full capture')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Over-long frames/)).not.toBeInTheDocument();
  });

  it('toggles a kind of frame by its bit', async () => {
    vi.spyOn(api, 'getMeshcomodConfig').mockResolvedValue({
      ...base,
      full_capture_supported: true,
      full_capture_flags: 2,
      rx_ring_drops: 0,
    });
    const patch = vi.spyOn(api, 'updateMeshcomodConfig').mockResolvedValue({ ...base });
    render(<MeshcomodSettings health={health(true)} />);
    expect(await screen.findByLabelText(/Damaged frames/)).toBeChecked();
    await userEvent.click(screen.getByLabelText(/Over-long frames/));
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ full_capture_flags: 3 }));
  });

  it('shows the lost-frame count when counting is on', async () => {
    vi.spyOn(api, 'getMeshcomodConfig').mockResolvedValue({
      ...base,
      full_capture_supported: true,
      full_capture_flags: 4,
      rx_ring_drops: 17,
    });
    render(<MeshcomodSettings health={health(true)} />);
    expect(await screen.findByText('Lost since connect: 17')).toBeInTheDocument();
  });
});
