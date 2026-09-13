import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenHopUpdatePane } from '../components/settings/openhop/update/OpenHopUpdatePane';
import { api } from '../api';

class MockEventSource {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {}
  close() {}
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  vi.spyOn(api, 'getOpenHopUpdateStatus').mockResolvedValue({
    success: true,
    current_version: '1.0.6.dev10',
    latest_version: '1.0.6.dev20',
    has_update: true,
    channel: 'main',
    state: 'idle',
  });
  vi.spyOn(api, 'getOpenHopUpdateChannels').mockResolvedValue({
    success: true,
    channels: ['main', 'dev'],
    current_channel: 'main',
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('OpenHopUpdatePane', () => {
  it('shows version + update-available and requires confirm before install', async () => {
    const install = vi
      .spyOn(api, 'openHopUpdateInstall')
      .mockResolvedValue({ success: true, state: 'installing' });
    render(<OpenHopUpdatePane />);
    await waitFor(() => expect(screen.getByText(/1\.0\.6\.dev10/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /install/i }));
    // Confirm step: install not called until confirmed.
    expect(install).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(install).toHaveBeenCalledWith(false));
  });

  it('switches channel via the selector', async () => {
    const setCh = vi
      .spyOn(api, 'openHopUpdateSetChannel')
      .mockResolvedValue({ success: true, channel: 'dev' });
    render(<OpenHopUpdatePane />);
    await waitFor(() => expect(screen.getByLabelText(/channel/i)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/channel/i), 'dev');
    await waitFor(() => expect(setCh).toHaveBeenCalledWith('dev'));
  });
});
