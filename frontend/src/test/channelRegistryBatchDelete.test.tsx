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

describe('ChannelRegistryView batch delete', () => {
  it('disables the delete button when nothing is selected', () => {
    store[STORAGE_KEY] = JSON.stringify([entry({ channel: '#amsterdam' })]);
    render(<ChannelRegistryView />);

    const btn = screen.getByRole('button', { name: /delete \(0\)/i });
    expect(btn).toBeDisabled();
  });

  it('confirms then removes only the selected channels from the registry', async () => {
    store[STORAGE_KEY] = JSON.stringify([
      entry({ channel: '#amsterdam' }),
      entry({ channel: '#rotterdam' }),
      entry({ channel: '#denhaag' }),
    ]);
    render(<ChannelRegistryView />);

    // Select #amsterdam and #rotterdam.
    for (const name of ['#amsterdam', '#rotterdam']) {
      const row = screen.getByText(name).closest('div');
      const checkbox = row!.querySelector('input[type="checkbox"]')!;
      fireEvent.click(checkbox);
    }

    // Open the confirm dialog via the header button.
    fireEvent.click(screen.getByRole('button', { name: /^delete \(2\)$/i }));

    // Confirm.
    await screen.findByRole('button', { name: /^delete \(2\)$/i });
    // There are now two matching buttons (header + dialog); click the last (dialog).
    const matches = screen.getAllByRole('button', { name: /^delete \(2\)$/i });
    fireEvent.click(matches[matches.length - 1]);

    // #denhaag survives; the other two are gone.
    await waitFor(() => expect(screen.queryByText('#amsterdam')).toBeNull());
    expect(screen.queryByText('#rotterdam')).toBeNull();
    expect(screen.getByText('#denhaag')).toBeInTheDocument();

    // Persisted to localStorage.
    const persisted = JSON.parse(store[STORAGE_KEY]) as RegistryChannel[];
    expect(persisted.map((e) => e.channel)).toEqual(['#denhaag']);
  });

  it('deletes selected channels even when they are filtered out of the current view', async () => {
    store[STORAGE_KEY] = JSON.stringify([
      entry({ channel: '#amsterdam' }),
      entry({ channel: '#rotterdam' }),
    ]);
    render(<ChannelRegistryView />);

    // Select #amsterdam.
    const row = screen.getByText('#amsterdam').closest('div');
    fireEvent.click(row!.querySelector('input[type="checkbox"]')!);

    // Filter the view so #amsterdam is hidden but still selected.
    fireEvent.change(screen.getByPlaceholderText(/search channels/i), {
      target: { value: 'rotterdam' },
    });
    expect(screen.queryByText('#amsterdam')).toBeNull();

    // Delete still targets the selection (count stays 1).
    fireEvent.click(screen.getByRole('button', { name: /^delete \(1\)$/i }));
    const matches = screen.getAllByRole('button', { name: /^delete \(1\)$/i });
    fireEvent.click(matches[matches.length - 1]);

    await waitFor(() => {
      const persisted = JSON.parse(store[STORAGE_KEY]) as RegistryChannel[];
      expect(persisted.map((e) => e.channel)).toEqual(['#rotterdam']);
    });
  });
});
