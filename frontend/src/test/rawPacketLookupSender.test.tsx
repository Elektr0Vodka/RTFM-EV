import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RawPacketInspectionPanel } from '../components/RawPacketDetailModal';
import type { AnalyzerSite, RawPacket } from '../types';

vi.mock('../components/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

const SENDER_KEY = 'ab'.repeat(32);

function makePacket(contactKey: string | null): RawPacket {
  return {
    id: 1,
    observation_id: 10,
    timestamp: 1_700_000_000,
    data: '15833fa002860ccae0eed9ca78b9ab0775d477c1f6490a398bf4edc75240',
    decrypted: contactKey !== null,
    payload_type: 'GroupText',
    rssi: -70,
    snr: 5,
    decrypted_info: contactKey
      ? {
          channel_name: null,
          sender: 'Bob',
          channel_key: null,
          contact_key: contactKey,
          sender_timestamp: null,
          message: null,
        }
      : null,
  };
}

const SITE: AnalyzerSite = {
  name: 'mc-radar',
  node_url_template: 'https://mc-radar.woodwar.com/node/{pubkey}',
};

describe('RawPacketInspectionPanel look-up-sender', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows a look-up-sender action when the packet has a sender key and a site is configured', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <RawPacketInspectionPanel
        packet={makePacket(SENDER_KEY)}
        channels={[]}
        analyzerSites={[SITE]}
      />
    );

    const button = screen.getByText('Look up sender on mc-radar');
    button.click();
    expect(openSpy).toHaveBeenCalledWith(
      `https://mc-radar.woodwar.com/node/${SENDER_KEY}`,
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('hides the action when the packet has no resolved sender key', () => {
    render(
      <RawPacketInspectionPanel packet={makePacket(null)} channels={[]} analyzerSites={[SITE]} />
    );
    expect(screen.queryByText(/Look up sender on/)).not.toBeInTheDocument();
  });

  it('hides the action when no analyzer sites are configured', () => {
    render(
      <RawPacketInspectionPanel packet={makePacket(SENDER_KEY)} channels={[]} analyzerSites={[]} />
    );
    expect(screen.queryByText(/Look up sender on/)).not.toBeInTheDocument();
  });
});
