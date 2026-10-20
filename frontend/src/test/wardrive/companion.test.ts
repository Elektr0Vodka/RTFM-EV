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
    expect(info).toEqual({ publicKey: 'AB'.repeat(32), name: 'Car' });
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

  it('reads the contact table and sends only GET_CONTACTS', async () => {
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
    expect(t.sent.map((f) => Array.from(f))).toEqual([[0x04]]);
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
    await vi.advanceTimersByTimeAsync(8000);
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
    expect(t.sent.map((f) => f[0])).toEqual([33, 34, 35, 0x04]);
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
});
