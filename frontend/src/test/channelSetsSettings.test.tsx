import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ChannelSetsSettings } from '../components/settings/ChannelSetsSettings';
import { api } from '../api';
import type { Channel, ChannelSet } from '../types';

vi.mock('../api', () => ({
  api: {
    getChannelSets: vi.fn(),
    createChannelSet: vi.fn(),
    updateChannelSet: vi.fn(),
    deleteChannelSet: vi.fn(),
    applyChannelSet: vi.fn(),
  },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const KEY_A = 'AA'.repeat(16);
const KEY_B = 'BB'.repeat(16);

const channel = (key: string, name: string): Channel => ({
  key,
  name,
  is_hashtag: name.startsWith('#'),
  on_radio: false,
  last_read_at: null,
  favorite: false,
  muted: false,
});

const channels = [channel(KEY_B, '#bravo'), channel(KEY_A, '#alpha')];

const fieldKit: ChannelSet = {
  id: 'set1',
  name: 'Field kit',
  channels: [
    { key: KEY_A, name: '#alpha' },
    { key: KEY_B, name: '#bravo' },
  ],
  created_at: 1,
  updated_at: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChannelSetsSettings', () => {
  it('shows the empty state', async () => {
    vi.mocked(api.getChannelSets).mockResolvedValue([]);
    render(<ChannelSetsSettings channels={channels} />);
    expect(await screen.findByText('No channel sets yet.')).toBeInTheDocument();
  });

  it('creates a set from the selected channels in list order', async () => {
    vi.mocked(api.getChannelSets).mockResolvedValue([]);
    vi.mocked(api.createChannelSet).mockResolvedValue(fieldKit);
    render(<ChannelSetsSettings channels={channels} />);

    fireEvent.click(await screen.findByRole('button', { name: 'New channel set' }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Field kit ' } });
    fireEvent.click(screen.getByLabelText('#bravo'));
    fireEvent.click(screen.getByLabelText('#alpha'));
    fireEvent.click(save);

    await waitFor(() =>
      expect(api.createChannelSet).toHaveBeenCalledWith('Field kit', [KEY_A, KEY_B])
    );
    expect(await screen.findByText('Field kit')).toBeInTheDocument();
  });

  it('loads a set onto the radio and lists the per-channel outcome', async () => {
    vi.mocked(api.getChannelSets).mockResolvedValue([fieldKit]);
    vi.mocked(api.applyChannelSet).mockResolvedValue({
      set_id: 'set1',
      items: [
        { key: KEY_A, name: '#alpha', status: 'loaded', slot: 1, error: null },
        { key: KEY_B, name: '#bravo', status: 'failed', slot: null, error: 'no_free_slot' },
      ],
      loaded: 1,
      already_loaded: 0,
      failed: 1,
    });
    render(<ChannelSetsSettings channels={channels} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Load onto radio' }));

    const result = await screen.findByTestId('channel-set-result');
    expect(api.applyChannelSet).toHaveBeenCalledWith('set1');
    expect(result).toHaveTextContent('#alpha: loaded into slot 1');
    expect(result).toHaveTextContent('#bravo: not loaded: no free channel slot');
  });

  it('deletes a set after confirmation', async () => {
    vi.mocked(api.getChannelSets).mockResolvedValue([fieldKit]);
    vi.mocked(api.deleteChannelSet).mockResolvedValue({ deleted: 'set1' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ChannelSetsSettings channels={channels} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.deleteChannelSet).toHaveBeenCalledWith('set1'));
    expect(await screen.findByText('No channel sets yet.')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
