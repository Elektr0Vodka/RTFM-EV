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
    ...over,
  };
}

function state(lists: BotList[], exceptions: string[] = []): BotListsState {
  return {
    lists,
    exceptions,
    effective: { names: [], keys: [] },
    limits: { entries_per_list: 1000, effective: 5000 },
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

  it('offers Refresh now only on a subscription', async () => {
    render(<SettingsBotListsSection appSettings={null} />);
    await screen.findByText('Mine');
    expect(screen.queryByRole('button', { name: 'Refresh now' })).toBeNull();
  });
});
