// Which radios have a workspace tab open in this browser (multi-radio mode).
//
// A tab plays the mention/DM sound for its own radio. A tab of another radio
// would play it a second time for the same message, so it stays quiet for
// every radio that answers here. BroadcastChannel and no timers, for the same
// reasons as popout/mainPresence.ts.

const CHANNEL_NAME = 'rtfm-ev-radio-tabs';

type TabMessage = { t: 'who' | 'here' | 'bye'; id: number };

interface TabChannel {
  postMessage: (message: TabMessage) => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close: () => void;
}

export interface RadioTabs {
  /** True when another tab has this radio's workspace open. */
  isOpen: (radioId: number) => boolean;
  dispose: () => void;
}

function openChannel(): TabChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(CHANNEL_NAME) as unknown as TabChannel;
}

function parse(data: unknown): TabMessage | null {
  const message = data as TabMessage | null;
  if (!message || typeof message.id !== 'number') return null;
  return message.t === 'who' || message.t === 'here' || message.t === 'bye' ? message : null;
}

export function trackRadioTabs(
  ownId: number,
  channel: TabChannel | null = openChannel()
): RadioTabs {
  if (!channel) return { isOpen: () => false, dispose: () => {} };

  const open = new Set<number>();
  // False once this tab said goodbye: it must not answer the question the
  // goodbye itself triggers in the other tabs.
  let present = true;
  channel.onmessage = (event) => {
    const message = parse(event.data);
    if (!message) return;
    if (message.t === 'who') {
      if (present) channel.postMessage({ t: 'here', id: ownId });
    } else if (message.t === 'here') {
      open.add(message.id);
    } else {
      // One tab of that radio closed; another may still be open, so ask again.
      open.delete(message.id);
      channel.postMessage({ t: 'who', id: ownId });
    }
  };
  channel.postMessage({ t: 'here', id: ownId });
  channel.postMessage({ t: 'who', id: ownId });

  const bye = () => {
    present = false;
    channel.postMessage({ t: 'bye', id: ownId });
  };
  // A page restored from the back/forward cache said goodbye on its way out.
  const back = () => {
    present = true;
    channel.postMessage({ t: 'here', id: ownId });
  };
  window.addEventListener('pagehide', bye);
  window.addEventListener('pageshow', back);

  return {
    isOpen: (radioId) => open.has(radioId),
    dispose: () => {
      window.removeEventListener('pagehide', bye);
      window.removeEventListener('pageshow', back);
      bye();
      channel.close();
    },
  };
}
