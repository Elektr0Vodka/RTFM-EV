import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopConfigPane } from '../components/settings/openhop/config/OpenHopConfigPane';
import { api, ApiError } from '../api';
import type { HealthStatus } from '../types';

const oh = { radio_device_info: { is_openhop: true } } as unknown as HealthStatus;
const notOh = { radio_device_info: { is_openhop: false } } as unknown as HealthStatus;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopPresets').mockResolvedValue({ presets: [], source: 'local' });
});

describe('OpenHopConfigPane', () => {
  it('renders nothing for a non-OpenHop node', () => {
    const { container } = render(<OpenHopConfigPane health={notOh} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows configure-first on 409', async () => {
    vi.spyOn(api, 'getOpenHopConfigExport').mockRejectedValue(new ApiError('nope', 409));
    render(<OpenHopConfigPane health={oh} />);
    expect(await screen.findByText(/configure openhop management/i)).toBeInTheDocument();
  });

  it('renders the cards when configured', async () => {
    vi.spyOn(api, 'getOpenHopConfigExport').mockResolvedValue({
      success: true,
      data: { config: { repeater: { mode: 'forward' } } },
    });
    render(<OpenHopConfigPane health={oh} />);
    expect(await screen.findByText(/operating mode/i)).toBeInTheDocument();
    expect(screen.getByText(/radio parameters/i)).toBeInTheDocument();
    expect(screen.getByText(/backup and restore/i)).toBeInTheDocument();
  });
});
