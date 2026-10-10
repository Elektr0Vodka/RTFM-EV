import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { BulkDeleteContactsModal } from '../components/settings/BulkDeleteContactsModal';
import { api } from '../api';
import { toast } from '../components/ui/sonner';
import type { Contact } from '../types';

vi.mock('../api', () => ({
  api: { bulkDeleteContacts: vi.fn() },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const contact = (over: Partial<Contact>): Contact => ({
  public_key: 'aa'.repeat(32),
  name: 'Alice',
  type: 1,
  flags: 0,
  direct_path: null,
  direct_path_len: -1,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: null,
  lon: null,
  last_seen: null,
  on_radio: true,
  favorite: false,
  radio_policy: 'auto',
  last_contacted: null,
  last_read_at: null,
  first_seen: 1700000000,
  ...over,
});

const contacts: Contact[] = [
  contact({ public_key: 'aa'.repeat(32), name: 'Alice' }),
  contact({ public_key: 'bb'.repeat(32), name: 'Bob' }),
];

async function deleteAlice() {
  render(
    <BulkDeleteContactsModal open onClose={() => {}} contacts={contacts} onDeleted={() => {}} />
  );
  const aliceRow = screen.getByText('Alice').closest('tr');
  fireEvent.click(aliceRow!.querySelector('input[type="checkbox"]')!);
  fireEvent.click(screen.getByRole('button', { name: /proceed to confirmation/i }));
  fireEvent.click(screen.getByRole('button', { name: /i confirm permanent/i }));
  await waitFor(() => expect(api.bulkDeleteContacts).toHaveBeenCalledWith(['aa'.repeat(32)]));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BulkDeleteContactsModal', () => {
  it('reports success when the radio removed every contact', async () => {
    vi.mocked(api.bulkDeleteContacts).mockResolvedValueOnce({
      deleted: 1,
      radio_deleted: 1,
      radio_failed: 0,
      radio_failures: [],
    });

    await deleteAlice();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deleted 1 contact'));
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('warns when the radio kept some of the deleted contacts', async () => {
    vi.mocked(api.bulkDeleteContacts).mockResolvedValueOnce({
      deleted: 1,
      radio_deleted: 0,
      radio_failed: 1,
      radio_failures: [{ public_key: 'aa'.repeat(32), error: 'No response from radio' }],
    });

    await deleteAlice();

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith('Deleted 1 contact', {
        description:
          '1 contact could not be removed from the radio and may come back on the next sync.',
      })
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
