import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageList } from '../components/MessageList';
import { RichPayloadProvider } from '../contexts/RichPayloadContext';
import { PathHopWidthProvider } from '../contexts/PathHopWidthContext';
import { CONTACT_TYPE_CLIENT, type Message } from '../types';

const ALICE = 'aa'.repeat(32);

function channelMessage(text: string): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'chan1',
    text,
    sender_timestamp: 1000,
    received_at: 1000,
    paths: [],
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: 'Alice',
    packet_id: null,
    region: null,
  };
}

function renderList(text: string, onCoordinateClick = vi.fn(), renderRichPayloads = true) {
  render(
    <RichPayloadProvider renderRichPayloads={renderRichPayloads} setRenderRichPayloads={vi.fn()}>
      <PathHopWidthProvider showPathHopWidth={false} setShowPathHopWidth={vi.fn()}>
        <MessageList
          messages={[channelMessage(text)]}
          contacts={[]}
          loading={false}
          onCoordinateClick={onCoordinateClick}
        />
      </PathHopWidthProvider>
    </RichPayloadProvider>
  );
  return onCoordinateClick;
}

// 52.0907, 5.1214, radio 3998 mV, phone 3800 mV, needs forwarding, max path 2.
const TEL = '#TEL:Hwxo+AMNdrDSsQY';

describe('MessageList MeshCore TEAM cards', () => {
  it('renders a #TEL: beacon as a location card with its status', () => {
    const onCoordinateClick = renderList(`Alice: ${TEL}`);

    const button = screen.getByRole('button', { name: /show on map/i });
    expect(button).toHaveTextContent('🚶 Position beacon');
    const details = screen.getByTestId('team-payload-details');
    expect(details).toHaveTextContent('Radio 4.00 V');
    expect(details).toHaveTextContent('Phone 3.80 V');
    expect(details).toHaveTextContent('Needs forwarding');
    expect(details).toHaveTextContent('Max path 2');
    expect(screen.queryByText(TEL)).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(onCoordinateClick).toHaveBeenCalledWith(52.0907, 5.1214, 'Alice');
  });

  it('marks a signalk-meshcore beacon as a boat', () => {
    // 52.07, 5.14, radio byte 180, phone byte 0xFE, fwd byte 0, padded.
    renderList('Boat: #TEL:HwlAYAMQTUC0/gA=');

    expect(screen.getByRole('button', { name: /show on map/i })).toHaveTextContent(
      '⛵ Position beacon'
    );
    expect(screen.getByTestId('team-payload-details')).toHaveTextContent('via signalk-meshcore');
  });

  it('renders a beacon without a fix as a plain card', () => {
    // lat 0, lon 0, radio byte 210, phone byte 177, fwd byte 1.
    renderList('Alice: #TEL:AAAAAAAAAADSsQE');

    expect(screen.queryByRole('button', { name: /show on map/i })).not.toBeInTheDocument();
    const card = screen.getByTestId('team-payload-card');
    expect(card).toHaveTextContent('Position beacon');
    expect(card).toHaveTextContent('No GPS fix');
    expect(card).toHaveTextContent('Radio 4.00 V');
  });

  it('renders a #WAY: waypoint as a location card', () => {
    const onCoordinateClick = renderList(
      'Alice: #WAY:ab12|Camp|52.0907|5.1214|@C:FFF44336Base camp|CAMP|'
    );

    const button = screen.getByRole('button', { name: /show on map/i });
    expect(button).toHaveTextContent('⛺ Camp');
    const details = screen.getByTestId('team-payload-details');
    expect(details).toHaveTextContent('Camp');
    expect(details).toHaveTextContent('Base camp');
    expect(details).not.toHaveTextContent('@C:');

    fireEvent.click(button);
    expect(onCoordinateClick).toHaveBeenCalledWith(52.0907, 5.1214, 'Camp');
  });

  it('shows the part of a multi-part route', () => {
    renderList('Alice: #WAY:ab12|Trail|52.0|5.0||ROUTE|52.0,5.0~52.1,5.1~|1/3');

    expect(screen.getByTestId('team-payload-details')).toHaveTextContent('Route part 1 of 3');
  });

  it('renders a #WRC: route continuation', () => {
    renderList('Alice: #WRC:ab12|52.2,5.2~52.3,5.3~|2/3');

    expect(screen.getByTestId('team-payload-card')).toHaveTextContent('Route part 2 of 3');
  });

  it('renders a #CAP: capability advert', () => {
    renderList('Alice: #CAP:2:0b:a1b2c3d4e5f6:0123456789abcdef:Scout');

    const card = screen.getByTestId('team-payload-card');
    expect(card).toHaveTextContent('TEAM capabilities');
    expect(card).toHaveTextContent('Alias Scout');
    expect(card).toHaveTextContent('Custom firmware');
    expect(card).toHaveTextContent('Forwarding');
    expect(card).toHaveTextContent('Autonomous on');
  });

  it('renders a #CAP:R: advert request', () => {
    renderList('Alice: #CAP:R:-:Radio One');

    expect(screen.getByTestId('team-payload-card')).toHaveTextContent(
      'Advert request for Radio One'
    );
  });

  it('leaves a malformed payload as text', () => {
    renderList('Alice: #TEL:not-a-beacon');

    expect(screen.getByText('#TEL:not-a-beacon')).toBeInTheDocument();
    expect(screen.queryByTestId('team-payload-card')).not.toBeInTheDocument();
  });

  it('renders the card even when MeshCore Open rich payloads are off', () => {
    renderList(`Alice: ${TEL}`, vi.fn(), false);

    expect(screen.getByRole('button', { name: /show on map/i })).toHaveTextContent(
      'Position beacon'
    );
    expect(screen.queryByText(TEL)).not.toBeInTheDocument();
  });

  it('uses the vessel type set on the sending contact', () => {
    render(
      <RichPayloadProvider renderRichPayloads setRenderRichPayloads={vi.fn()}>
        <PathHopWidthProvider showPathHopWidth={false} setShowPathHopWidth={vi.fn()}>
          <MessageList
            messages={[{ ...channelMessage(`Alice: ${TEL}`), sender_key: ALICE }]}
            contacts={[
              {
                public_key: ALICE,
                name: 'Alice',
                type: CONTACT_TYPE_CLIENT,
                flags: 0,
                direct_path: null,
                direct_path_len: 0,
                direct_path_hash_mode: 0,
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
                vessel_type: 'motor',
              },
            ]}
            loading={false}
            onCoordinateClick={vi.fn()}
          />
        </PathHopWidthProvider>
      </RichPayloadProvider>
    );

    expect(screen.getByRole('button', { name: /show on map/i })).toHaveTextContent(
      '🚤 Position beacon'
    );
  });
});
