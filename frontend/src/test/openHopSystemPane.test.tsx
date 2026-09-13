import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopSystemPane } from '../components/settings/openhop/system/OpenHopSystemPane';
import { api } from '../api';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopHardware').mockResolvedValue({
    success: true,
    data: {
      cpu: { usage_percent: 12.5, count: 4, load_avg: { '1min': 0.5, '5min': 0.4, '15min': 0.3 } },
      memory: { total: 16000000000, used: 6400000000, usage_percent: 40 },
      disk: { total: 1000000000000, free: 450000000000, usage_percent: 55 },
      system: { uptime: 3600, os: 'Debian GNU/Linux 12' },
    },
  });
});

describe('OpenHopSystemPane', () => {
  it('renders hardware stat tiles from the nested live shape', async () => {
    render(<OpenHopSystemPane />);
    await waitFor(() => expect(screen.getByText(/12\.5%/)).toBeInTheDocument()); // CPU
    expect(screen.getByText(/40%/)).toBeInTheDocument(); // memory
    expect(screen.getByText(/55%/)).toBeInTheDocument(); // disk
    expect(screen.getByText(/1h 0m|1h/)).toBeInTheDocument(); // uptime
  });

  it('shows the node error when psutil data is unavailable', async () => {
    vi.spyOn(api, 'getOpenHopHardware').mockResolvedValue({
      success: false,
      error: 'Hardware stats not available (psutil may not be installed)',
    });
    render(<OpenHopSystemPane />);
    await waitFor(() => expect(screen.getByText(/psutil/i)).toBeInTheDocument());
  });
});
