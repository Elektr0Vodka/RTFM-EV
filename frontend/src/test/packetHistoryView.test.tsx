import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PacketHistoryView } from '../components/PacketHistoryView';
import { resetRawPacketStore } from '../stores/rawPacketStore';
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

  it('has no pause/resume control (the feed is query + manual refresh only)', async () => {
    getPacketHistory.mockResolvedValue({ packets: [row(1, 'ab')], next_cursor: null });
    render(<PacketHistoryView contacts={[]} channels={[]} />);
    await screen.findByText('AB');
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('re-queries the window when the Refresh button is clicked', async () => {
    getPacketHistory
      .mockResolvedValueOnce({ packets: [row(1, 'ab')], next_cursor: null })
      .mockResolvedValueOnce({ packets: [row(1, 'ab'), row(2, 'cd')], next_cursor: null });
    render(<PacketHistoryView contacts={[]} channels={[]} />);
    await screen.findByText('AB');
    expect(getPacketHistory).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(getPacketHistory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('CD')).toBeInTheDocument();
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
