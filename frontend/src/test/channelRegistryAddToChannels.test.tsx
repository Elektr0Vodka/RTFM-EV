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
  it('submits addable hashtag names, excluding private and non-hashtag entries', async () => {
    store[STORAGE_KEY] = JSON.stringify([
      entry({ channel: '#amsterdam' }),
      entry({ channel: '#secret', private: true }),
      entry({ channel: 'Public', source: 'radio' }),
      entry({ channel: '#rotterdam' }),
    ]);

    const onAddToChannels = vi.fn().mockResolvedValue(undefined);
    render(<ChannelRegistryView onAddToChannels={onAddToChannels} />);

    fireEvent.click(screen.getByRole('button', { name: /add to channels/i }));

    await waitFor(() => expect(onAddToChannels).toHaveBeenCalledTimes(1));
    const submitted = onAddToChannels.mock.calls[0][0] as string[];
    expect([...submitted].sort()).toEqual(['#amsterdam', '#rotterdam']);
  });
});
