import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PacketFeedStatsPanel } from '../components/PacketFeedStatsPanel';
import { resetRawPacketStore, seedRawPacketStore } from '../stores/rawPacketStore';
import type { RawPacketStatsSessionState } from '../utils/rawPacketStats';
import type { Contact, RawPacket } from '../types';

function createSession(
  overrides: Partial<RawPacketStatsSessionState> = {}
): RawPacketStatsSessionState {
  return {
    sessionStartedAt: 1_700_000_000_000,
    totalObservedPackets: 3,
    trimmedObservationCount: 0,
    observations: [
      {
        observationKey: 'obs-1',
        timestamp: 1_700_000_000,
        payloadType: 'Advert',
        routeType: 'Flood',
        decrypted: false,
        rssi: -70,
        snr: 6,
        sourceKey: 'AA11',
        sourceLabel: 'AA11',
        pathTokenCount: 1,
        pathSignature: '01',
      },
      {
        observationKey: 'obs-2',
        timestamp: 1_700_000_030,
        payloadType: 'TextMessage',
        routeType: 'Direct',
        decrypted: true,
        rssi: -66,
        snr: 7,
        sourceKey: 'BB22',
        sourceLabel: 'BB22',
        pathTokenCount: 0,
        pathSignature: null,
      },
      {
        observationKey: 'obs-3',
        timestamp: 1_700_000_050,
        payloadType: 'Ack',
        routeType: 'Direct',
        decrypted: true,
        rssi: -80,
        snr: 4,
        sourceKey: 'BB22',
        sourceLabel: 'BB22',
        pathTokenCount: 0,
        pathSignature: null,
      },
    ],
    ...overrides,
  };
}

function createContact(overrides: Partial<Contact> = {}): Contact {
  return {
    public_key: 'aa11bb22cc33' + '0'.repeat(52),
    name: 'Alpha',
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: 0,
    direct_path_hash_mode: 0,
    last_advert: 1_700_000_000,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...overrides,
  };
}

function renderPanel({
  packets = [],
  contacts = [],
  rawPacketStatsSession = createSession(),
}: {
  packets?: RawPacket[];
  contacts?: Contact[];
  rawPacketStatsSession?: RawPacketStatsSessionState;
} = {}) {
  seedRawPacketStore({ packets, statsSession: rawPacketStatsSession });
  return render(<PacketFeedStatsPanel contacts={contacts} />);
}

describe('PacketFeedStatsPanel', () => {
  beforeEach(() => {
    resetRawPacketStore();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders window controls and grouped summaries', () => {
    renderPanel();

    expect(screen.getByText('30d')).toBeInTheDocument();
    expect(screen.getByText('Packet Types')).toBeInTheDocument();
    expect(screen.getByText('Hop Byte Width')).toBeInTheDocument();
    expect(screen.getByText('Most-Heard Neighbors')).toBeInTheDocument();
    expect(screen.getByText('Traffic Timeline')).toBeInTheDocument();
  });

  it('refreshes coverage when the session snapshot updates without counter deltas', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:30Z'));

    const initialSession = createSession({
      sessionStartedAt: Date.parse('2024-01-01T00:00:00Z'),
      totalObservedPackets: 10,
      trimmedObservationCount: 1,
      observations: [
        {
          observationKey: 'obs-1',
          timestamp: 1_704_067_220,
          payloadType: 'Advert',
          routeType: 'Flood',
          decrypted: false,
          rssi: -70,
          snr: 6,
          sourceKey: 'AA11',
          sourceLabel: 'AA11',
          pathTokenCount: 1,
          pathSignature: '01',
        },
      ],
    });

    renderPanel({ rawPacketStatsSession: initialSession });

    fireEvent.click(screen.getByText('1m'));
    expect(screen.getByText(/only covered for 10 sec/i)).toBeInTheDocument();

    vi.setSystemTime(new Date('2024-01-01T00:01:10Z'));
    act(() => seedRawPacketStore({ statsSession: initialSession }));
    expect(screen.getByText(/only covered for 50 sec/i)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('resolves neighbor labels from matching contacts when identity is available', () => {
    renderPanel({
      rawPacketStatsSession: createSession({
        totalObservedPackets: 1,
        observations: [
          {
            observationKey: 'obs-1',
            timestamp: 1_700_000_000,
            payloadType: 'Advert',
            routeType: 'Flood',
            decrypted: false,
            rssi: -70,
            snr: 6,
            sourceKey: 'AA11BB22CC33',
            sourceLabel: 'AA11BB22CC33',
            pathTokenCount: 1,
            pathSignature: '01',
          },
        ],
      }),
      contacts: [createContact()],
    });

    fireEvent.click(screen.getByText('session'));
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.getByText('Strongest Neighbor')).toBeInTheDocument();
    expect(screen.getByText('-70 dBm best heard')).toBeInTheDocument();
  });

  it('marks unresolved neighbor identities explicitly', () => {
    renderPanel({
      rawPacketStatsSession: createSession({
        totalObservedPackets: 1,
        observations: [
          {
            observationKey: 'obs-1',
            timestamp: 1_700_000_000,
            payloadType: 'Advert',
            routeType: 'Flood',
            decrypted: false,
            rssi: -70,
            snr: 6,
            sourceKey: 'DEADBEEF1234',
            sourceLabel: 'DEADBEEF1234',
            pathTokenCount: 1,
            pathSignature: '01',
          },
        ],
      }),
      contacts: [],
    });

    fireEvent.click(screen.getByText('session'));
    expect(screen.getAllByText('Identity not resolvable').length).toBeGreaterThan(0);
  });

  it('collapses uniquely resolved hash buckets into the same visible contact row', () => {
    const alphaContact = createContact({
      public_key: 'aa11bb22cc33' + '0'.repeat(52),
      name: 'Alpha',
    });

    renderPanel({
      rawPacketStatsSession: createSession({
        totalObservedPackets: 2,
        observations: [
          {
            observationKey: 'obs-1',
            timestamp: 1_700_000_000,
            payloadType: 'TextMessage',
            routeType: 'Direct',
            decrypted: true,
            rssi: -70,
            snr: 6,
            sourceKey: 'hash1:AA',
            sourceLabel: 'AA',
            pathTokenCount: 0,
            pathSignature: null,
          },
          {
            observationKey: 'obs-2',
            timestamp: 1_700_000_030,
            payloadType: 'TextMessage',
            routeType: 'Direct',
            decrypted: true,
            rssi: -67,
            snr: 7,
            sourceKey: alphaContact.public_key.toUpperCase(),
            sourceLabel: alphaContact.public_key.slice(0, 12).toUpperCase(),
            pathTokenCount: 0,
            pathSignature: null,
          },
        ],
      }),
      contacts: [alphaContact],
    });

    fireEvent.click(screen.getByText('session'));

    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.queryByText('Identity not resolvable')).not.toBeInTheDocument();
  });
});
