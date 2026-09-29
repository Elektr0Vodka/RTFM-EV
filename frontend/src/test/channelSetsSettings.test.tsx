import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ChannelSetsSettings } from '../components/settings/ChannelSetsSettings';
import { api } from '../api';
import type { Channel, ChannelSet, Contact } from '../types';

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
  contacts: [],
  created_at: 1,
  updated_at: 1,
};

const PK_ALICE = 'a1'.repeat(32);
const PK_BOB = 'b2'.repeat(32);

const contact = (public_key: string, name: string | null): Contact => ({
  public_key,
  name,
  type: 1,
  flags: 0,
  direct_path: null,
  direct_path_len: -1,
  direct_path_hash_mode: -1,
  route_override_path: null,
  route_override_len: null,
  route_override_hash_mode: null,
  last_advert: null,
  lat: null,
  lon: null,
  last_seen: null,
  on_radio: false,
  favorite: false,
  radio_policy: 'auto',
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
});

// A prefix-only contact cannot go on the radio, so the editor leaves it out.
const contacts = [contact(PK_BOB, 'Bob'), contact(PK_ALICE, 'Alice'), contact('c3c3c3', 'Prefix')];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChannelSetsSettings', () => {
  it('shows the empty state', async () => {
    vi.mocked(api.getChannelSets).mockResolvedValue([]);
    render(<ChannelSetsSettings channels={channels} />);
    expect(await screen.findByText('No loadouts yet.')).toBeInTheDocument();
  });

  it('creates a set from the selected channels in list order', async () => {
    vi.mocked(api.getChannelSets).mockResolvedValue([]);
    vi.mocked(api.createChannelSet).mockResolvedValue(fieldKit);
    render(<ChannelSetsSettings channels={channels} />);

    fireEvent.click(await screen.findByRole('button', { name: 'New loadout' }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Field kit ' } });
    fireEvent.click(screen.getByLabelText('#bravo'));
    fireEvent.click(screen.getByLabelText('#alpha'));
    fireEvent.click(save);

    await waitFor(() =>
      expect(api.createChannelSet).toHaveBeenCalledWith('Field kit', [KEY_A, KEY_B], [])
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
      contact_items: [],
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

  it('creates a loadout with contacts only, skipping prefix-only contacts', async () => {
    vi.mocked(api.getChannelSets).mockResolvedValue([]);
    vi.mocked(api.createChannelSet).mockResolvedValue({
      ...fieldKit,
      name: 'Buddies',
      channels: [],
      contacts: [{ public_key: PK_ALICE, name: 'Alice' }],
    });
    render(<ChannelSetsSettings channels={channels} contacts={contacts} />);

    fireEvent.click(await screen.findByRole('button', { name: 'New loadout' }));
    expect(screen.queryByLabelText('Prefix')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Buddies' } });
    fireEvent.click(screen.getByLabelText('Alice'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.createChannelSet).toHaveBeenCalledWith('Buddies', [], [PK_ALICE])
    );
    expect(await screen.findByText(/1 contacts: Alice/)).toBeInTheDocument();
  });

  it('lists per-contact outcomes after loading', async () => {
    vi.mocked(api.getChannelSets).mockResolvedValue([
      { ...fieldKit, channels: [], contacts: [{ public_key: PK_ALICE, name: 'Alice' }] },
    ]);
    vi.mocked(api.applyChannelSet).mockResolvedValue({
      set_id: 'set1',
      items: [],
      contact_items: [
        { public_key: PK_ALICE, name: 'Alice', status: 'loaded', error: null },
        { public_key: PK_BOB, name: null, status: 'failed', error: 'table_full' },
      ],
      loaded: 1,
      already_loaded: 0,
      failed: 1,
    });
    render(<ChannelSetsSettings channels={channels} contacts={contacts} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Load onto radio' }));

    const result = await screen.findByTestId('channel-set-result');
    expect(result).toHaveTextContent('Alice: added to the radio');
    expect(result).toHaveTextContent(
      `${PK_BOB.slice(0, 12)}: not added: the radio's contact table is full`
    );
  });

  it('deletes a set after confirmation', async () => {
    vi.mocked(api.getChannelSets).mockResolvedValue([fieldKit]);
    vi.mocked(api.deleteChannelSet).mockResolvedValue({ deleted: 'set1' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ChannelSetsSettings channels={channels} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.deleteChannelSet).toHaveBeenCalledWith('set1'));
    expect(await screen.findByText('No loadouts yet.')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
