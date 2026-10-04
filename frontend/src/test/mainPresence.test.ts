import { describe, expect, it } from 'vitest';

import {
  announceMainPresence,
  createMainPresenceTracker,
  PROBE_TIMEOUT_MS,
} from '../popout/mainPresence';

type Message = { t: 'who' | 'here' | 'bye' };

/** Synchronous stand-in for BroadcastChannel: a post reaches every other end. */
function createBus() {
  const ends: FakeChannel[] = [];
  class FakeChannel {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    closed = false;
    sent: Message[] = [];
    postMessage(message: Message) {
      this.sent.push(message);
      for (const end of ends) {
        if (end !== this && !end.closed) end.onmessage?.({ data: message });
      }
    }
    close() {
      this.closed = true;
    }
  }
  return {
    open: () => {
      const end = new FakeChannel();
      ends.push(end);
      return end;
    },
  };
}

describe('main tab presence', () => {
  it('reports no main tab when nobody answers', () => {
    const bus = createBus();
    const tracker = createMainPresenceTracker(bus.open());
    expect(tracker.isMainOpen()).toBe(false);
  });

  it('finds a main tab that was already open', () => {
    const bus = createBus();
    announceMainPresence(bus.open());
    const tracker = createMainPresenceTracker(bus.open());
    expect(tracker.isMainOpen()).toBe(true);
  });

  it('notices a main tab that opens later', () => {
    const bus = createBus();
    const tracker = createMainPresenceTracker(bus.open());
    expect(tracker.isMainOpen()).toBe(false);

    announceMainPresence(bus.open());
    expect(tracker.isMainOpen()).toBe(true);
  });

  it('goes back to notifying when the main tab says goodbye', () => {
    const bus = createBus();
    const main = bus.open();
    announceMainPresence(main);
    const tracker = createMainPresenceTracker(bus.open());
    expect(tracker.isMainOpen()).toBe(true);

    main.onmessage = null; // the tab is unloading and no longer answers
    main.postMessage({ t: 'bye' });
    expect(tracker.isMainOpen()).toBe(false);
  });

  it('stays quiet when one of two main tabs closes', () => {
    const bus = createBus();
    const first = bus.open();
    announceMainPresence(first);
    announceMainPresence(bus.open());
    const tracker = createMainPresenceTracker(bus.open());

    first.onmessage = null;
    first.postMessage({ t: 'bye' });
    expect(tracker.isMainOpen()).toBe(true);
  });

  it('drops a main tab that died without a goodbye once a probe goes unanswered', () => {
    const bus = createBus();
    const main = bus.open();
    announceMainPresence(main);
    let now = 1000;
    const tracker = createMainPresenceTracker(bus.open(), () => now);
    expect(tracker.isMainOpen()).toBe(true);

    main.closed = true; // crashed: receives nothing, says nothing
    // The call that sends the probe still answers from the last known state.
    expect(tracker.isMainOpen()).toBe(true);
    now += PROBE_TIMEOUT_MS - 1;
    expect(tracker.isMainOpen()).toBe(true);
    now += 1;
    expect(tracker.isMainOpen()).toBe(false);
  });

  it('acts alone when there is no channel', () => {
    expect(createMainPresenceTracker(null).isMainOpen()).toBe(false);
    expect(() => announceMainPresence(null)()).not.toThrow();
  });
});
