import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChannelRegistryView from '../components/ChannelRegistryView';
import type { RegistryChannel } from '../lib/channelManager';
import type { Channel } from '../types';

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

const channel = (over: Partial<Channel>): Channel =>
  ({
    key: 'AA00',
    name: 'amsterdam',
    is_hashtag: true,
    on_radio: true,
    last_read_at: null,
    favorite: false,
    ...over,
  }) as Channel;

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

describe('ChannelRegistryView editChannelKey', () => {
  it('opens the edit modal for the channel with that key', async () => {
    store[STORAGE_KEY] = JSON.stringify([
      { ...base, channel: '#amsterdam', notes: 'existing note' },
      { ...base, channel: '#rotterdam' },
    ]);
    render(
      <ChannelRegistryView
        channels={[channel({}), channel({ key: 'BB11', name: 'rotterdam' })]}
        editChannelKey="aa00"
      />
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('#amsterdam')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('existing note')).toBeInTheDocument();
  });

  it('adds a missing non-hashtag channel to the registry, then opens it', async () => {
    store[STORAGE_KEY] = JSON.stringify([]);
    render(
      <ChannelRegistryView
        channels={[channel({ key: 'CC22', name: 'Private Club', is_hashtag: false })]}
        editChannelKey="CC22"
      />
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Private Club')).toBeInTheDocument();
    const saved = JSON.parse(store[STORAGE_KEY]) as RegistryChannel[];
    expect(saved.map((e) => e.channel)).toContain('Private Club');
  });

  it('does not open a modal without editChannelKey', () => {
    store[STORAGE_KEY] = JSON.stringify([{ ...base, channel: '#amsterdam' }]);
    render(<ChannelRegistryView channels={[channel({})]} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
