import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotListsState, Message } from '../types';

const mocks = vi.hoisted(() => ({ getBotLists: vi.fn() }));
vi.mock('../api', () => ({ api: mocks }));

import {
  botSenderName,
  getBotListsState,
  isBotMessage,
  isBotName,
  loadBotLists,
  setBotListsState,
  subscribeBotLists,
} from '../utils/botLists';

const KEY = 'ab'.repeat(32);

function state(names: string[], keys: string[] = []): BotListsState {
  return {
    lists: [],
    exceptions: [],
    effective: { names, keys },
    limits: { entries_per_list: 1000, effective: 5000 },
  };
}

function message(over: Partial<Message>): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'chan1',
    text: 'PingBot: pong',
    sender_timestamp: 1000,
    received_at: 1000,
    paths: [],
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: 'PingBot',
    ...over,
  };
}

describe('bot list store', () => {
  beforeEach(() => setBotListsState(null));

  it('marks nothing before the state is loaded', () => {
    expect(isBotMessage(message({}))).toBe(false);
  });

  it('marks a channel message by exact sender name', () => {
    setBotListsState(state(['PingBot']));
    expect(isBotMessage(message({}))).toBe(true);
    expect(isBotMessage(message({ sender_name: 'pingbot' }))).toBe(false);
    expect(isBotMessage(message({ sender_name: 'PingBot2' }))).toBe(false);
    expect(isBotName('PingBot')).toBe(true);
    expect(isBotName(null)).toBe(false);
  });

  it('marks a name with emoji', () => {
    setBotListsState(state(['Bot 🤖']));
    expect(isBotMessage(message({ sender_name: 'Bot 🤖' }))).toBe(true);
    expect(isBotMessage(message({ sender_name: 'Bot' }))).toBe(false);
  });

  it('marks a DM by the contact key and a channel message by its resolved key', () => {
    setBotListsState(state([], [KEY]));
    expect(
      isBotMessage(
        message({ type: 'PRIV', conversation_key: KEY.toUpperCase(), sender_name: 'Renamed' })
      )
    ).toBe(true);
    expect(isBotMessage(message({ sender_name: 'Renamed', sender_key: KEY }))).toBe(true);
    expect(isBotMessage(message({ sender_name: 'Renamed' }))).toBe(false);
  });

  it('marks a channel row stored without a sender by the name its text shows', () => {
    setBotListsState(state(['[NU]']));
    const row = { sender_name: null, text: '[NU]: Headline from the feed' };
    expect(isBotMessage(message(row))).toBe(true);
    expect(botSenderName(message(row))).toBe('[NU]');
    expect(isBotMessage(message({ sender_name: null, text: '[NU] says: hello' }))).toBe(false);
    expect(isBotMessage(message({ sender_name: null, text: 'no sender [NU]' }))).toBe(false);
    // A DM text is not "Sender: body"; only a channel row shows a sender that way.
    expect(isBotMessage(message({ ...row, type: 'PRIV', conversation_key: KEY }))).toBe(false);
  });

  it('marks a room post by its author key, not only by the room', () => {
    const AUTHOR = 'cd'.repeat(32);
    setBotListsState(state([], [AUTHOR]));
    const post = { type: 'PRIV' as const, conversation_key: KEY, sender_name: 'WeatherBot' };
    expect(isBotMessage(message({ ...post, sender_key: AUTHOR }))).toBe(true);
    expect(isBotMessage(message({ ...post, sender_key: 'ef'.repeat(32) }))).toBe(false);
  });

  it('never marks an outgoing message', () => {
    setBotListsState(state(['PingBot'], [KEY]));
    expect(isBotMessage(message({ outgoing: true }))).toBe(false);
    expect(isBotMessage(message({ type: 'PRIV', conversation_key: KEY, outgoing: true }))).toBe(
      false
    );
  });

  it('tells subscribers about a change and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBotLists(listener);
    setBotListsState(state(['PingBot']));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setBotListsState(state([]));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('loads the state from the API', async () => {
    mocks.getBotLists.mockResolvedValue(state(['NewsBot']));
    await loadBotLists();
    expect(getBotListsState()?.effective.names).toEqual(['NewsBot']);
  });
});
