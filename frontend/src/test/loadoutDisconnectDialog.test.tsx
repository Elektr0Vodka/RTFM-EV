import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { LoadoutDisconnectDialog } from '../components/settings/LoadoutDisconnectDialog';
import { api } from '../api';
import type { ChannelSet, ChannelSetApplyResult } from '../types';

vi.mock('../api', () => ({
  api: { applyChannelSet: vi.fn() },
}));

const makeSet = (id: string, name: string): ChannelSet => ({
  id,
  name,
  channels: [{ key: 'AA'.repeat(16), name: '#alpha' }],
  contacts: [],
  created_at: 1,
  updated_at: 1,
});

const sets = [makeSet('set1', 'Field kit'), makeSet('set2', 'Hike')];

const result = (failed: number): ChannelSetApplyResult => ({
  set_id: 'set2',
  items: [
    failed > 0
      ? {
          key: 'AA'.repeat(16),
          name: '#alpha',
          status: 'failed',
          slot: null,
          error: 'no_free_slot',
        }
      : { key: 'AA'.repeat(16), name: '#alpha', status: 'loaded', slot: 1, error: null },
  ],
  contact_items: [],
  loaded: failed > 0 ? 0 : 1,
  already_loaded: 0,
  failed,
});

beforeEach(() => {
  vi.clearAllMocks();
});

function renderDialog() {
  const onCancel = vi.fn();
  const onDisconnect = vi.fn();
  render(<LoadoutDisconnectDialog sets={sets} onCancel={onCancel} onDisconnect={onDisconnect} />);
  return { onCancel, onDisconnect };
}

describe('LoadoutDisconnectDialog', () => {
  it('loads the chosen loadout and disconnects when everything loaded', async () => {
    vi.mocked(api.applyChannelSet).mockResolvedValue(result(0));
    const { onDisconnect } = renderDialog();

    fireEvent.change(screen.getByLabelText('Loadout'), { target: { value: 'set2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load and disconnect' }));

    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
    expect(api.applyChannelSet).toHaveBeenCalledWith('set2');
  });

  it('shows the results and waits for confirmation when something failed', async () => {
    vi.mocked(api.applyChannelSet).mockResolvedValue(result(1));
    const { onDisconnect } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Load and disconnect' }));

    expect(await screen.findByText('Not everything loaded')).toBeInTheDocument();
    expect(screen.getByTestId('channel-set-result')).toHaveTextContent(
      '#alpha: not loaded: no free channel slot'
    );
    expect(onDisconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect anyway' }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('asks before disconnecting when the load request itself fails', async () => {
    vi.mocked(api.applyChannelSet).mockRejectedValue(new Error('Radio not connected'));
    const { onDisconnect } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Load and disconnect' }));

    expect(await screen.findByText('Radio not connected')).toBeInTheDocument();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it('disconnects without loading, or cancels', () => {
    const { onCancel, onDisconnect } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect without loading' }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(api.applyChannelSet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
