import type { MessageBookmarkPayload } from '../types';

/**
 * Browser-local fan-out for message bookmark changes: the WS `message_bookmark`
 * event (any tab), this tab's own bookmark actions, and deleted messages (whose
 * bookmark goes with them). Loaded chat messages and the Bookmarks view listen,
 * so no handler has to be threaded through App.
 */
const EVENT_NAME = 'rtfm:message-bookmark';

export function emitBookmarkEvent(payload: MessageBookmarkPayload): void {
  window.dispatchEvent(new CustomEvent<MessageBookmarkPayload>(EVENT_NAME, { detail: payload }));
}

export function subscribeBookmarkEvents(
  handler: (payload: MessageBookmarkPayload) => void
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<MessageBookmarkPayload>).detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
