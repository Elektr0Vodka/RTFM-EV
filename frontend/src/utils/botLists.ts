import { useSyncExternalStore } from 'react';

import { api } from '../api';
import type { BotListsState, Message } from '../types';

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

/**
 * True for an incoming message from a listed sender: by exact name, or by
 * public key (the contact of a DM, the resolved sender of a channel message).
 */
export function isBotMessage(
  msg: Pick<Message, 'outgoing' | 'type' | 'conversation_key' | 'sender_name' | 'sender_key'>
): boolean {
  if (msg.outgoing) return false;
  if (isBotName(msg.sender_name)) return true;
  const key = msg.type === 'PRIV' ? msg.conversation_key : msg.sender_key;
  return !!key && keys.has(key.toLowerCase());
}

export async function loadBotLists(): Promise<void> {
  setBotListsState(await api.getBotLists());
}

/** The state, re-rendering the caller when it changes. */
export function useBotLists(): BotListsState | null {
  return useSyncExternalStore(subscribeBotLists, getBotListsState);
}
