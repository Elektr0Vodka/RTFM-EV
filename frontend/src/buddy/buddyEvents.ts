/**
 * Browser-local fan-out of app happenings the desktop buddy can announce. The
 * realtime WS handlers emit; the buddy (when shown) listens. Emitting with no
 * listener is a no-op, so the app pays nothing when the buddy is off.
 */
export type BuddyEvent =
  | {
      kind: 'new-node';
      /** Number of first-ever-seen nodes in this (server-batched) event. */
      count: number;
      publicKey: string | null;
      name: string | null;
    }
  | { kind: 'radio'; state: 'connected' | 'disconnected' | 'paused' }
  | { kind: 'dm'; publicKey: string; senderName: string | null }
  | {
      kind: 'mention';
      channelKey: string;
      messageId: number;
      senderName: string | null;
    };

const EVENT_NAME = 'rtfm:buddy';

export function emitBuddyEvent(event: BuddyEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BuddyEvent>(EVENT_NAME, { detail: event }));
}

export function subscribeBuddyEvents(handler: (event: BuddyEvent) => void): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<BuddyEvent>).detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
