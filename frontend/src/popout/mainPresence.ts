/**
 * "Is a main tab open?" for the chat popup.
 *
 * The popup and a main tab receive the same messages, so with both open the
 * mention sound and browser notifications would fire twice. The popup stays
 * silent while a main tab answers on this channel.
 *
 * BroadcastChannel rather than Web Locks: the app is often served over plain
 * HTTP on a LAN, where `navigator.locks` does not exist. And no timers: hidden
 * tabs throttle them heavily, while message events are delivered promptly.
 */

import { radioTag } from '../gateway/context';

const CHANNEL_NAME = 'rtfm-ev-presence';

/** A main tab that has not answered a probe for this long is considered gone. */
export const PROBE_TIMEOUT_MS = 2000;

type PresenceMessage = { t: 'who' | 'here' | 'bye' };

interface PresenceChannel {
  postMessage: (message: PresenceMessage) => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close: () => void;
}

function openChannel(): PresenceChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  // Per radio in multi-radio mode: a main tab of another radio is not this popup's main tab.
  return new BroadcastChannel(radioTag(CHANNEL_NAME)) as unknown as PresenceChannel;
}

function messageType(data: unknown): PresenceMessage['t'] | null {
  const t = (data as PresenceMessage | null)?.t;
  return t === 'who' || t === 'here' || t === 'bye' ? t : null;
}

/** Main tab side: announce on load, answer probes, say goodbye on unload. */
export function announceMainPresence(channel: PresenceChannel | null = openChannel()): () => void {
  if (!channel) return () => {};
  channel.onmessage = (event) => {
    if (messageType(event.data) === 'who') channel.postMessage({ t: 'here' });
  };
  channel.postMessage({ t: 'here' });

  const bye = () => channel.postMessage({ t: 'bye' });
  // A page restored from the back/forward cache said goodbye on its way out.
  const back = () => channel.postMessage({ t: 'here' });
  window.addEventListener('pagehide', bye);
  window.addEventListener('pageshow', back);
  return () => {
    window.removeEventListener('pagehide', bye);
    window.removeEventListener('pageshow', back);
    channel.close();
  };
}

export interface MainPresenceTracker {
  /** Whether a main tab is believed to be open right now. */
  isMainOpen: () => boolean;
  close: () => void;
}

/**
 * Popup side. `isMainOpen` answers from the last known state and re-probes, so
 * a main tab that died without a goodbye is noticed on the next call that comes
 * at least PROBE_TIMEOUT_MS after the unanswered probe. Without a channel the
 * popup acts as if it is alone.
 */
export function createMainPresenceTracker(
  channel: PresenceChannel | null = openChannel(),
  now: () => number = Date.now
): MainPresenceTracker {
  if (!channel) return { isMainOpen: () => false, close: () => {} };

  let open = false;
  let probeAt: number | null = null;

  channel.onmessage = (event) => {
    const type = messageType(event.data);
    if (type === 'here') {
      open = true;
      probeAt = null;
    } else if (type === 'bye') {
      // Another main tab may still be there; it answers the probe.
      open = false;
      probeAt = null;
      channel.postMessage({ t: 'who' });
    }
  };
  channel.postMessage({ t: 'who' });

  return {
    isMainOpen: () => {
      if (probeAt !== null && now() - probeAt >= PROBE_TIMEOUT_MS) {
        open = false;
        probeAt = null;
      }
      if (open && probeAt === null) {
        probeAt = now();
        channel.postMessage({ t: 'who' });
      }
      return open;
    },
    close: () => channel.close(),
  };
}
