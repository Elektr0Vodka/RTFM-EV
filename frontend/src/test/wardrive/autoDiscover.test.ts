// The Auto-discover engine against a fake companion that records every frame
// it is handed. Nothing reaches a radio.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoDiscover, type AutoDiscoverOptions } from '../../wardrive/discover/autoDiscover';
import { CONTACT_FRAME_LEN } from '../../wardrive/discover/contactPath';

const SELF = 'aa'.repeat(32);
const COMPANION = 'c0' + '11'.repeat(31);
const REPEATER = 'b1' + '22'.repeat(31);

interface Sent {
  frame: Uint8Array;
  at: number;
  /** The tag the fake radio put in its SENT answer. */
  tag?: number;
}

function fakeCompanion(
  opts: { refuse?: (frame: Uint8Array) => boolean; outPathLen?: number } = {}
) {
  const sent: Sent[] = [];
  const pushes: ((f: Uint8Array) => void)[] = [];
  let tagN = 0x10;
  const companion: AutoDiscoverOptions['companion'] = {
    transmit: vi.fn(async (frame: Uint8Array) => {
      if (opts.refuse?.(frame)) {
        sent.push({ frame, at: Date.now() });
        return { sent: false, reply: null };
      }
      const tag = tagN++;
      sent.push({ frame, at: Date.now(), tag });
      const sentReply = new Uint8Array([6, 0, tag, 0, 0, 0, 0xe8, 3, 0, 0]);
      return {
        sent: true,
        reply: frame[0] === 0x37 || frame[0] === 7 ? new Uint8Array([0]) : sentReply,
      };
    }),
    request: vi.fn(async <T>(frame: Uint8Array, accept: (b: Uint8Array) => T | null) => {
      sent.push({ frame, at: Date.now() });
      if (frame[0] === 30) {
        const c = new Uint8Array(CONTACT_FRAME_LEN);
        c[0] = 3;
        c.set(frame.subarray(1, 33), 1);
        c[35] = opts.outPathLen ?? 0xff;
        return accept(c);
      }
      return accept(new Uint8Array([0]));
    }) as AutoDiscoverOptions['companion']['request'],
    onPush: (cb: (f: Uint8Array) => void) => {
      pushes.push(cb);
      return () => undefined;
    },
  };
  return { companion, sent, push: (f: number[]) => pushes.forEach((cb) => cb(new Uint8Array(f))) };
}

const codes = (sent: Sent[]) => sent.map((s) => s.frame[0]);

