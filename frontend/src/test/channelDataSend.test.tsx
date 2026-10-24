import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChannelInfoPane } from '../components/ChannelInfoPane';
import type { Channel, ChannelDetail } from '../types';

vi.mock('../api', () => ({
  api: {
    getChannelDetail: vi.fn(),
    sendChannelData: vi.fn(),
  },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { api } from '../api';

const KEY = 'CC'.repeat(16);
const channel: Channel = {
  key: KEY,
  name: '#data',
  is_hashtag: true,
  on_radio: false,
  last_read_at: null,
  favorite: false,
  muted: false,
};
const detail: ChannelDetail = {
  channel,
  message_counts: { last_1h: 0, last_24h: 0, last_48h: 0, last_7d: 0, all_time: 0 },
  first_message_at: null,
  unique_sender_count: 0,
  top_senders_24h: [],
  path_hash_width_24h: {
    total_packets: 0,
    single_byte: 0,
    double_byte: 0,
    triple_byte: 0,
    single_byte_pct: 0,
    double_byte_pct: 0,
    triple_byte_pct: 0,
  },
};

async function openSection() {
  vi.mocked(api.getChannelDetail).mockResolvedValue(detail);
  render(
    <ChannelInfoPane
      channelKey={KEY}
      channels={[channel]}
      onClose={() => {}}
      onToggleFavorite={() => {}}
    />
  );
  fireEvent.click(await screen.findByText('Send channel data (developers)'));
}

describe('channel data section', () => {
  it('sends the typed datagram', async () => {
    vi.mocked(api.sendChannelData).mockResolvedValue({ status: 'ok', bytes: 3 });
    await openSection();

    fireEvent.change(screen.getByLabelText('Payload (hex)'), { target: { value: '01 02 03' } });
    expect(screen.getByText('3 of 165 bytes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send on air' }));

    await waitFor(() => expect(api.sendChannelData).toHaveBeenCalledWith(KEY, 0xff00, '010203'));
  });

  it('will not send what the radio would refuse', async () => {
    await openSection();
    const send = screen.getByRole('button', { name: 'Send on air' });

    // Empty payload.
    expect(send).toBeDisabled();
    // Not hex.
    fireEvent.change(screen.getByLabelText('Payload (hex)'), { target: { value: 'zz' } });
    expect(screen.getByText('The payload is not hex.')).toBeInTheDocument();
    expect(send).toBeDisabled();
    // Too long.
    fireEvent.change(screen.getByLabelText('Payload (hex)'), {
      target: { value: '00'.repeat(166) },
    });
    expect(send).toBeDisabled();
    // Reserved data type 0.
    fireEvent.change(screen.getByLabelText('Payload (hex)'), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText('Data type (hex)'), { target: { value: '0' } });
    expect(send).toBeDisabled();
    expect(api.sendChannelData).not.toHaveBeenCalled();
  });
});
