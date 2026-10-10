import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatHeader } from '../components/ChatHeader';
import type { AnalyzerSite, Contact, Conversation, PathDiscoveryResponse } from '../types';

const noop = () => {};

const baseProps = {
  channels: [],
  config: null,
  notificationsSupported: true,
  notificationsEnabled: false,
  notificationsPermission: 'granted' as const,
  onTrace: noop,
  onPathDiscovery: vi.fn(async () => {
    throw new Error('unused');
  }) as (_: string) => Promise<PathDiscoveryResponse>,
  onToggleNotifications: noop,
  onToggleFavorite: noop,
  onSetChannelFloodScopeOverride: noop,
  onDeleteChannel: noop,
  onDeleteContact: noop,
};

function makeContact(publicKey: string): Contact {
  return {
    public_key: publicKey,
    name: 'Alice',
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
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
  };
}

const FULL_KEY = 'ab'.repeat(32);
const PREFIX_KEY = 'ab'.repeat(6);
const SITE: AnalyzerSite = {
  name: 'mc-radar',
  node_url_template: 'https://mc-radar.example.com/node/{pubkey}',
};
const OTHER: AnalyzerSite = { name: 'other', node_url_template: 'https://o.example/n/{pubkey}' };

function renderHeader(
  key: string,
  analyzerSites: AnalyzerSite[] | undefined,
  onOpenContactInfo: (publicKey: string) => void = noop
) {
  const conversation: Conversation = { type: 'contact', id: key, name: 'Alice' };
  render(
    <ChatHeader
      {...baseProps}
      conversation={conversation}
      contacts={[makeContact(key)]}
      analyzerSites={analyzerSites}
      onOpenContactInfo={onOpenContactInfo}
    />
  );
}

describe('ChatHeader: look up a contact on an analyzer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is absent while no analyzer is configured', () => {
    renderHeader(FULL_KEY, []);
    expect(screen.queryByLabelText('Look up on analyzer')).not.toBeInTheDocument();
  });

  it('is absent for a channel', () => {
    render(
      <ChatHeader
        {...baseProps}
        conversation={{ type: 'channel', id: 'AA'.repeat(16), name: 'Public' }}
        contacts={[]}
        analyzerSites={[SITE]}
      />
    );
    expect(screen.queryByLabelText('Look up on analyzer')).not.toBeInTheDocument();
  });

  it('opens the only configured site in a new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderHeader(FULL_KEY, [SITE]);

    fireEvent.click(screen.getByLabelText('Look up on analyzer'));

    expect(openSpy).toHaveBeenCalledWith(
      `https://mc-radar.example.com/node/${FULL_KEY}`,
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('opens the contact info pane to choose when several sites are configured', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onOpenContactInfo = vi.fn();
    renderHeader(FULL_KEY, [SITE, OTHER], onOpenContactInfo);

    fireEvent.click(screen.getByLabelText('Look up on analyzer'));

    expect(onOpenContactInfo).toHaveBeenCalledWith(FULL_KEY);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('is disabled for a contact known by key prefix only', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderHeader(PREFIX_KEY, [SITE]);

    const button = screen.getByLabelText('Look up on analyzer');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
