import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotList, BotListsState } from '../types';

const mocks = vi.hoisted(() => ({
  getBotLists: vi.fn(),
  createBotList: vi.fn(),
  updateBotList: vi.fn(),
  deleteBotList: vi.fn(),
  getBotListEntries: vi.fn(),
  setBotListEntries: vi.fn(),
  importBotList: vi.fn(),
  botListExportUrl: vi.fn((id: number) => `./api/bot-lists/${id}/export`),
  setBotListExceptions: vi.fn(),
  previewBotListUrl: vi.fn(),
  subscribeBotList: vi.fn(),
  refreshBotList: vi.fn(),
  reviewBotList: vi.fn(),
}));
vi.mock('../api', () => ({ api: mocks }));

import { SettingsBotListsSection } from '../components/settings/SettingsBotListsSection';
import { setBotListsState } from '../utils/botLists';

function list(over: Partial<BotList>): BotList {
  return {
    id: 1,
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
    entry_count: 2,
    review_count: 0,
    ...over,
  };
}

function state(
  lists: BotList[],
  exceptions: string[] = [],
  forward: BotListsState['forward'] = { state: 'off', channels: 0, names: 0 }
): BotListsState {
  return {
    lists,
    exceptions,
    effective: { names: [], keys: [] },
    limits: { entries_per_list: 1000, effective: 5000 },
    forward,
  };
}

const SHIPPED = list({ id: 9, name: 'RTFM-EV bot list', source: 'shipped', entry_count: 0 });
const START = state([SHIPPED, list({})], ['Alice']);

