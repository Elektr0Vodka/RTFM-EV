import type { SpamGuardSummary } from '../types';

/**
 * Browser-local fan-out for the WS `spam_guard` event. The Spam Guard page and
 * the settings card listen while they are mounted, so a change made in another
 * browser (or a block the detector just created) shows without threading a
 * handler through App.
 */
const EVENT_NAME = 'rtfm:spam-guard';

export function emitSpamGuardEvent(payload: SpamGuardSummary): void {
  window.dispatchEvent(new CustomEvent<SpamGuardSummary>(EVENT_NAME, { detail: payload }));
}

export function subscribeSpamGuardEvents(handler: (payload: SpamGuardSummary) => void): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<SpamGuardSummary>).detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
