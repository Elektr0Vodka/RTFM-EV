import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatHeader } from '../components/ChatHeader';
import { makeChannelChatHeaderProps } from './helpers/chatHeaderProps';
import type { AnalyzerSite, Contact, Conversation } from '../types';

const FULL_KEY = 'ab'.repeat(32);
const PREFIX_KEY = 'ab'.repeat(6); // 12 hex = prefix-only

function makeContact(publicKey: string): Contact {
  return {
    public_key: publicKey,
    name: 'Bob',
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: 0,
    last_advert: 1_700_000_000,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  };
}

const SITE: AnalyzerSite = {
  name: 'mc-radar',
  node_url_template: 'https://mc-radar.woodwar.com/node/{pubkey}',
};

function renderContactHeader(
  publicKey: string,
  analyzerSites: AnalyzerSite[],
  onOpenContactInfo = vi.fn()
) {
  const conversation: Conversation = { type: 'contact', id: publicKey, name: 'Bob' };
  const props = makeChannelChatHeaderProps({
    conversation,
    contacts: [makeContact(publicKey)],
    channels: [],
    analyzerSites,
    onOpenContactInfo,
  });
  render(<ChatHeader {...props} />);
  return { onOpenContactInfo };
}

describe('ChatHeader analyzer lookup', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the single configured site directly', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderContactHeader(FULL_KEY, [SITE]);

    screen.getByRole('button', { name: 'Look up on analyzer' }).click();
    expect(openSpy).toHaveBeenCalledWith(
      `https://mc-radar.woodwar.com/node/${FULL_KEY}`,
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('opens the contact info pane to choose when multiple sites are configured', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { onOpenContactInfo } = renderContactHeader(FULL_KEY, [
      SITE,
      { name: 'cornmeister', node_url_template: 'https://cornmeister.nl/#node?id={pubkey}' },
    ]);

    screen.getByRole('button', { name: 'Look up on analyzer' }).click();
    expect(onOpenContactInfo).toHaveBeenCalledWith(FULL_KEY);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('disables the lookup for a prefix-only contact', () => {
    renderContactHeader(PREFIX_KEY, [SITE]);
    expect(screen.getByRole('button', { name: 'Look up on analyzer' })).toBeDisabled();
  });

  it('hides the lookup when no sites are configured', () => {
    renderContactHeader(FULL_KEY, []);
    expect(screen.queryByRole('button', { name: 'Look up on analyzer' })).not.toBeInTheDocument();
  });
});
