import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { RawPacketFeedView } from '../components/RawPacketFeedView';
import { resetRawPacketStore, seedRawPacketStore } from '../stores/rawPacketStore';
import type { Channel, RawPacket } from '../types';

const GROUP_TEXT_PACKET_HEX =
  '1500E69C7A89DD0AF6A2D69F5823B88F9720731E4B887C56932BF889255D8D926D99195927144323A42DD8A158F878B518B8304DF55E80501C7D02A9FFD578D3518283156BBA257BF8413E80A237393B2E4149BBBC864371140A9BBC4E23EB9BF203EF0D029214B3E3AAC3C0295690ACDB89A28619E7E5F22C83E16073AD679D25FA904D07E5ACF1DB5A7C77D7E1719FB9AE5BF55541EE0D7F59ED890E12CF0FEED6700818';

// Decodes to a path of four single-byte hop tokens -> "1 byte / hop" bucket.
const ONE_BYTE_HOP_PACKET_HEX = '09046F17C47ED00A13E16AB5B94B1CC2D1A5059C6E5A6253C60D';

const TEST_CHANNEL: Channel = {
  key: '7ABA109EDCF304A84433CB71D0F3AB73',
  name: '#six77',
  is_hashtag: true,
  on_radio: false,
  last_read_at: null,
  favorite: false,
  muted: false,
};

const COLLIDING_TEST_CHANNEL: Channel = {
  ...TEST_CHANNEL,
  name: '#collision',
};

function renderView({
  packets = [],
  channels = [],
}: {
  packets?: RawPacket[];
  channels?: Channel[];
} = {}) {
  seedRawPacketStore({ packets });
  return render(<RawPacketFeedView channels={channels} />);
}