describe('SettingsBotListsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setBotListsState(null);
    mocks.getBotLists.mockResolvedValue(START);
  });
  afterEach(() => vi.restoreAllMocks());

  it('lists the lists with where they come from', async () => {
    render(<SettingsBotListsSection appSettings={null} />);
    expect(await screen.findByText('Mine')).toBeInTheDocument();
    expect(screen.getByText('RTFM-EV bot list')).toBeInTheDocument();
    expect(screen.getByText('Shipped with RTFM-EV')).toBeInTheDocument();
    expect(screen.getByText('2 names')).toBeInTheDocument();
  });

  it('counts one name in the singular', async () => {
    mocks.getBotLists.mockResolvedValue(state([list({ entry_count: 1 })]));
    render(<SettingsBotListsSection appSettings={null} />);
    expect(await screen.findByText('1 name')).toBeInTheDocument();
  });

  it('switches a list on', async () => {
    mocks.updateBotList.mockResolvedValue(state([SHIPPED, list({ enabled: true })]));
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Enable Mine' }));
    await waitFor(() => expect(mocks.updateBotList).toHaveBeenCalledWith(1, { enabled: true }));
  });

  it('saves Hide bots through the app settings', async () => {
    const onSave = vi.fn();
    render(<SettingsBotListsSection appSettings={null} onSaveAppSettings={onSave} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Hide bots in chat' }));
    expect(onSave).toHaveBeenCalledWith({ hide_bots: true });
  });

  it('creates a list', async () => {
    mocks.createBotList.mockResolvedValue(START);
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.change(await screen.findByPlaceholderText('Name of a new list'), {
      target: { value: 'Weather bots' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'New list' }));
    await waitFor(() => expect(mocks.createBotList).toHaveBeenCalledWith('Weather bots'));
  });

  it('imports a file as it is', async () => {
    mocks.importBotList.mockResolvedValue(START);
    const { container } = render(<SettingsBotListsSection appSettings={null} />);
    await screen.findByText('Mine');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const text = '{"format":"rtfm-ev-bot-list","version":1,"name":"Shared","entries":[]}';
    fireEvent.change(input, { target: { files: [new File([text], 'shared.json')] } });
    await waitFor(() => expect(mocks.importBotList).toHaveBeenCalledWith(text));
  });

  it('cannot delete the shipped list and asks before deleting another', async () => {
    mocks.deleteBotList.mockResolvedValue(state([SHIPPED]));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SettingsBotListsSection appSettings={null} />);
    await screen.findByText('Mine');
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(mocks.deleteBotList).toHaveBeenCalledWith(1));
  });

  it('shows why a list could not be loaded', async () => {
    mocks.getBotLists.mockResolvedValue(
      state([list({ id: 9, source: 'shipped', last_error: 'the file is not valid JSON' })])
    );
    render(<SettingsBotListsSection appSettings={null} />);
    expect(
      await screen.findByText('Could not be loaded: the file is not valid JSON')
    ).toBeInTheDocument();
  });

  it('adds and removes an exception', async () => {
    mocks.setBotListExceptions.mockResolvedValue(START);
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Alice' }));
    await waitFor(() => expect(mocks.setBotListExceptions).toHaveBeenCalledWith([]));

    fireEvent.change(screen.getByPlaceholderText('Sender name'), { target: { value: 'Bob' } });
    const exceptions = screen.getByTestId('bot-exceptions');
    fireEvent.click(within(exceptions).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mocks.setBotListExceptions).toHaveBeenCalledWith(['Alice', 'Bob']));
  });

  it('cannot save a list whose names did not load', async () => {
    mocks.getBotListEntries.mockRejectedValue(new Error('offline'));
    render(<SettingsBotListsSection appSettings={null} />);
    const row = (await screen.findByText('Mine')).closest('[data-testid="bot-list-row"]');
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Names' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(mocks.getBotListEntries).toHaveBeenCalledWith(1));
    expect(within(dialog).queryByText('No names on this list.')).toBeNull();
    expect(document.getElementById('bot-entry-name')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(mocks.setBotListEntries).not.toHaveBeenCalled();
  });

  it('edits the names of a local list', async () => {
    mocks.getBotListEntries.mockResolvedValue([{ name: 'PingBot', public_key: null, note: null }]);
    mocks.setBotListEntries.mockResolvedValue(START);
    render(<SettingsBotListsSection appSettings={null} />);
    const row = (await screen.findByText('Mine')).closest('[data-testid="bot-list-row"]');
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Names' }));
    expect(await screen.findByText('PingBot')).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    fireEvent.change(document.getElementById('bot-entry-name') as HTMLInputElement, {
      target: { value: 'NewsBot' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.setBotListEntries).toHaveBeenCalledWith(1, [
        { name: 'PingBot', public_key: null, note: null },
        { name: 'NewsBot', public_key: null, note: null },
      ])
    );
  });

  it('subscribes only after the list was shown', async () => {
    mocks.previewBotListUrl.mockResolvedValue({
      url: 'https://example.org/bots.json',
      name: 'Shared',
      description: '',
      updated: null,
      entries: [
        { name: 'PingBot', public_key: null, note: 'pong' },
        { name: 'NewsBot', public_key: null, note: null },
      ],
    });
    mocks.subscribeBotList.mockResolvedValue({ ...START, created_id: 5 });
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe to URL' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Subscribe' })).toBeNull();

    fireEvent.change(within(dialog).getByLabelText('Address of the list'), {
      target: { value: ' https://example.org/bots.json#x ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show the list' }));
    expect(await within(dialog).findByText('Shared: 2 names')).toBeInTheDocument();
    expect(within(dialog).getByText('PingBot')).toBeInTheDocument();
    expect(mocks.previewBotListUrl).toHaveBeenCalledWith('https://example.org/bots.json#x');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Subscribe' }));
    await waitFor(() =>
      expect(mocks.subscribeBotList).toHaveBeenCalledWith('https://example.org/bots.json')
    );
  });

  it('hides Subscribe again when the address is changed after the preview', async () => {
    mocks.previewBotListUrl.mockResolvedValue({
      url: 'https://example.org/bots.json',
      name: 'Shared',
      description: '',
      updated: null,
      entries: [],
    });
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe to URL' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Address of the list');
    fireEvent.change(input, { target: { value: 'https://example.org/bots.json' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show the list' }));
    await within(dialog).findByRole('button', { name: 'Subscribe' });
    fireEvent.change(input, { target: { value: 'https://example.org/other.json' } });
    expect(within(dialog).queryByRole('button', { name: 'Subscribe' })).toBeNull();
  });

  it('locks the address while a list is being fetched', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.previewBotListUrl.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe to URL' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Address of the list');
    fireEvent.change(input, { target: { value: 'https://example.org/a.json' } });
    expect(input).not.toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show the list' }));
    await waitFor(() => expect(input).toBeDisabled());

    finish({
      url: 'https://example.org/a.json',
      name: 'A',
      description: '',
      updated: null,
      entries: [],
    });
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(within(dialog).getByText('A: 0 names')).toBeInTheDocument();
  });

  it('shows a subscription with its host, refresh time and error, and refreshes it', async () => {
    const sub = list({
      id: 4,
      name: 'Shared',
      source: 'url',
      url: 'https://lists.example.org/bots.json?token=abc',
      fetched_at: 1791900000,
      last_error: 'fetch_failed',
    });
    mocks.getBotLists.mockResolvedValue(state([sub]));
    mocks.refreshBotList.mockResolvedValue(state([{ ...sub, last_error: null }]));
    render(<SettingsBotListsSection appSettings={null} />);
    expect(await screen.findByText('Subscription')).toBeInTheDocument();
    expect(screen.getByText(/^lists\.example\.org, refreshed /)).toBeInTheDocument();
    expect(screen.queryByText(/token=abc/)).toBeNull();
    expect(
      screen.getByText('Could not be loaded: The list could not be fetched.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(mocks.refreshBotList).toHaveBeenCalledWith(4));
  });

  it('shows a refresh that is under way and does not start a second one', async () => {
    const sub = list({
      id: 4,
      name: 'Shared',
      source: 'url',
      url: 'https://lists.example.org/b.json',
      fetched_at: 1,
    });
    mocks.getBotLists.mockResolvedValue(state([sub]));
    let finish: (value: BotListsState) => void = () => {};
    mocks.refreshBotList.mockReturnValue(
      new Promise<BotListsState>((resolve) => {
        finish = resolve;
      })
    );
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now' }));
    const busy = await screen.findByRole('button', { name: 'Refreshing...' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(mocks.refreshBotList).toHaveBeenCalledTimes(1);
    finish(state([sub]));
    expect(await screen.findByRole('button', { name: 'Refresh now' })).not.toBeDisabled();
  });

  it('offers Refresh now only on a subscription', async () => {
    render(<SettingsBotListsSection appSettings={null} />);
    await screen.findByText('Mine');
    expect(screen.queryByRole('button', { name: 'Refresh now' })).toBeNull();
  });

  it('offers Block forwards only on an enabled list', async () => {
    mocks.getBotLists.mockResolvedValue(state([list({ id: 1, enabled: false })]));
    render(<SettingsBotListsSection appSettings={null} />);
    expect(
      await screen.findByRole('checkbox', { name: 'Block forwards from Mine' })
    ).toBeDisabled();
  });

  it('switches Block forwards on for a list of the user', async () => {
    mocks.getBotLists.mockResolvedValue(state([list({ enabled: true })]));
    mocks.updateBotList.mockResolvedValue(state([list({ enabled: true, block_forward: true })]));
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Block forwards from Mine' }));
    await waitFor(() =>
      expect(mocks.updateBotList).toHaveBeenCalledWith(1, { block_forward: true })
    );
  });

  it('says what Block forwards is doing', async () => {
    mocks.getBotLists.mockResolvedValue(
      state([list({ enabled: true, block_forward: true })], [], {
        state: 'monitor',
        channels: 0,
        names: 2,
      })
    );
    render(<SettingsBotListsSection appSettings={null} />);
    expect(await screen.findByText('Waiting: Spam Guard is in Monitor')).toBeInTheDocument();
  });

  it('shows no status for a list that does not block forwards', async () => {
    mocks.getBotLists.mockResolvedValue(state([list({ enabled: true })]));
    render(<SettingsBotListsSection appSettings={null} />);
    await screen.findByText('Mine');
    expect(screen.queryByText(/^Waiting:/)).not.toBeInTheDocument();
  });

  it('follows Spam Guard: a change there reloads the status', async () => {
    render(<SettingsBotListsSection appSettings={null} />);
    await screen.findByText('Mine');
    expect(mocks.getBotLists).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent('rtfm:spam-guard', { detail: {} }));
    await waitFor(() => expect(mocks.getBotLists).toHaveBeenCalledTimes(2));
  });

  it('follows the host repeater too: arming or disarming reloads the status', async () => {
    render(<SettingsBotListsSection appSettings={null} />);
    await screen.findByText('Mine');
    expect(mocks.getBotLists).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent('rtfm:host-repeater', { detail: {} }));
    await waitFor(() => expect(mocks.getBotLists).toHaveBeenCalledTimes(2));
  });

  it('lets Block forwards be switched off on a list that is switched off', async () => {
    const off = list({ enabled: false, block_forward: true });
    mocks.getBotLists.mockResolvedValue(state([off]));
    mocks.updateBotList.mockResolvedValue(state([{ ...off, block_forward: false }]));
    render(<SettingsBotListsSection appSettings={null} />);
    const box = await screen.findByRole('checkbox', { name: 'Block forwards from Mine' });
    expect(box).not.toBeDisabled();
    fireEvent.click(box);
    await waitFor(() =>
      expect(mocks.updateBotList).toHaveBeenCalledWith(1, { block_forward: false })
    );
  });

  it('offers the review of names a refresh added', async () => {
    const sub = list({ id: 4, name: 'Shared', source: 'url', enabled: true, review_count: 2 });
    mocks.getBotLists.mockResolvedValue(state([sub]));
    mocks.getBotListEntries.mockResolvedValue([
      { name: 'NewA', public_key: null, note: null, forward_reviewed: false },
    ]);
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('button', { name: '2 new names to review on Shared' }));
    expect(await screen.findByText('New names on Shared')).toBeInTheDocument();
  });

  it('starts the review of another list with nothing of the first', async () => {
    const first = list({ id: 4, name: 'First', source: 'url', enabled: true, review_count: 1 });
    const second = list({ id: 5, name: 'Second', source: 'url', enabled: true, review_count: 1 });
    mocks.getBotLists.mockResolvedValue(state([first, second]));
    mocks.getBotListEntries.mockImplementation((id: number) =>
      id === 4
        ? Promise.resolve([
            { name: 'OnFirst', public_key: null, note: null, forward_reviewed: false },
          ])
        : new Promise(() => {})
    );
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('button', { name: '1 new name to review on First' }));
    expect(await screen.findByText('OnFirst')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: '1 new name to review on Second' }));
    expect(await screen.findByText('New names on Second')).toBeInTheDocument();
    expect(screen.queryByText('OnFirst')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm all' })).toBeDisabled();
  });

  it('shows the names before a subscription blocks forwards', async () => {
    const sub = list({ id: 4, name: 'Shared', source: 'url', enabled: true });
    mocks.getBotLists.mockResolvedValue(state([sub]));
    mocks.getBotListEntries.mockResolvedValue([
      { name: 'PingBot', public_key: null, note: null, forward_reviewed: true },
    ]);
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Block forwards from Shared' }));
    expect(await screen.findByText('Block forwards from Shared?')).toBeInTheDocument();
    expect(mocks.updateBotList).not.toHaveBeenCalled();
  });

  it('switches a subscription off without asking', async () => {
    const sub = list({ id: 4, name: 'Shared', source: 'url', enabled: true, block_forward: true });
    mocks.getBotLists.mockResolvedValue(state([sub]));
    mocks.updateBotList.mockResolvedValue(state([{ ...sub, block_forward: false }]));
    render(<SettingsBotListsSection appSettings={null} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Block forwards from Shared' }));
    await waitFor(() =>
      expect(mocks.updateBotList).toHaveBeenCalledWith(4, { block_forward: false })
    );
  });
});
