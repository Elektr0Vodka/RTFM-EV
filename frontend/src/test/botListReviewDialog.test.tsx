import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotList, BotListsState } from '../types';

const mocks = vi.hoisted(() => ({
  getBotListEntries: vi.fn(),
  reviewBotList: vi.fn(),
  updateBotList: vi.fn(),
  setBotListExceptions: vi.fn(),
}));
vi.mock('../api', () => ({ api: mocks }));

import { BotListReviewDialog } from '../components/settings/BotListReviewDialog';
import { setBotListsState } from '../utils/botLists';

const LIST: BotList = {
  id: 7,
  name: 'Shared',
  description: '',
  source: 'url',
  url: 'https://example.org/b.json',
  enabled: true,
  block_forward: true,
  file_updated: null,
  fetched_at: 1,
  last_error: null,
  created_at: 1,
  entry_count: 3,
  review_count: 2,
};
const OFF: BotList = { ...LIST, block_forward: false };

function state(exceptions: string[] = []): BotListsState {
  return {
    lists: [LIST],
    exceptions,
    effective: { names: [], keys: [] },
    limits: { entries_per_list: 1000, effective: 5000 },
    forward: { state: 'off', channels: 0, names: 0 },
  };
}

const ENTRIES = [
  { name: 'NewA', public_key: null, note: 'weather', forward_reviewed: false },
  { name: 'NewB', public_key: null, note: null, forward_reviewed: false },
  { name: 'Old', public_key: null, note: null, forward_reviewed: true },
];

describe('BotListReviewDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setBotListsState(state());
    mocks.getBotListEntries.mockResolvedValue(ENTRIES);
    mocks.reviewBotList.mockResolvedValue(state());
    mocks.updateBotList.mockResolvedValue(state());
    mocks.setBotListExceptions.mockResolvedValue(state(['NewB']));
  });

  it('shows only the names that wait for review', async () => {
    render(<BotListReviewDialog list={LIST} mode="review" onClose={() => {}} />);
    expect(await screen.findByText('NewA')).toBeInTheDocument();
    expect(screen.getByText('NewB')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });

  it('confirms one name', async () => {
    render(<BotListReviewDialog list={LIST} mode="review" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm NewA' }));
    await waitFor(() => expect(mocks.reviewBotList).toHaveBeenCalledWith(7, ['NewA']));
    await waitFor(() => expect(screen.queryByText('NewA')).not.toBeInTheDocument());
    expect(screen.getByText('NewB')).toBeInTheDocument();
  });

  it('confirms all the names it shows and closes', async () => {
    const onClose = vi.fn();
    render(<BotListReviewDialog list={LIST} mode="review" onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm all' }));
    await waitFor(() => expect(mocks.reviewBotList).toHaveBeenCalledWith(7, ['NewA', 'NewB']));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('makes a name an exception with Not a bot', async () => {
    render(<BotListReviewDialog list={LIST} mode="review" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'NewB is not a bot' }));
    await waitFor(() => expect(mocks.setBotListExceptions).toHaveBeenCalledWith(['NewB']));
    await waitFor(() => expect(screen.queryByText('NewB')).not.toBeInTheDocument());
    expect(mocks.reviewBotList).not.toHaveBeenCalled();
  });

  it('leaves out a name that is already an exception', async () => {
    setBotListsState(state(['NewA']));
    render(<BotListReviewDialog list={LIST} mode="review" onClose={() => {}} />);
    expect(await screen.findByText('NewB')).toBeInTheDocument();
    expect(screen.queryByText('NewA')).not.toBeInTheDocument();
  });

  it('shows every name before Block forwards is switched on, then confirms and switches', async () => {
    const onClose = vi.fn();
    render(<BotListReviewDialog list={OFF} mode="enable" onClose={onClose} />);
    expect(await screen.findByText('Old')).toBeInTheDocument();
    expect(screen.getByText('NewA')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Block forwards' }));
    await waitFor(() => expect(mocks.reviewBotList).toHaveBeenCalledWith(7, ['NewA', 'NewB']));
    await waitFor(() =>
      expect(mocks.updateBotList).toHaveBeenCalledWith(7, { block_forward: true })
    );
    expect(mocks.reviewBotList.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateBotList.mock.invocationCallOrder[0]
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not switch on when the names could not be confirmed', async () => {
    mocks.reviewBotList.mockRejectedValue(new Error('That bot list does not exist'));
    render(<BotListReviewDialog list={OFF} mode="enable" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Block forwards' }));
    await waitFor(() => expect(mocks.reviewBotList).toHaveBeenCalled());
    expect(mocks.updateBotList).not.toHaveBeenCalled();
  });

  it('cannot confirm before the names have arrived', () => {
    mocks.getBotListEntries.mockReturnValue(new Promise(() => {}));
    render(<BotListReviewDialog list={OFF} mode="enable" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Block forwards' })).toBeDisabled();
  });
});