function engine(over: Partial<AutoDiscoverOptions> = {}, fake = fakeCompanion()) {
  const onSent = vi.fn();
  let pos = { lat: 52, lon: 5 };
  const ad = new AutoDiscover({
    companion: fake.companion,
    selfKey: SELF,
    sf: 8,
    name: 'Car',
    position: () => pos,
    targets: () => ({ repeaters: [], companions: [] }),
    heard: () => ({ ids: [], heardAt: new Map() }),
    introduce: () => false,
    onSent,
    onChange: () => undefined,
    random: (n) => new Uint8Array(n).fill(7),
    ...over,
  });
  return { ad, onSent, ...fake, move: (lat: number) => (pos = { lat, lon: 5 }) };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('AutoDiscover', () => {
  it('is off until started and sends one Discover at once', async () => {
    const { ad, sent, onSent } = engine();
    await vi.advanceTimersByTimeAsync(30000);
    expect(sent).toEqual([]);
    ad.start();
    await flush();
    expect(sent.map((s) => Array.from(s.frame))).toEqual([[0x37, 0x81, 0xff, 7, 7, 7, 7]]);
    expect(onSent).toHaveBeenCalledWith('discover');
    expect(ad.cadenceSeconds()).toBe(10);
    ad.stop();
  });

  it('fires again after 10 s, or after 50 m, never inside the airtime floor', async () => {
    const { ad, sent, move } = engine();
    ad.start();
    await flush();
    await vi.advanceTimersByTimeAsync(9000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(2);
    // 60 m later, 3 s on: past the floor of one Discover (2.4 s at SF8).
    move(52.00054);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toHaveLength(3);
    // Moved again at once: inside the floor.
    move(52.0011);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(3);
    ad.stop();
  });

  it('trace-pings picked repeaters 1.5 s apart and skips a cycle while they are queued', async () => {
    const repeaters = ['a1b2', 'c3d4', 'e5', 'f6', 'a7', 'b8', 'c9'];
    const { ad, sent } = engine({ targets: () => ({ repeaters, companions: [] }) });
    ad.start();
    await flush();
    expect(codes(sent)).toEqual([0x37]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(Array.from(sent[1].frame)).toEqual([0x24, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0xa1]);
    // At 10 s two pings are still queued (7 x 1.5 s = 10.5 s): no new cycle.
    await vi.advanceTimersByTimeAsync(8500);
    expect(codes(sent).filter((c) => c === 0x37)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(codes(sent).filter((c) => c === 0x24)).toHaveLength(7);
    ad.stop();
  });

  it('sweeps heard repeaters, four a cycle, when nothing is picked', async () => {
    const ids = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'];
    const { ad, sent } = engine({ heard: () => ({ ids, heardAt: new Map() }) });
    ad.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(sent.filter((s) => s.frame[0] === 0x24).map((s) => s.frame[10])).toEqual([
      0xa1, 0xb2, 0xc3, 0xd4,
    ]);
    ad.stop();
  });

  it('carries the advert only with Introduce on and a companion picked', async () => {
    const targets = () => ({ repeaters: [], companions: [COMPANION] });
    const off = engine({ targets, introduce: () => false });
    off.ad.start();
    await flush();
    expect(codes(off.sent)).not.toContain(7);
    off.ad.stop();
    const on = engine({ targets, introduce: () => true });
    on.ad.start();
    await flush();
    expect(codes(on.sent).slice(0, 2)).toEqual([0x37, 7]);
    on.ad.stop();
  });

  it('asks a picked companion for telemetry at zero hop and puts its route back', async () => {
    const { ad, sent, push } = engine({
      targets: () => ({ repeaters: [], companions: [COMPANION] }),
    });
    ad.start();
    await vi.advanceTimersByTimeAsync(100);
    // Discover, contact read, override (path 0), the request, the restore (path 0xff).
    expect(codes(sent)).toEqual([0x37, 30, 9, 39, 9]);
    expect([sent[2].frame[35], sent[4].frame[35]]).toEqual([0, 0xff]);
    push([0x8b, 0, 0xc0, 0x11, 0x11, 0x11, 0x11, 0x11, 1, 116, 0x01, 0x86]);
    expect(ad.nodeInfo.get(COMPANION)).toMatchObject({ voltage_v: 3.9 });
    // A RESPONSE with the companion's first byte is its answer.
    expect(
      ad.attribute({
        packetType: 'Response',
        sender: { kind: 'direct_hash', id: 'c0', label: 'c0', role: null },
        traceTag: null,
        heardUsSnr: null,
      })?.sender
    ).toMatchObject({ kind: 'telemetry_reply', id: COMPANION });
    ad.stop();
  });

  it('asks a picked repeater anonymously at most once a minute, taking turns with telemetry', async () => {
    const { ad, sent, push } = engine({
      targets: () => ({ repeaters: [REPEATER], companions: [COMPANION] }),
    });
    ad.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(codes(sent)).toContain(39);
    expect(codes(sent)).not.toContain(57);
    await vi.advanceTimersByTimeAsync(9900 + 100);
    const anon = sent.find((s) => s.frame[0] === 57);
    expect(anon?.frame[33]).toBe(1);
    // The repeater answers with its regions under the tag of our ack.
    push([0x8c, 0, anon!.tag!, 0, 0, 0, 1, 0, 0, 0, ...new TextEncoder().encode('nl,be')]);
    expect(ad.nodeInfo.get(REPEATER)).toMatchObject({ regions: ['nl', 'be'] });
    await vi.advanceTimersByTimeAsync(40000);
    expect(sent.filter((s) => s.frame[0] === 57)).toHaveLength(1);
    ad.stop();
  });

  it('counts nothing and remembers nothing for a refused transmit', async () => {
    const fake = fakeCompanion({ refuse: (f) => f[0] === 0x24 || f[0] === 0x37 });
    const { ad, onSent } = engine({ targets: () => ({ repeaters: ['a1'], companions: [] }) }, fake);
    ad.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onSent).not.toHaveBeenCalled();
    expect(
      ad.attribute({
        packetType: 'Trace',
        sender: { kind: null, id: null, label: null, role: null },
        traceTag: '07070707',
        heardUsSnr: 4,
      })
    ).toBeNull();
    // Nothing went out, so the floor is zero and the next cycle comes at 10 s.
    await vi.advanceTimersByTimeAsync(8000);
    expect(fake.sent.filter((s) => s.frame[0] === 0x37)).toHaveLength(2);
    ad.stop();
  });

  it('names a trace reply after the ping and stops sending once stopped', async () => {
    const { ad, sent } = engine({
      targets: () => ({ repeaters: ['a1b2', 'c3', 'd4'], companions: [] }),
    });
    ad.start();
    await vi.advanceTimersByTimeAsync(1600);
    expect(
      ad.attribute({
        packetType: 'Trace',
        sender: { kind: null, id: null, label: null, role: null },
        traceTag: '07070707',
        heardUsSnr: 6.25,
      })
    ).toEqual({
      sender: { kind: 'trace_reply', id: 'a1b2', label: null, role: null },
      heardUsSnr: 6.25,
    });
    ad.stop();
    const count = sent.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(sent).toHaveLength(count);
    expect(ad.enabled).toBe(false);
    expect(ad.cadenceSeconds()).toBeNull();
  });

  it('puts back contacts a dropped session left zero-hop, for this radio only', async () => {
    const raw = new Uint8Array(CONTACT_FRAME_LEN);
    raw[0] = 3;
    raw[35] = 2;
    const hex = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(
      `rtfm-wardrive-contact-restore:${SELF}:${COMPANION}`,
      JSON.stringify({ self: SELF, target: COMPANION, raw: hex })
    );
    const { ad, sent } = engine();
    await ad.replayRestores();
    expect(sent.map((s) => [s.frame[0], s.frame[35]])).toEqual([[9, 2]]);
  });

  it('keeps a live ping when another one is refused', async () => {
    const fake = fakeCompanion();
    const inner = fake.companion.transmit;
    // The ping to a1 waits 2 s in the radio's queue, then is refused.
    fake.companion.transmit = vi.fn(async (frame: Uint8Array, ...rest: unknown[]) => {
      if (frame[0] === 0x24 && frame[10] === 0xa1) {
        await new Promise((r) => setTimeout(r, 2000));
        return { sent: false, reply: null };
      }
      return (inner as (...a: unknown[]) => ReturnType<typeof inner>)(frame, ...rest);
    }) as typeof inner;
    let k = 1;
    const { ad } = engine(
      {
        targets: () => ({ repeaters: ['a1', 'c3'], companions: [] }),
        random: (n) => new Uint8Array(n).fill(k++),
      },
      fake
    );
    ad.start();
    await vi.advanceTimersByTimeAsync(4000);
    // Discover used 01; a1's ping 02 (refused), c3's ping 03 (sent).
    expect(
      ad.attribute({
        packetType: 'Trace',
        sender: { kind: null, id: null, label: null, role: null },
        traceTag: '03030303',
        heardUsSnr: 2,
      })?.sender.id
    ).toBe('c3');
    ad.stop();
  });

  it('starts no cycle while a frame of the last one still waits to go out', async () => {
    const fake = fakeCompanion();
    const inner = fake.companion.transmit;
    let first = true;
    fake.companion.transmit = vi.fn(async (frame: Uint8Array, ...rest: unknown[]) => {
      if (first) {
        first = false;
        // The first Discover waits 12 s behind other work in the radio chain.
        await new Promise((r) => setTimeout(r, 12000));
      }
      return (inner as (...a: unknown[]) => ReturnType<typeof inner>)(frame, ...rest);
    }) as typeof inner;
    const { ad, sent } = engine({}, fake);
    ad.start();
    await vi.advanceTimersByTimeAsync(11000);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    // The next cycle comes after the floor that Discover bought, not at 10 s.
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent).toHaveLength(2);
    ad.stop();
  });

  it('leaves a restore owed when the radio goes between the override and the ask', async () => {
    const fake = fakeCompanion();
    const inner = fake.companion.request;
    let writes = 0;
    let gone = false;
    let ad: AutoDiscover | null = null;
    fake.companion.request = vi.fn(
      async (frame: Uint8Array, accept: (b: Uint8Array) => unknown) => {
        if (gone) {
          fake.sent.push({ frame, at: Date.now() });
          return null;
        }
        if (frame[0] === 9 && ++writes === 1) {
          const r = await (inner as (...a: unknown[]) => Promise<unknown>)(frame, accept);
          // The link drops right after the zero-hop override was acked.
          gone = true;
          ad?.dispose();
          return r;
        }
        return (inner as (...a: unknown[]) => Promise<unknown>)(frame, accept);
      }
    ) as typeof inner;
    const made = engine({ targets: () => ({ repeaters: [], companions: [COMPANION] }) }, fake);
    ad = made.ad;
    ad.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(codes(fake.sent)).not.toContain(39);
    expect(
      localStorage.getItem(`rtfm-wardrive-contact-restore:${SELF}:${COMPANION}`)
    ).not.toBeNull();
    const next = engine();
    await next.ad.replayRestores();
    expect(next.sent.map((s) => [s.frame[0], s.frame[35]])).toEqual([[9, 0xff]]);
  });
});
