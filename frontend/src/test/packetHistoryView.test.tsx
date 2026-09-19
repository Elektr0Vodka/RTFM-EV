import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PacketHistoryView } from '../components/PacketHistoryView';
import { resetRawPacketStore, seedRawPacketStore } from '../stores/rawPacketStore';
import { api } from '../api';

vi.mock('../api', () => ({ api: { getPacketHistory: vi.fn() } }));

const getPacketHistory = api.getPacketHistory as unknown as ReturnType<typeof vi.fn>;

const row = (id: number, data: string) => ({
  id,
  timestamp: 100 + id,
  data,
  payload_type: 'ADVERT',
  snr: null,
  rssi: null,
  decrypted: false,
  decrypted_info: null,
});

describe('PacketHistoryView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRawPacketStore();
  });

  it('fetches history on mount and renders a row', async () => {
    getPacketHistory.mockResolvedValue({ packets: [row(1, 'ab')], next_cursor: null });
    render(<PacketHistoryView contacts={[]} channels={[]} />);
    await waitFor(() => expect(getPacketHistory).toHaveBeenCalled());
    expect(await screen.findByText('AB')).toBeInTheDocument();
  });

  it('shows Load older when a cursor is returned and pages on click', async () => {
    getPacketHistory
      .mockResolvedValueOnce({ packets: [row(9, 'aa')], next_cursor: 9 })
      .mockResolvedValueOnce({ packets: [row(5, 'cc')], next_cursor: null });
    render(<PacketHistoryView contacts={[]} channels={[]} />);
    const btn = await screen.findByRole('button', { name: /load older/i });
    await userEvent.click(btn);
    await waitFor(() => expect(getPacketHistory).toHaveBeenCalledTimes(2));
  });

  it('renders the empty state when no packets are returned', async () => {
    getPacketHistory.mockResolvedValue({ packets: [], next_cursor: null });
    render(<PacketHistoryView contacts={[]} channels={[]} />);
    expect(await screen.findByText(/retention setting/i)).toBeInTheDocument();
  });

  it('pauses the live history feed, buffering new live packets behind a count', async () => {
    const now = Math.floor(Date.now() / 1000);
    getPacketHistory.mockResolvedValue({ packets: [row(1, 'ab')], next_cursor: null });
    render(<PacketHistoryView contacts={[]} channels={[]} />);
    await screen.findByText('AB');

    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));

    // A fresh live packet lands inside the live window while paused.
    act(() => {
      seedRawPacketStore({
        packets: [
          {
            id: 2,
            observation_id: 2,
            timestamp: now,
            data: 'cd',
            payload_type: 'ADVERT',
            snr: null,
            rssi: null,
            decrypted: false,
            decrypted_info: null,
          },
        ],
      });
    });

    expect(screen.queryByText('CD')).not.toBeInTheDocument();
    expect(screen.getByText('1 new')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByText('CD')).toBeInTheDocument();
  });

  it('persists the sort order via onSaveAppSettings', async () => {
    getPacketHistory.mockResolvedValue({ packets: [row(1, 'ab')], next_cursor: null });
    const onSaveAppSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <PacketHistoryView
        contacts={[]}
        channels={[]}
        packetHistorySort="oldest"
        onSaveAppSettings={onSaveAppSettings}
      />
    );
    const select = (await screen.findByLabelText(/sort/i)) as HTMLSelectElement;
    expect(select.value).toBe('oldest');
    await userEvent.selectOptions(select, 'newest');
    expect(onSaveAppSettings).toHaveBeenCalledWith({ packet_history_sort: 'newest' });
  });
});
