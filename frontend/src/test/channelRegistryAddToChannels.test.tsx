import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import ChannelRegistryView from '../components/ChannelRegistryView';
import type { RegistryChannel } from '../lib/channelManager';

const STORAGE_KEY = 'meshcore-channel-registry';

const base: RegistryChannel = {
  channel: '#placeholder',
  category: '',
  subcategory: '',
  region: '',
  language: [],
  status: 'active',
  verified: false,
  recommended: false,
  alias_of: null,
  notes: '',
  tags: [],
  scopes: [],
  country: '',
  firstSeen: null,
  lastHeard: null,
  added: '2024-01-01',
  packets: 0,
  source: 'manual',
};

const entry = (over: Partial<RegistryChannel>): RegistryChannel => ({ ...base, ...over });

const store: Record<string, string> = {};

beforeEach(() => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => store[k] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
    store[k] = v as string;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(store)) delete store[k];
});

describe('ChannelRegistryView "Add to Channels"', () => {
  it('disables the button when nothing is selected', () => {
    store[STORAGE_KEY] = JSON.stringify([entry({ channel: '#amsterdam' })]);
    const onAddToChannels = vi.fn().mockResolvedValue(undefined);
    render(<ChannelRegistryView onAddToChannels={onAddToChannels} />);

    const btn = screen.getByRole('button', { name: /add to channels/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onAddToChannels).not.toHaveBeenCalled();
  });

  it('confirms then submits only the selected addable names', async () => {
    store[STORAGE_KEY] = JSON.stringify([
      entry({ channel: '#amsterdam' }),
      entry({ channel: '#rotterdam' }),
      entry({ channel: '#denhaag' }),
    ]);
    const onAddToChannels = vi.fn().mockResolvedValue(undefined);
    render(<ChannelRegistryView onAddToChannels={onAddToChannels} />);

    // Select the #amsterdam row via its checkbox.
    const amsterdamRow = screen.getByText('#amsterdam').closest('div');
    const amsterdamCheckbox = amsterdamRow!.querySelector('input[type="checkbox"]')!;
    fireEvent.click(amsterdamCheckbox);

    // Open the confirm dialog.
    fireEvent.click(screen.getByRole('button', { name: /add \(1\)/i }));

    // Confirm (the dialog's confirm button reads "Add (1)").
    const confirmBtn = await screen.findByRole('button', { name: /^add \(1\)$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onAddToChannels).toHaveBeenCalledTimes(1));
    expect(onAddToChannels.mock.calls[0][0]).toEqual(['#amsterdam']);
  });

  it('shows the info toast (no call) when the selection has no addable names', async () => {
    store[STORAGE_KEY] = JSON.stringify([entry({ channel: 'Public', source: 'radio' })]);
    const onAddToChannels = vi.fn().mockResolvedValue(undefined);
    render(<ChannelRegistryView onAddToChannels={onAddToChannels} />);

    const publicRow = screen.getByText('Public').closest('div');
    const publicCheckbox = publicRow!.querySelector('input[type="checkbox"]')!;
    fireEvent.click(publicCheckbox);

    fireEvent.click(screen.getByRole('button', { name: /add \(1\)/i }));

    await screen.findByText(/no hashtag channels to add/i);
    expect(onAddToChannels).not.toHaveBeenCalled();
  });
});
