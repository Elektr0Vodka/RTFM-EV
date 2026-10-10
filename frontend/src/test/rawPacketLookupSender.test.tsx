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
  node_url_template: 'https://mc-radar.example.com/node/{pubkey}',
};

describe('RawPacketInspectionPanel: look up the sender on an analyzer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the sender on the configured site in a new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <RawPacketInspectionPanel
        packet={makePacket(SENDER_KEY)}
        channels={[]}
        analyzerSites={[SITE]}
      />
    );

    screen.getByRole('button', { name: 'Look up sender on mc-radar' }).click();

    expect(openSpy).toHaveBeenCalledWith(
      `https://mc-radar.example.com/node/${SENDER_KEY}`,
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('offers one action per configured site', () => {
    render(
      <RawPacketInspectionPanel
        packet={makePacket(SENDER_KEY)}
        channels={[]}
        analyzerSites={[SITE, { name: 'other', node_url_template: 'https://o.example/n/{pubkey}' }]}
      />
    );

    expect(screen.getAllByRole('button', { name: /Look up sender on/ })).toHaveLength(2);
  });

  it('leaves out a site whose address is not usable', () => {
    render(
      <RawPacketInspectionPanel
        packet={makePacket(SENDER_KEY)}
        channels={[]}
        analyzerSites={[{ name: 'bad', node_url_template: 'javascript:alert({pubkey})' }]}
      />
    );

    expect(screen.queryByRole('button', { name: /Look up sender on/ })).not.toBeInTheDocument();
  });

  it('has no action when the packet did not resolve to a sender key', () => {
    render(
      <RawPacketInspectionPanel packet={makePacket(null)} channels={[]} analyzerSites={[SITE]} />
    );

    expect(screen.queryByRole('button', { name: /Look up sender on/ })).not.toBeInTheDocument();
  });

  it('has no action when no analyzer is configured', () => {
    render(<RawPacketInspectionPanel packet={makePacket(SENDER_KEY)} channels={[]} />);

    expect(screen.queryByRole('button', { name: /Look up sender on/ })).not.toBeInTheDocument();
  });
});
