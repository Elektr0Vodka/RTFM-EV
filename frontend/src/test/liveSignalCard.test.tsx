import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { LiveSignalCard, summarizeSignal } from '../components/mynode/LiveSignalCard';
import type { RawPacket } from '../types';

const mocks = vi.hoisted(() => ({
  getNoiseFloorHistory: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks, isAbortError: () => false }));

function packet(timestamp: number, rssi: number | null, snr: number | null, type: string) {
  return {
    id: timestamp,
    timestamp,
    data: '00',
    payload_type: type,
    rssi,
    snr,
    decrypted: false,
    decrypted_info: null,
  } as RawPacket;
}

const NOW = 1_800_000_000;

describe('summarizeSignal', () => {
  it('keeps packets with an RSSI inside the window and sums them up', () => {
    const packets = [
      packet(NOW - 400, -60, 5, 'ADVERT'), // outside a 5 min window
      packet(NOW - 100, -90, -2, 'GROUP_TEXT'),
      packet(NOW - 10, -105, -8.5, 'ACK'),
      packet(NOW - 50, null, null, 'PATH'), // no RSSI
      packet(NOW - 200, -75, 3, 'ADVERT'),
    ];
    const noise = [
      { timestamp: NOW - 120, noise_floor_dbm: -118 },
      { timestamp: NOW - 60, noise_floor_dbm: -115 },
    ];
    const s = summarizeSignal(packets, noise, NOW, 300);
    expect(s.points.map((p) => p.rssi)).toEqual([-75, -90, -105]);
    expect(s.last?.rssi).toBe(-105);
    expect(s.peak).toBe(-75);
    expect(s.floor).toBe(-115);
    expect(s.margin).toBe(10);
  });

  it('has no margin without a noise floor or without packets', () => {
    expect(summarizeSignal([packet(NOW - 5, -80, 1, 'ACK')], [], NOW, 300).margin).toBeNull();
    const empty = summarizeSignal([], [{ timestamp: NOW - 30, noise_floor_dbm: -110 }], NOW, 300);
    expect(empty.last).toBeNull();
    expect(empty.peak).toBeNull();
    expect(empty.floor).toBe(-110);
    expect(empty.margin).toBeNull();
  });
});

describe('LiveSignalCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('shows the meters, the points and the noise floor line', async () => {
    mocks.getNoiseFloorHistory.mockResolvedValue([{ timestamp: NOW - 90, noise_floor_dbm: -117 }]);
    render(
      <I18nProvider>
        <LiveSignalCard
          packets={[packet(NOW - 30, -88, -3.25, 'GROUP_TEXT'), packet(NOW - 4, -97, -6, 'ACK')]}
        />
      </I18nProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('live-signal-floor')).toHaveTextContent('-117 dBm')
    );
    expect(mocks.getNoiseFloorHistory).toHaveBeenCalledWith(NOW - 300 - 120, NOW);
    expect(screen.getByTestId('live-signal-last')).toHaveTextContent('-97 dBm');
    expect(screen.getByTestId('live-signal-last')).toHaveTextContent('SNR -6 dB, 4 s ago');
    expect(screen.getByTestId('live-signal-peak')).toHaveTextContent('-88 dBm');
    expect(screen.getByTestId('live-signal-margin')).toHaveTextContent('20 dB');
    expect(screen.getByTestId('live-signal-noise-line')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'RSSI of 2 packets against the noise floor' })
    ).toBeInTheDocument();
  });

  it('says so when nothing was heard', async () => {
    mocks.getNoiseFloorHistory.mockResolvedValue([]);
    render(
      <I18nProvider>
        <LiveSignalCard packets={[]} />
      </I18nProvider>
    );
    expect(
      await screen.findByText('No packets with a signal reading in this window yet.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('live-signal-margin')).toHaveTextContent('-');
  });
});
