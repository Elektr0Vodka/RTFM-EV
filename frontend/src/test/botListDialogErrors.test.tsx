import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotList } from '../types';

const mocks = vi.hoisted(() => ({
  getBotListEntries: vi.fn(),
  setBotListEntries: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../api', () => ({ api: mocks }));
vi.mock('../components/ui/sonner', () => ({ toast: { error: mocks.toastError } }));

import { BotListDialog } from '../components/settings/BotListDialog';

const LIST: BotList = {
  id: 3,
  name: 'Mine',
  description: '',
  source: 'local',
  url: null,
  enabled: false,
  block_forward: false,
  file_updated: null,
  fetched_at: null,
  last_error: null,
  created_at: 1,
  entry_count: 1,
  review_count: 0,
};

async function saveWith(rejection: Error) {
  mocks.getBotListEntries.mockResolvedValue([
    { name: 'PingBot', public_key: null, note: null, forward_reviewed: true },
  ]);
  mocks.setBotListEntries.mockRejectedValue(rejection);
  render(<BotListDialog list={LIST} onClose={() => {}} />);
  await screen.findByText('PingBot');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
  return mocks.toastError.mock.calls[0][0] as string;
}

describe('BotListDialog: a refused save', () => {
  beforeEach(() => vi.clearAllMocks());

  it('words a refusal code in the language of the UI', async () => {
    expect(await saveWith(new Error('too_many_entries'))).toBe(
      'A bot list holds at most 1000 names.'
    );
  });

  it('shows a validation message as it is', async () => {
    expect(await saveWith(new Error('public_key: a public key is 64 hex characters'))).toBe(
      'public_key: a public key is 64 hex characters'
    );
  });
});
