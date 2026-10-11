// Unread totals of every radio in multi-radio mode, pushed by the gateway on
// /gateway/ws. A workspace only knows its own radio; this is how the switcher
// shows badges for the others and how a sound can play for them.

import { useSyncExternalStore } from 'react';

import { getGatewayContext } from './context';

export interface RadioUnreads {
  /** Unread messages, muted channels left out. */
  unread: number;
  /** Unread direct messages. */
  dms: number;
  /** Channels with an unread mention. */
  mentions: number;
  /** That radio's own "mention/DM sound" setting. */
  sound: boolean;
}

export type UnreadsByRadio = Record<number, RadioUnreads>;

/** `keys` are conversation state keys ('contact-<key>', 'channel-<key>') that just became alert-worthy. */
export type AlertHandler = (radioId: number, keys: string[]) => void;

interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close: () => void;
}

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

let current: UnreadsByRadio = {};
const listeners = new Set<() => void>();

function publish(next: UnreadsByRadio): void {
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRadioUnreads(): UnreadsByRadio {
  return current;
}

/** Live unread totals per radio id. Empty in single-radio mode. */
export function useRadioUnreads(): UnreadsByRadio {
  return useSyncExternalStore(subscribe, getRadioUnreads, getRadioUnreads);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function parseUnreads(raw: unknown): UnreadsByRadio {
  const result: UnreadsByRadio = {};
  if (typeof raw !== 'object' || raw === null) return result;
  for (const [id, value] of Object.entries(raw)) {
    const radioId = Number(id);
    if (!Number.isInteger(radioId) || typeof value !== 'object' || value === null) continue;
    const entry = value as Record<string, unknown>;
    result[radioId] = {
      unread: count(entry.unread),
      dms: count(entry.dms),
      mentions: count(entry.mentions),
      sound: entry.sound === true,
    };
  }
  return result;
}

export function gatewayEventsUrl(): string | null {
  const context = getGatewayContext();
  if (!context) return null;
  const url = new URL(`${context.base}ws`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/**
 * Follow the gateway's unread stream until the returned function is called.
 * Reconnects with a growing delay. Does nothing in single-radio mode.
 */
export function connectGatewayEvents(
  onAlert: AlertHandler,
  makeSocket: (url: string) => SocketLike = (url) => new WebSocket(url) as unknown as SocketLike
): () => void {
  const url = gatewayEventsUrl();
  if (!url) return () => {};

  let stopped = false;
  let socket: SocketLike | null = null;
  let retryTimer: number | undefined;
  let retryMs = INITIAL_RETRY_MS;

  const open = () => {
    const opened = makeSocket(url);
    socket = opened;
    opened.onopen = () => {
      retryMs = INITIAL_RETRY_MS;
    };
    opened.onmessage = (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof message !== 'object' || message === null) return;
      const { type, radios, radio, keys } = message as Record<string, unknown>;
      if (type === 'unreads') {
        publish(parseUnreads(radios));
      } else if (type === 'alert' && typeof radio === 'number' && Array.isArray(keys)) {
        onAlert(
          radio,
          keys.filter((key): key is string => typeof key === 'string')
        );
      }
    };
    opened.onerror = () => opened.close();
    opened.onclose = () => {
      if (stopped) return;
      retryTimer = window.setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    };
  };

  open();
  return () => {
    stopped = true;
    window.clearTimeout(retryTimer);
    socket?.close();
    publish({});
  };
}
