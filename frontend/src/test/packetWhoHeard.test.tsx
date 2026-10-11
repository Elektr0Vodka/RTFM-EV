import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PacketWhoHeard } from '../components/PacketWhoHeard';
import type { PacketWhoHeard as PacketWhoHeardData } from '../types';

vi.mock('../api', () => ({
  api: {
    packetWhoHeard: vi.fn(),
  },
}));

import { api } from '../api';

const mockedApi = vi.mocked(api);

const HEX = '0902fcdcca0f0db91509b501d0fdf8c8951d6bdfb1b9727b';
const HASH = '00eb3a41ec998411';

function answer(overrides: Partial<PacketWhoHeardData> = {}): PacketWhoHeardData {
  return {
    packet_hash: HASH,
    analyzer_url: 'https://analyzer.example',
    links: [],
    looked_up: false,
    found: false,
    observation_count: 0,
    observer_count: 0,
    truncated: false,
    observers: [],
    ...overrides,
  };
}

describe('PacketWhoHeard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the hash without asking the analyzer', async () => {
    mockedApi.packetWhoHeard.mockResolvedValue(answer());

    render(<PacketWhoHeard packetHex={HEX} />);

    expect(await screen.findByText(HASH)).toBeInTheDocument();
    // Opening the inspector only hashes locally: one call, without lookup.
    expect(mockedApi.packetWhoHeard).toHaveBeenCalledTimes(1);
    expect(mockedApi.packetWhoHeard).toHaveBeenCalledWith(HEX);
    expect(screen.getByRole('button', { name: 'Ask analyzer.example' })).toBeInTheDocument();
    expect(
      screen.getByText(/sends this packet's hash, not its content, to analyzer\.example/)
    ).toBeInTheDocument();
  });

  it('links to the packet page of each analyzer site that has one', async () => {
    mockedApi.packetWhoHeard.mockResolvedValue(
      answer({ links: [{ name: 'EU Analyzer', url: `https://a.example/#/packets/${HASH}` }] })
    );

    render(<PacketWhoHeard packetHex={HEX} />);

    const link = await screen.findByRole('link', { name: 'Open in EU Analyzer' });
    expect(link).toHaveAttribute('href', `https://a.example/#/packets/${HASH}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('asks only on the button and lists the observers', async () => {
    mockedApi.packetWhoHeard.mockResolvedValueOnce(answer()).mockResolvedValueOnce(
      answer({
        looked_up: true,
        found: true,
        observation_count: 3,
        observer_count: 2,
        observers: [
          {
            observer_id: 'aa'.repeat(32),
            observer_name: 'NL-Obs One',
            region: 'AMS',
            heard_at: 1791665908,
            rssi: -31,
            snr: 12.25,
          },
          {
            observer_id: 'bb'.repeat(32),
            observer_name: null,
            region: null,
            heard_at: 1791665909.5,
            rssi: null,
            snr: null,
          },
          {
            observer_id: null,
            observer_name: null,
            region: 'EIN',
            heard_at: null,
            rssi: -90,
            snr: -4,
          },
        ],
      })
    );

    render(<PacketWhoHeard packetHex={HEX} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask analyzer.example' }));

    expect(await screen.findByText('Receptions: 3 · Observers: 2')).toBeInTheDocument();
    expect(mockedApi.packetWhoHeard).toHaveBeenLastCalledWith(HEX, true);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('NL-Obs One');
    expect(rows[0]).toHaveTextContent('AMS');
    expect(rows[0]).toHaveTextContent('(+0.0 s)');
    expect(rows[0]).toHaveTextContent('-31');
    expect(rows[0]).toHaveTextContent('12.3');
    // No name: the start of the observer key. Heard 1.5 s after the first.
    expect(rows[1]).toHaveTextContent('bbbbbbbbbbbb');
    expect(rows[1]).toHaveTextContent('(+1.5 s)');
    // Neither name nor key.
    expect(rows[2]).toHaveTextContent('Unknown observer');
    expect(rows[2]).toHaveTextContent('-4.0');
    // The privacy hint has done its job once the question is asked.
    expect(screen.queryByText(/sends this packet's hash/)).not.toBeInTheDocument();
  });

  it('says so when the analyzer does not know the packet', async () => {
    mockedApi.packetWhoHeard
      .mockResolvedValueOnce(answer())
      .mockResolvedValueOnce(answer({ looked_up: true, found: false }));

    render(<PacketWhoHeard packetHex={HEX} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask analyzer.example' }));

    expect(
      await screen.findByText(/analyzer\.example has not seen this packet/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('notes a shortened list', async () => {
    mockedApi.packetWhoHeard.mockResolvedValueOnce(answer()).mockResolvedValueOnce(
      answer({
        looked_up: true,
        found: true,
        observation_count: 900,
        observer_count: 1,
        truncated: true,
        observers: [
          {
            observer_id: 'aa'.repeat(32),
            observer_name: 'Obs',
            region: null,
            heard_at: 1791665908,
            rssi: -31,
            snr: 1,
          },
        ],
      })
    );

    render(<PacketWhoHeard packetHex={HEX} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask analyzer.example' }));

    expect(await screen.findByText('Showing the first 1.')).toBeInTheDocument();
  });

  it('shows the reason when the analyzer cannot be asked, and lets you retry', async () => {
    mockedApi.packetWhoHeard
      .mockResolvedValueOnce(answer())
      .mockRejectedValueOnce(new Error('Could not reach analyzer: boom'));

    render(<PacketWhoHeard packetHex={HEX} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask analyzer.example' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not ask the analyzer: Could not reach analyzer: boom'
    );
    expect(screen.getByRole('button', { name: 'Ask analyzer.example' })).toBeEnabled();
  });

  it('stays hidden for data the server cannot hash', async () => {
    mockedApi.packetWhoHeard.mockRejectedValue(new Error('Not a MeshCore packet'));

    const { container } = render(<PacketWhoHeard packetHex="zz" />);

    await waitFor(() => expect(mockedApi.packetWhoHeard).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('starts over for another packet', async () => {
    mockedApi.packetWhoHeard
      .mockResolvedValueOnce(answer())
      .mockResolvedValueOnce(answer({ packet_hash: 'ffffffffffffffff' }));

    const { rerender } = render(<PacketWhoHeard packetHex={HEX} />);
    expect(await screen.findByText(HASH)).toBeInTheDocument();

    rerender(<PacketWhoHeard packetHex="1500" />);

    expect(await screen.findByText('ffffffffffffffff')).toBeInTheDocument();
    expect(screen.queryByText(HASH)).not.toBeInTheDocument();
    expect(mockedApi.packetWhoHeard).toHaveBeenLastCalledWith('1500');
  });
});
