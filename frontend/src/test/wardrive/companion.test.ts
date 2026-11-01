import { afterEach, describe, expect, it, vi } from 'vitest';

import { Companion } from '../../wardrive/radio/companion';
import type { RadioTransport } from '../../wardrive/radio/transport';
import { contactFrame, contactsEndFrame, contactsStartFrame } from './radioFrames';

class FakeTransport implements RadioTransport {
  kind = 'ble' as const;
  sent: Uint8Array[] = [];
  private frameCbs: ((f: Uint8Array) => void)[] = [];
  reply: (frame: Uint8Array, t: FakeTransport) => void = () => {};
  async connect() {}
  async disconnect() {}
  async send(frame: Uint8Array) {
    this.sent.push(frame);
    queueMicrotask(() => this.reply(frame, this));
  }
  onFrame(cb: (f: Uint8Array) => void) {
    this.frameCbs.push(cb);
    return () => {
      this.frameCbs = this.frameCbs.filter((x) => x !== cb);
    };
  }
  onClose() {
    return () => {};
  }
  push(frame: number[] | Uint8Array) {
    const f = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
    this.frameCbs.forEach((cb) => cb(f));
  }
}

function signingRadio(t: FakeTransport, opts: { maxLen?: number; fail?: boolean } = {}) {
  const buffered: number[] = [];
  t.reply = (frame) => {
    if (frame[0] === 33) {
      buffered.length = 0;
      const max = opts.maxLen ?? 1024;
      t.push([19, 0, max & 0xff, (max >> 8) & 0xff, 0, 0]);
    } else if (frame[0] === 34) {
      if (opts.fail) return t.push([1, 7]);
      buffered.push(...frame.subarray(1));
      t.push([0]);
    } else if (frame[0] === 35) {
      const sig = new Uint8Array(65);
      sig[0] = 20;
      sig[1] = buffered.length & 0xff;
      t.push(sig);
    }
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Companion', () => {
  it('starts with APP_START and reads its own key and name', async () => {
    const t = new FakeTransport();
    t.reply = (frame) => {
      if (frame[0] !== 0x01) return;
      const b = new Uint8Array(62);
      b[0] = 0x05;
      b.fill(0xab, 4, 36);
      b.set(new TextEncoder().encode('Car'), 58);
      t.push(b);
    };
    const info = await new Companion(t).start();
    expect(info).toEqual({ publicKey: 'AB'.repeat(32), name: 'Car', sf: null });
  });

  it('rejects when the radio does not answer SELF_INFO in time', async () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    const started = new Companion(t).start();
    const assertion = expect(started).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(6001);
    await assertion;
  });

  it('passes every RX log push to the reception listeners', () => {
    const t = new FakeTransport();
    const c = new Companion(t);
    const got: number[] = [];
    c.onReception((r) => got.push(r.rssi));
    t.push([0x88, 0x10, 0xa6, 0x15, 0x00, 0x01]);
    t.push([0x80, 1, 2]);
    expect(got).toEqual([-90]);
  });

  it('signs in 128-byte chunks and returns the 64-byte signature', async () => {
    const t = new FakeTransport();
    signingRadio(t);
    const sig = await new Companion(t).sign(new Uint8Array(200).fill(9));
    expect(sig.length).toBe(64);
    expect(sig[0]).toBe(200);
    expect(t.sent.map((f) => [f[0], f.length])).toEqual([
      [33, 1],
      [34, 129],
      [34, 73],
      [35, 1],
    ]);
  });

  it('runs one signing at a time', async () => {
    const t = new FakeTransport();
    signingRadio(t);
    const c = new Companion(t);
    const [a, b] = await Promise.all([c.sign(new Uint8Array(3)), c.sign(new Uint8Array(5))]);
    expect([a[0], b[0]]).toEqual([3, 5]);
    expect(t.sent.map((f) => f[0])).toEqual([33, 34, 35, 33, 34, 35]);
  });

  it('rejects a signing on an error frame', async () => {
    const t = new FakeTransport();
    signingRadio(t, { fail: true });
    await expect(new Companion(t).sign(new Uint8Array(3))).rejects.toThrow(/refused/);
  });

  it('is not failed by a late error from a signing that timed out', async () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    signingRadio(t);
    const normal = t.reply;
    let lateError = false;
    t.reply = (frame, tr) => {
      // The first data chunk gets no answer in time; its error comes late,
      // just before the radio answers the next signing's start.
      if (frame[0] === 34 && !lateError) {
        lateError = true;
        return;
      }
      if (frame[0] === 33 && lateError) tr.push([1, 7]);
      normal(frame, tr);
    };
    const companion = new Companion(t);
    const first = companion.sign(new Uint8Array(3));
    const firstFails = expect(first).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(8001);
    await firstFails;
    await expect(companion.sign(new Uint8Array(3))).resolves.toHaveLength(64);
  });

  it('rejects data longer than the radio can sign', async () => {
    const t = new FakeTransport();
    signingRadio(t, { maxLen: 10 });
    await expect(new Companion(t).sign(new Uint8Array(11))).rejects.toThrow(/too long/i);
  });

  it('reads the contact table after asking the radio its time', async () => {
    const t = new FakeTransport();
    t.reply = (frame) => {
      if (frame[0] !== 0x04) return;
      t.push(contactsStartFrame(2));
      t.push(contactFrame({ keyHex: 'aa'.repeat(32), name: 'One' }));
      t.push(contactFrame({ keyHex: 'bb'.repeat(32), name: 'Two' }));
      t.push(contactsEndFrame());
    };
    const contacts = await new Companion(t).contacts();
    expect(contacts.map((c) => c.name)).toEqual(['One', 'Two']);
    expect(t.sent.map((f) => Array.from(f))).toEqual([[0x05], [0x04]]);
  });

  it('puts the radio clock times of contacts on the page clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_792_404_000_000));
    const t = new FakeTransport();
    // The radio's clock never set: it thinks it is 1000 s after its epoch.
    t.reply = (frame) => {
      if (frame[0] === 0x05) t.push([9, ...new Uint8Array(new Uint32Array([1000]).buffer)]);
      if (frame[0] !== 0x04) return;
      t.push(contactFrame({ keyHex: 'aa'.repeat(32), name: 'Heard', lastmod: 900 }));
      t.push(
        contactFrame({ keyHex: 'bb'.repeat(32), name: 'Advert only', lastAdvert: 1_792_000_000 })
      );
      t.push(contactsEndFrame());
    };
    const contacts = await new Companion(t).contacts();
    expect(contacts.map((c) => c.seen)).toEqual([1_792_404_000 - 100, 1_792_000_000]);
    expect(t.sent.map((f) => Array.from(f))).toEqual([[0x05], [0x04]]);
    vi.useRealTimers();
  });

  it('reads contacts as before from a radio that does not tell its time', async () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    t.reply = (frame) => {
      if (frame[0] !== 0x04) return;
      t.push(contactFrame({ keyHex: 'aa'.repeat(32), name: 'Heard', lastmod: 900 }));
      t.push(contactsEndFrame());
    };
    const pending = new Companion(t).contacts();
    await vi.advanceTimersByTimeAsync(2000);
    expect((await pending).map((c) => c.seen)).toEqual([900]);
    vi.useRealTimers();
  });

  it('resolves what it has when the end never comes', async () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    t.reply = (frame) => {
      if (frame[0] !== 0x04) return;
      t.push(contactsStartFrame(3));
      t.push(contactFrame({ keyHex: 'aa'.repeat(32), name: 'One' }));
      t.push(contactFrame({ keyHex: 'bb'.repeat(32), name: 'Two' }));
    };
    const pending = new Companion(t).contacts(8000);
    // 1.5 s for a time answer that does not come, then 8 s for the contacts.
    await vi.advanceTimersByTimeAsync(9500);
    expect((await pending).map((c) => c.name)).toEqual(['One', 'Two']);
  });

  it('does not read contacts while a signing runs', async () => {
    const t = new FakeTransport();
    signingRadio(t);
    const signAnswer = t.reply;
    t.reply = (frame, tr) => {
      if (frame[0] === 0x04) tr.push(contactsEndFrame());
      else signAnswer(frame, tr);
    };
    const c = new Companion(t);
    const signing = c.sign(new Uint8Array(10));
    const contacts = c.contacts();
    await Promise.all([signing, contacts]);
    expect(t.sent.map((f) => f[0])).toEqual([33, 34, 35, 0x05, 0x04]);
  });
  it('asks the radio for its core and radio stats', async () => {
    const t = new FakeTransport();
    t.reply = (frame) => {
      if (frame[0] === 0x38 && frame[1] === 0) t.push([24, 0, 0x6c, 0x0e, 0, 0, 0, 0, 0, 0, 0]);
      if (frame[0] === 0x38 && frame[1] === 1)
        t.push([24, 1, 0x90, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    };
    const c = new Companion(t);
    const core = await c.stats(0);
    expect(Array.from(t.sent[0])).toEqual([0x38, 0]);
    expect(core?.[1]).toBe(0);
    const radio = await c.stats(1);
    expect(radio?.[1]).toBe(1);
  });

  it('gives up on stats the radio does not answer and can still sign', async () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    const c = new Companion(t);
    const stats = c.stats(0, 1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await stats).toBeNull();
    vi.useRealTimers();
    signingRadio(t);
    const sig = await c.sign(new Uint8Array([1, 2, 3]));
    expect(sig).toHaveLength(64);
  });
  it('stops asking for stats for a while after a radio did not answer', async () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    const c = new Companion(t);
    const first = c.stats(0, 1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await first).toBeNull();
    const sent = t.sent.length;
    // Asked again at once: no request, no wait (signing is not held up).
    expect(await c.stats(1, 1000)).toBeNull();
    expect(t.sent.length).toBe(sent);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    void c.stats(1, 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sent.length).toBe(sent + 1);
  });

  it('transmits in turn after a signing and resolves on the radio answer', async () => {
    const t = new FakeTransport();
    signingRadio(t);
    const sign = t.reply;
    t.reply = (frame, tt) => {
      if (frame[0] === 0x24) tt.push([6, 0, 1, 2, 3, 4, 0, 0, 0, 0]);
      else if (frame[0] === 0x37) tt.push([0]);
      else sign(frame, tt);
    };
    const c = new Companion(t);
    const signing = c.sign(new Uint8Array(10));
    const trace = c.transmit(new Uint8Array([0x24, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0xa1]), 'sent');
    const discover = c.transmit(new Uint8Array([0x37, 0x81, 0xff, 1, 2, 3, 4]), 'ok');
    await signing;
    const r = await trace;
    expect(r.sent).toBe(true);
    expect(Array.from(r.reply ?? [])).toEqual([6, 0, 1, 2, 3, 4, 0, 0, 0, 0]);
    expect((await discover).sent).toBe(true);
    // The transmits went out only after the whole signing.
    expect(t.sent.map((f) => f[0])).toEqual([33, 34, 35, 0x24, 0x37]);
  });

  it('counts a refused transmit as not sent and a silent one as sent', async () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    t.reply = (frame, tt) => {
      if (frame[0] === 7) tt.push([1, 3]);
    };
    const c = new Companion(t);
    expect(await c.transmit(new Uint8Array([7, 0]), 'ok')).toEqual({ sent: false, reply: null });
    t.reply = () => {};
    const silent = c.transmit(new Uint8Array([0x37, 0x81, 0xff, 1, 2, 3, 4]), 'ok', 3000);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await silent).toEqual({ sent: true, reply: null });
  });

  it('runs a request for the first reply it accepts, or null', async () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    t.reply = (frame, tt) => {
      tt.push([9, 9]);
      tt.push([3, frame[1]]);
    };
    const c = new Companion(t);
    const got = await c.request(
      new Uint8Array([30, 0xbb]),
      (b) => (b[0] === 3 ? b[1] : null),
      1000
    );
    expect(got).toBe(0xbb);
    t.reply = () => {};
    const none = c.request(new Uint8Array([30, 1]), () => 1, 1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await none).toBeNull();
  });

  it('hands every frame to push listeners', () => {
    const t = new FakeTransport();
    const c = new Companion(t);
    const got: number[] = [];
    const off = c.onPush((f) => got.push(f[0]));
    t.push([0x8b, 0, 1, 2, 3, 4, 5, 6]);
    off();
    t.push([0x8c, 0]);
    expect(got).toEqual([0x8b]);
  });
});
