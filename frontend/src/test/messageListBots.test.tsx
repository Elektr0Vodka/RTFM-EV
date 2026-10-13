import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotListsState, Message } from '../types';

const mocks = vi.hoisted(() => ({
  setBotListExceptions: vi.fn(),
  createBotList: vi.fn(),
  updateBotList: vi.fn(),
  addBotListEntry: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>();
  return { ...original, api: { ...original.api, ...mocks } };
});

import { MessageList } from '../components/MessageList';
import { RichPayloadProvider } from '../contexts/RichPayloadContext';
import { PathHopWidthProvider } from '../contexts/PathHopWidthContext';
import { setBotListsState } from '../utils/botLists';

function state(names: string[], exceptions: string[] = []): BotListsState {
  return {
    lists: [
      {
        id: 7,
        name: 'Mine',
        description: '',
        source: 'local',
        url: null,
        enabled: true,
        block_forward: false,
        file_updated: null,
        fetched_at: null,
        last_error: null,
        created_at: 1,
        entry_count: names.length,
        review_count: 0,
      },
    ],
    exceptions,
    effective: { names, keys: [] },
    limits: { entries_per_list: 1000, effective: 5000 },
    forward: { state: 'off', channels: 0, names: 0 },
  };
}

function message(id: number, sender: string, body: string, over: Partial<Message> = {}): Message {
  return {
    id,
    type: 'CHAN',
    conversation_key: 'chan1',
    text: `${sender}: ${body}`,
    sender_timestamp: 1000 + id,
    received_at: 1000 + id,
    paths: [],
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: sender,
    packet_id: null,
    region: null,
    ...over,
  };
}

const MESSAGES = [
  message(1, 'PingBot', 'pong from the bot'),
  message(2, 'Alice', 'hello from a person'),
  message(3, 'PingBot', 'my own words', { outgoing: true }),
];

function renderList(props: { hideBots?: boolean; onHideBotsChange?: (hide: boolean) => void }) {
  return render(
    <RichPayloadProvider renderRichPayloads setRenderRichPayloads={vi.fn()}>
      <PathHopWidthProvider showPathHopWidth={false} setShowPathHopWidth={vi.fn()}>
        <MessageList messages={MESSAGES} contacts={[]} loading={false} {...props} />
      </PathHopWidthProvider>
    </RichPayloadProvider>
  );
}

describe('MessageList and bot lists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setBotListsState(state(['PingBot']));
  });

  it('marks a listed sender and nobody else', () => {
    renderList({});
    expect(screen.getAllByText('Bot')).toHaveLength(1);
    expect(screen.getByText(/pong from the bot/)).toBeInTheDocument();
  });

  it('shows no marker when no list names the sender', () => {
    setBotListsState(state([]));
    renderList({});
    expect(screen.queryByText('Bot')).toBeNull();
  });

  it('hides listed senders with Hide bots, and keeps own messages', () => {
    renderList({ hideBots: true });
    expect(screen.queryByText(/pong from the bot/)).toBeNull();
    expect(screen.getByText(/hello from a person/)).toBeInTheDocument();
    expect(screen.getByText(/my own words/)).toBeInTheDocument();
  });

  it('shows a hidden sender again as soon as the list changes', async () => {
    renderList({ hideBots: true });
    expect(screen.queryByText(/pong from the bot/)).toBeNull();
    setBotListsState(state([]));
    await waitFor(() => expect(screen.getByText(/pong from the bot/)).toBeInTheDocument());
  });

  it('Not a bot adds an exception', async () => {
    mocks.setBotListExceptions.mockResolvedValue(state([], ['PingBot']));
    renderList({});
    fireEvent.click(screen.getByRole('button', { name: 'Not a bot' }));
    await waitFor(() => expect(mocks.setBotListExceptions).toHaveBeenCalledWith(['PingBot']));
    await waitFor(() => expect(screen.queryByText('Bot')).toBeNull());
  });

  it('marks and excepts a sender whose name has brackets (stored without a sender)', async () => {
    setBotListsState(state(['[NU]']));
    mocks.setBotListExceptions.mockResolvedValue(state([], ['[NU]']));
    render(
      <RichPayloadProvider renderRichPayloads setRenderRichPayloads={vi.fn()}>
        <PathHopWidthProvider showPathHopWidth={false} setShowPathHopWidth={vi.fn()}>
          <MessageList
            messages={[message(5, '[NU]', 'headline from the feed', { sender_name: null })]}
            contacts={[]}
            loading={false}
          />
        </PathHopWidthProvider>
      </RichPayloadProvider>
    );
    expect(screen.getAllByText('Bot')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Not a bot' }));
    await waitFor(() => expect(mocks.setBotListExceptions).toHaveBeenCalledWith(['[NU]']));
  });

  it('stores the author key of a room post, never the room key', async () => {
    const ROOM = 'aa'.repeat(32);
    const AUTHOR = 'cd'.repeat(32);
    mocks.addBotListEntry.mockResolvedValue(state(['WeatherBot']));
    render(
      <RichPayloadProvider renderRichPayloads setRenderRichPayloads={vi.fn()}>
        <PathHopWidthProvider showPathHopWidth={false} setShowPathHopWidth={vi.fn()}>
          <MessageList
            messages={[
              message(6, 'WeatherBot', 'sunny', {
                type: 'PRIV',
                conversation_key: ROOM,
                sender_key: AUTHOR,
                text: 'sunny',
              }),
            ]}
            contacts={[]}
            loading={false}
          />
        </PathHopWidthProvider>
      </RichPayloadProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to bot list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(mocks.addBotListEntry).toHaveBeenCalledWith(7, {
        name: 'WeatherBot',
        public_key: AUTHOR,
        note: null,
      })
    );
  });

  it('a new list made from the dialog is the one the server names', async () => {
    const shipped = {
      ...state([]).lists[0],
      id: 1,
      name: 'Aaa shipped',
      source: 'shipped' as const,
    };
    const mine = { ...state([]).lists[0], id: 12, name: 'Zzz mine', enabled: false };
    setBotListsState(null);
    mocks.createBotList.mockResolvedValue({ ...state([]), lists: [shipped, mine], created_id: 12 });
    mocks.updateBotList.mockResolvedValue(state([]));
    mocks.addBotListEntry.mockResolvedValue(state(['Alice']));
    renderList({});
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to bot list' })[0]);
    fireEvent.change(await screen.findByLabelText('Name of the new list'), {
      target: { value: 'Zzz mine' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mocks.addBotListEntry).toHaveBeenCalled());
    expect(mocks.updateBotList).toHaveBeenCalledWith(12, { enabled: true });
    expect(mocks.addBotListEntry.mock.calls[0][0]).toBe(12);
  });

  it('Add to bot list stores the sender in the chosen list', async () => {
    mocks.addBotListEntry.mockResolvedValue(state(['PingBot', 'Alice']));
    renderList({});
    fireEvent.click(screen.getByRole('button', { name: 'Add to bot list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(mocks.addBotListEntry).toHaveBeenCalledWith(7, {
        name: 'Alice',
        public_key: null,
        note: null,
      })
    );
  });
});
