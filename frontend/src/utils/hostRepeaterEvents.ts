import type { HostRepeaterEventPayload } from '../types';

/**
 * Browser-local fan-out for the WS `host_repeater` event (plan 29). The settings
 * section listens while it is mounted, so every open browser shows a settings
 * change made elsewhere without threading a handler through App.
 */
const EVENT_NAME = 'rtfm:host-repeater';

export function emitHostRepeaterEvent(payload: HostRepeaterEventPayload): void {
  window.dispatchEvent(new CustomEvent<HostRepeaterEventPayload>(EVENT_NAME, { detail: payload }));
}

export function subscribeHostRepeaterEvents(
  handler: (payload: HostRepeaterEventPayload) => void
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<HostRepeaterEventPayload>).detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
