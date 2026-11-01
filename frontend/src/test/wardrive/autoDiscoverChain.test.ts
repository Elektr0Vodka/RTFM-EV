// Auto-discover with the real Companion and its one-at-a-time chain, over a
// fake in-memory link. Nothing reaches a radio.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoDiscover, type AutoDiscoverOptions } from '../../wardrive/discover/autoDiscover';
import { CONTACT_FRAME_LEN } from '../../wardrive/discover/contactPath';
import { Companion } from '../../wardrive/radio/companion';
import type { RadioTransport } from '../../wardrive/radio/transport';

const SELF = 'aa'.repeat(32);
const COMPANION = 'c0' + '11'.repeat(31);

class Link implements RadioTransport {
  kind = 'ble' as const;
  sent: Uint8Array[] = [];
  private cbs: ((f: Uint8Array) => void)[] = [];
  answer: (frame: Uint8Array, link: Link) => void = () => {};
  async connect() {}
  async disconnect() {}
  async send(frame: Uint8Array) {
    this.sent.push(frame);
    queueMicrotask(() => this.answer(frame, this));
  }
  onFrame(cb: (f: Uint8Array) => void) {
    this.cbs.push(cb);
    return () => {
      this.cbs = this.cbs.filter((x) => x !== cb);
    };
  }
  onClose() {
    return () => {};
  }
  push(f: number[] | Uint8Array) {
    const frame = f instanceof Uint8Array ? f : new Uint8Array(f);
    this.cbs.forEach((cb) => cb(frame));
  }
}

const TRANSMIT_CODES = [0x37, 0x24, 7, 39, 57];

function engine(
  companion: AutoDiscoverOptions['companion'],
  over: Partial<AutoDiscoverOptions> = {}
) {
  return new AutoDiscover({
    companion,
    selfKey: SELF,
    sf: 8,
    name: 'Car',
    position: () => null,
    targets: () => ({ repeaters: [], companions: [] }),
    heard: () => ({ ids: [], heardAt: new Map() }),
    introduce: () => false,
    onSent: () => undefined,
    onChange: () => undefined,
    random: (n) => new Uint8Array(n).fill(7),
    ...over,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('Auto-discover on the real companion chain', () => {
  it('sends nothing that was still queued when the switch went off', async () => {
    const link = new Link();
    // The radio is slow with its stats: the chain is held for 1.5 s.
    link.answer = (frame, l) => {
      if (frame[0] === 0x38)
        setTimeout(() => l.push([24, frame[1], 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 1500);
      else if (frame[0] === 0x37) l.push([0]);
    };
    const c = new Companion(link);
    void c.stats(1);
    const ad = engine(c, { targets: () => ({ repeaters: ['a1'], companions: [] }) });
    ad.start();
    await vi.advanceTimersByTimeAsync(300);
    ad.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(link.sent.map((f) => f[0]).filter((x) => TRANSMIT_CODES.includes(x))).toEqual([]);
  });

  it('does not start again once disposed', async () => {
    const link = new Link();
    link.answer = (_frame, l) => l.push([0]);
    const ad = engine(new Companion(link));
    ad.dispose();
    ad.start();
    await vi.advanceTimersByTimeAsync(20000);
    expect(link.sent).toEqual([]);
  });

  it('does not trust an OK or ERR while a timed-out reply may still come', async () => {
    const link = new Link();
    const c = new Companion(link);
    // A Discover the radio answers late, after the transmit gave up.
    link.answer = (frame, l) => {
      if (frame[0] === 0x37) setTimeout(() => l.push([0]), 3500);
    };
    const first = c.transmit(new Uint8Array([0x37, 0x81, 0xff, 1, 2, 3, 4]), 'ok', 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await first).sent).toBe(true);
    // The next exchange is told its OK/ERR may be someone else's.
    link.answer = () => {};
    const seen: boolean[] = [];
    const write = c.request(
      new Uint8Array([9]),
      (reply, late) => {
        seen.push(late);
        return reply[0] === 0 ? true : null;
      },
      2000
    );
    await vi.advanceTimersByTimeAsync(600);
    await write;
    expect(seen[0]).toBe(true);
    // A reply with its own code (a contact) shows the old ones are past.
    link.answer = (_frame, l) => l.push([3, 1]);
    const read = await c.request(
      new Uint8Array([30]),
      (reply) => (reply[0] === 3 ? true : null),
      1000
    );
    expect(read).toBe(true);
    const lateAfter: boolean[] = [];
    link.answer = (_frame, l) => l.push([0]);
    await c.request(
      new Uint8Array([9]),
      (_reply, late) => {
        lateAfter.push(late);
        return true;
      },
      1000
    );
    expect(lateAfter).toEqual([false]);
  });

  it('asks nothing when the override ack cannot be trusted', async () => {
    const sent: number[] = [];
    const companion: AutoDiscoverOptions['companion'] = {
      transmit: vi.fn(async (frame: Uint8Array) => {
        sent.push(frame[0]);
        return { sent: true, reply: new Uint8Array([6, 0, 1, 0, 0, 0, 0, 0, 0, 0]) };
      }),
      request: vi.fn(
        async (frame: Uint8Array, accept: (b: Uint8Array, late: boolean) => unknown) => {
          sent.push(frame[0]);
          if (frame[0] === 30) {
            const c = new Uint8Array(CONTACT_FRAME_LEN);
            c[0] = 3;
            c.set(frame.subarray(1, 33), 1);
            c[35] = 0xff;
            return accept(c, false);
          }
          // An OK that may be a late reply to something else.
          return accept(new Uint8Array([0]), true);
        }
      ) as AutoDiscoverOptions['companion']['request'],
      onPush: () => () => undefined,
    };
    const ad = engine(companion, { targets: () => ({ repeaters: [], companions: [COMPANION] }) });
    ad.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toContain(30);
    expect(sent).not.toContain(39);
    // The restore was not trusted either: its record stays for the next connect.
    expect(
      localStorage.getItem(`rtfm-wardrive-contact-restore:${SELF}:${COMPANION}`)
    ).not.toBeNull();
    ad.stop();
  });

  it('keeps the airtime floor across off and on', async () => {
    const link = new Link();
    link.answer = (_frame, l) => l.push([0]);
    const ad = engine(new Companion(link));
    ad.start();
    await vi.advanceTimersByTimeAsync(10);
    ad.stop();
    ad.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(link.sent.filter((f) => f[0] === 0x37)).toHaveLength(1);
    // One Discover at SF8 buys 2.42 s.
    await vi.advanceTimersByTimeAsync(2000);
    expect(link.sent.filter((f) => f[0] === 0x37)).toHaveLength(2);
    ad.stop();
  });
});