describe('RawPacketFeedView', () => {
  beforeEach(() => {
    resetRawPacketStore();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('renders the feed without the relocated stats panel or analyze button', () => {
    renderView();

    expect(screen.getByText('Raw Packet Feed')).toBeInTheDocument();
    // Stats moved to Mesh Trends; Analyze Packet is now its own Tools view.
    expect(screen.queryByText('Packet Types')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show stats/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyze Packet' })).not.toBeInTheDocument();
  });

  it('shows an Autoscroll toggle that is ticked by default and can be unchecked', () => {
    renderView();

    const autoscroll = screen.getByLabelText('Autoscroll') as HTMLInputElement;
    expect(autoscroll.checked).toBe(true);

    fireEvent.click(autoscroll);
    expect((screen.getByLabelText('Autoscroll') as HTMLInputElement).checked).toBe(false);
  });

  describe('hex filter', () => {
    function makePacket(id: number, data: string): RawPacket {
      return {
        id,
        observation_id: id,
        timestamp: 1_700_000_000 + id,
        data,
        decrypted: false,
        payload_type: 'Unknown',
        rssi: null,
        snr: null,
        decrypted_info: null,
      };
    }

    const HEX_FILTER_LABEL = 'Filter loaded packets by hex substring';

    it('filters the feed to packets whose raw hex contains the query', () => {
      renderView({ packets: [makePacket(1, 'aa11bb22'), makePacket(2, 'cc33dd44')] });

      expect(screen.getByText('AA11BB22')).toBeInTheDocument();
      expect(screen.getByText('CC33DD44')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(HEX_FILTER_LABEL), { target: { value: 'aa11' } });

      expect(screen.getByText('AA11BB22')).toBeInTheDocument();
      expect(screen.queryByText('CC33DD44')).not.toBeInTheDocument();
      expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument();
    });

    it('normalizes 0x prefix, colons, whitespace, and case in the query', () => {
      renderView({ packets: [makePacket(1, 'aabbcc'), makePacket(2, 'ddeeff')] });

      fireEvent.change(screen.getByLabelText(HEX_FILTER_LABEL), {
        target: { value: '0xAA:BB CC' },
      });

      expect(screen.getByText('AABBCC')).toBeInTheDocument();
      expect(screen.queryByText('DDEEFF')).not.toBeInTheDocument();
    });

    it('shows a hint and matches nothing for a non-hex query', () => {
      renderView({ packets: [makePacket(1, 'aabbcc')] });

      fireEvent.change(screen.getByLabelText(HEX_FILTER_LABEL), { target: { value: 'zzz' } });

      expect(screen.getByText('Enter hex only')).toBeInTheDocument();
      expect(screen.queryByText('AABBCC')).not.toBeInTheDocument();
      expect(screen.getByText(/No packets received yet/i)).toBeInTheDocument();
    });

    it('restores the full feed when the filter is cleared', () => {
      renderView({ packets: [makePacket(1, 'aabbcc'), makePacket(2, 'ddeeff')] });

      fireEvent.change(screen.getByLabelText(HEX_FILTER_LABEL), { target: { value: 'aa' } });
      expect(screen.queryByText('DDEEFF')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Clear hex filter' }));

      expect(screen.getByText('AABBCC')).toBeInTheDocument();
      expect(screen.getByText('DDEEFF')).toBeInTheDocument();
    });
  });

  describe('hop-width filter', () => {
    const HOP_WIDTH_BUCKETS = [
      'No path',
      '1 byte / hop',
      '2 bytes / hop',
      '3 bytes / hop',
      'Unknown width',
    ];

    function makePacket(id: number, data: string, payload_type = 'Unknown'): RawPacket {
      return {
        id,
        observation_id: id,
        timestamp: 1_700_000_000 + id,
        data,
        decrypted: false,
        payload_type,
        rssi: null,
        snr: null,
        decrypted_info: null,
      };
    }

    // The type/width checkboxes now live behind the Filters button; open the
    // modal before interacting with them.
    function openFilters() {
      fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    }

    // Scope the "(only)" click to the bucket's own control group; several
    // "(only)" buttons exist (one per payload type and per hop-width bucket).
    function onlyHopWidth(bucket: string) {
      const span = screen.getByLabelText(bucket).closest('span');
      if (!span) throw new Error(`hop-width control for "${bucket}" not found`);
      fireEvent.click(within(span).getByRole('button', { name: '(only)' }));
    }

    it('renders all hop-width buckets enabled by default', () => {
      renderView({ packets: [makePacket(1, 'aabbcc')] });
      openFilters();

      expect((screen.getByLabelText('All widths') as HTMLInputElement).checked).toBe(true);
      for (const bucket of HOP_WIDTH_BUCKETS) {
        expect((screen.getByLabelText(bucket) as HTMLInputElement).checked).toBe(true);
      }
    });

    it('unchecking a bucket hides packets of that width', () => {
      renderView({ packets: [makePacket(1, 'aabbcc')] }); // undecodable -> "No path"

      expect(screen.getByText('AABBCC')).toBeInTheDocument();

      openFilters();
      fireEvent.click(screen.getByLabelText('No path'));

      expect(screen.queryByText('AABBCC')).not.toBeInTheDocument();
      expect(screen.getByText(/No packets received yet/i)).toBeInTheDocument();
    });

    it('"(only)" isolates a single width and hides the others', () => {
      renderView({ packets: [makePacket(1, 'aabbcc')] }); // "No path"

      openFilters();
      onlyHopWidth('No path');
      expect(screen.getByText('AABBCC')).toBeInTheDocument();

      onlyHopWidth('1 byte / hop');
      expect(screen.queryByText('AABBCC')).not.toBeInTheDocument();
      expect(screen.getByText(/No packets received yet/i)).toBeInTheDocument();
    });

    it('classifies a real one-byte-hop packet into the "1 byte / hop" bucket', () => {
      renderView({ packets: [makePacket(1, ONE_BYTE_HOP_PACKET_HEX, 'TextMessage')] });
      openFilters();

      // Selecting a different width hides the packet...
      onlyHopWidth('2 bytes / hop');
      expect(screen.getByText(/No packets received yet/i)).toBeInTheDocument();

      // ...and selecting its own width brings it back.
      onlyHopWidth('1 byte / hop');
      expect(screen.queryByText(/No packets received yet/i)).not.toBeInTheDocument();
    });

    it('combines with the hex filter', () => {
      renderView({ packets: [makePacket(1, 'aabbcc'), makePacket(2, 'ddeeff')] }); // both "No path"

      fireEvent.change(screen.getByLabelText('Filter loaded packets by hex substring'), {
        target: { value: 'aa' },
      });
      expect(screen.getByText('AABBCC')).toBeInTheDocument();
      expect(screen.queryByText('DDEEFF')).not.toBeInTheDocument();

      // The hex-matching packet is "No path"; isolating a hop width removes it too.
      openFilters();
      onlyHopWidth('1 byte / hop');
      expect(screen.queryByText('AABBCC')).not.toBeInTheDocument();
      expect(screen.getByText(/No packets received yet/i)).toBeInTheDocument();
    });
  });

  it('opens a packet detail modal from the raw feed and decrypts channel messages when a key is loaded', () => {
    renderView({
      packets: [
        {
          id: 1,
          observation_id: 10,
          timestamp: 1_700_000_000,
          data: GROUP_TEXT_PACKET_HEX,
          decrypted: false,
          payload_type: 'GroupText',
          rssi: -72,
          snr: 5.5,
          decrypted_info: null,
        },
      ],
      channels: [TEST_CHANNEL],
    });

    fireEvent.click(screen.getByRole('button', { name: /gt from flightless/i }));

    expect(screen.getByText('Packet Details')).toBeInTheDocument();
    expect(screen.getByText('Payload fields')).toBeInTheDocument();
    expect(screen.getByText('Full packet hex')).toBeInTheDocument();
    expect(screen.getByText('#six77')).toBeInTheDocument();
    expect(screen.getByText(/bytes · decrypted/i)).toBeInTheDocument();
    expect(screen.getAllByText(/sender: flightless/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/hello there; this hashtag room is essentially public/i)
    ).toBeInTheDocument();
  });

  it('does not guess a channel name when multiple loaded channels collide on the group hash', () => {
    renderView({
      packets: [
        {
          id: 1,
          observation_id: 10,
          timestamp: 1_700_000_000,
          data: GROUP_TEXT_PACKET_HEX,
          decrypted: false,
          payload_type: 'GroupText',
          rssi: -72,
          snr: 5.5,
          decrypted_info: null,
        },
      ],
      channels: [TEST_CHANNEL, COLLIDING_TEST_CHANNEL],
    });

    fireEvent.click(screen.getByRole('button', { name: /gt from flightless/i }));

    expect(screen.getByText(/channel hash e6/i)).toBeInTheDocument();
    expect(screen.queryByText('#six77')).not.toBeInTheDocument();
    expect(screen.queryByText('#collision')).not.toBeInTheDocument();
  });
});
