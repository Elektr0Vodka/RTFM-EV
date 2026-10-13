import { useSyncExternalStore } from 'react';

import { api } from '../api';
import type { BotListsState, Message } from '../types';
import { parseSenderFromText } from './messageParser';

/**
 * Browser copy of the bot list state. The chat marks and filters messages
 * from it, so it lives outside React: the WebSocket handler, the message list
 * and the settings section all read the same copy without props through App.
 */
let state: BotListsState | null = null;
let names: ReadonlySet<string> = new Set();
let keys: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function setBotListsState(next: BotListsState | null): void {
  state = next;
  names = new Set(next?.effective.names ?? []);
  keys = new Set((next?.effective.keys ?? []).map((key) => key.toLowerCase()));
  listeners.forEach((listener) => listener());
}

export function getBotListsState(): BotListsState | null {
  return state;
}

export function subscribeBotLists(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when an enabled list names this exact sender name. */
export function isBotName(name: string | null | undefined): boolean {
  return !!name && names.has(name);
}

type SenderFields = Pick<
  Message,
  'outgoing' | 'type' | 'conversation_key' | 'sender_name' | 'sender_key' | 'text'
>;

/**
 * The sender name a chat row shows. The backend stores a channel row without
 * a sender when the name has brackets (`[NU]`), while chat still shows the
 * "Sender: " prefix of its text; bot lists match that shown name.
 */
export function botSenderName(msg: Pick<Message, 'type' | 'sender_name' | 'text'>): string | null {
  if (msg.sender_name) return msg.sender_name;
  return msg.type === 'CHAN' ? parseSenderFromText(msg.text).sender : null;
}

/**
 * True for an incoming message from a listed sender: by the exact name chat
 * shows, or by public key (the resolved sender, or the contact of a DM).
 */
export function isBotMessage(msg: SenderFields): boolean {
  if (msg.outgoing) return false;
  if (isBotName(botSenderName(msg))) return true;
  if (msg.sender_key && keys.has(msg.sender_key.toLowerCase())) return true;
  return msg.type === 'PRIV' && keys.has(msg.conversation_key.toLowerCase());
}

export async function loadBotLists(): Promise<void> {
  setBotListsState(await api.getBotLists());
}

/** The state, re-rendering the caller when it changes. */
export function useBotLists(): BotListsState | null {
  return useSyncExternalStore(subscribeBotLists, getBotListsState);
}
