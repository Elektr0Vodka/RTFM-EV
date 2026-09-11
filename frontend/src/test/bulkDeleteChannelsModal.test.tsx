import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { BulkDeleteChannelsModal } from '../components/settings/BulkDeleteChannelsModal';
import { api } from '../api';
import type { Channel } from '../types';

vi.mock('../api', () => ({
  api: { bulkDeleteChannels: vi.fn().mockResolvedValue({ deleted: 1, skipped: [] }) },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const PUBLIC_KEY = '8B3387E9C5CDEA6AC9E5EDBAA115CD72';

const channel = (over: Partial<Channel>): Channel => ({
  key: 'AA'.repeat(16),
  name: '#alpha',
  is_hashtag: true,
  on_radio: false,
  last_read_at: null,
  favorite: false,
  muted: false,
  ...over,
});

const channels: Channel[] = [
  channel({ key: 'AA'.repeat(16), name: '#alpha' }),
  channel({ key: 'BB'.repeat(16), name: '#bravo' }),
  channel({ key: PUBLIC_KEY, name: 'Public', is_hashtag: false }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BulkDeleteChannelsModal', () => {
  it('excludes the canonical Public channel from the list', () => {
    render(
      <BulkDeleteChannelsModal open onClose={() => {}} channels={channels} onDeleted={() => {}} />
    );
    expect(screen.getByText('#alpha')).toBeInTheDocument();
    expect(screen.queryByText('Public')).not.toBeInTheDocument();
  });

  it('deletes the selected channels and reports back', async () => {
    const onDeleted = vi.fn();
    render(
      <BulkDeleteChannelsModal open onClose={() => {}} channels={channels} onDeleted={onDeleted} />
    );

    const alphaRow = screen.getByText('#alpha').closest('tr');
    fireEvent.click(alphaRow!.querySelector('input[type="checkbox"]')!);

    fireEvent.click(screen.getByRole('button', { name: /proceed to confirmation/i }));
    fireEvent.click(screen.getByRole('button', { name: /i confirm removal/i }));

    await waitFor(() => expect(api.bulkDeleteChannels).toHaveBeenCalledWith(['AA'.repeat(16)]));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(['AA'.repeat(16)]));
  });
});
