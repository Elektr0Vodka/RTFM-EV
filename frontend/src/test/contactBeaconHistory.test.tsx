import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { api } from '../api';
import { ContactBeaconHistorySection } from '../components/ContactInfoBody';
import type { TeamBeaconPoint, TeamBeaconsResponse } from '../types';

const ALICE = 'aa'.repeat(32);

// Identity translator: key plus params, so assertions do not depend on copy.
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const beacon = (over: Partial<TeamBeaconPoint> = {}): TeamBeaconPoint => ({
  message_id: 7,
  conversation_key: 'AB'.repeat(16),
  conversation_name: 'team',
  sender_key: ALICE,
  sender_name: 'Alice',
  outgoing: false,
  received_at: 1_790_000_000,
  sender_timestamp: null,
  kind: 'tel',
  source: 'team',
  lat: 52.0907,
  lon: 5.1214,
  radio_battery_mv: 3998,
  phone_battery_mv: null,
  phone_battery_pct: null,
  autonomous: true,
  needs_forwarding: false,
  max_path_observed: 0,
  node_count: null,
  neighbor_count: null,
  paths: null,
  ...over,
});

const respond = (beacons: TeamBeaconPoint[]): TeamBeaconsResponse => ({
  beacons,
  waypoints: [],
  scanned: beacons.length,
  truncated: false,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ContactBeaconHistorySection', () => {
  it('renders nothing for a node that never sent a beacon', async () => {
    const fetchBeacons = vi.spyOn(api, 'getTeamBeacons').mockResolvedValue(respond([]));
    render(<ContactBeaconHistorySection publicKey={ALICE} t={t} />);

    await waitFor(() => expect(fetchBeacons).toHaveBeenCalled());
    expect(fetchBeacons.mock.calls[0][0]).toEqual({ senderKey: ALICE, latestPerSender: false });
    expect(screen.queryByTestId('contact-beacons')).not.toBeInTheDocument();
  });

  it('lists the beacons with position, status and channel', async () => {
    vi.spyOn(api, 'getTeamBeacons').mockResolvedValue(respond([beacon()]));
    render(<ContactBeaconHistorySection publicKey={ALICE} t={t} />);

    const section = await screen.findByTestId('contact-beacons');
    expect(section).toHaveTextContent('contact_beacons_heading');
    expect(section).toHaveTextContent('52.09070, 5.12140');
    expect(section).toHaveTextContent('team_radio_battery {"volts":"4.00"}');
    expect(section).toHaveTextContent('team_autonomous');
    expect(section).toHaveTextContent('team');
  });

  it('jumps to the beacon message', async () => {
    const onNavigateToMessage = vi.fn();
    vi.spyOn(api, 'getTeamBeacons').mockResolvedValue(respond([beacon()]));
    render(
      <ContactBeaconHistorySection
        publicKey={ALICE}
        t={t}
        onNavigateToMessage={onNavigateToMessage}
      />
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'map_shared_locations_open_in_chat' })
    );
    expect(onNavigateToMessage).toHaveBeenCalledWith({
      id: 7,
      type: 'CHAN',
      conversation_key: 'AB'.repeat(16),
      conversation_name: 'team',
    });
  });

  it('shows the newest ten until asked for all', async () => {
    const beacons = Array.from({ length: 12 }, (_, i) =>
      beacon({ message_id: 100 - i, received_at: 1_790_000_000 - i * 60 })
    );
    vi.spyOn(api, 'getTeamBeacons').mockResolvedValue(respond(beacons));
    render(<ContactBeaconHistorySection publicKey={ALICE} t={t} />);

    await screen.findByTestId('contact-beacons');
    expect(screen.getAllByTestId('contact-beacon-row')).toHaveLength(10);

    fireEvent.click(screen.getByRole('button', { name: 'contact_beacons_show_all {"count":12}' }));
    expect(screen.getAllByTestId('contact-beacon-row')).toHaveLength(12);
  });
});
