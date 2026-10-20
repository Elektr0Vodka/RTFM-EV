// The temporary zero-hop override for a directed ask, against a fake
// companion link. Nothing here touches a radio.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONTACT_FRAME_LEN,
  askAtZeroHop,
  buildGetContactByKey,
  buildOverrideFrame,
  buildRestoreFrame,
  parseContactReply,
  replayPendingRestores,
  type ContactIo,
  type ContactReply,
} from '../../wardrive/discover/contactPath';

const SELF = 'aa'.repeat(32);
const TARGET = 'bb'.repeat(32);
const OTHER_SELF = 'cc'.repeat(32);
const KEY_PREFIX = 'rtfm-wardrive-contact-restore:';

function contactFrame(outPathLen: number): Uint8Array {
  const f = new Uint8Array(CONTACT_FRAME_LEN);
  f[0] = 3;
  f.fill(0xbb, 1, 33);
  f[33] = 1;
  f[35] = outPathLen;
  f[144] = 0x42; // last_mod, must survive the round trip
  return f;
}

function fakeIo(opts: { reply: ContactReply | null; writes?: (boolean | null)[] }) {
  const written: Uint8Array[] = [];
  const answers = [...(opts.writes ?? [])];
  const io: ContactIo = {
    getContact: vi.fn(async () => opts.reply),
    writeContact: vi.fn(async (frame: Uint8Array) => {
      written.push(frame);
      return answers.length ? (answers.shift() as boolean | null) : true;
    }),
  };
  return { io, written };
}

beforeEach(() => localStorage.clear());

describe('contact frames', () => {
  it('reads a contact reply and refuses half a frame', () => {
    const f = contactFrame(0xff);
    expect(parseContactReply(f)).toMatchObject({ found: true, pubkey: TARGET, outPathLen: 0xff });
    expect(parseContactReply(new Uint8Array([1, 2]))).toEqual({ found: false });
    expect(parseContactReply(new Uint8Array([1, 5]))).toBeNull();
    expect(parseContactReply(f.slice(0, 100))).toBeNull();
    expect(Array.from(buildGetContactByKey(TARGET))).toEqual([30, ...new Array(32).fill(0xbb)]);
  });

  it('overrides only the path length and restores every original byte', () => {
    const raw = contactFrame(3);
    const o = buildOverrideFrame(raw);
    expect([o[0], o[35], o[144]]).toEqual([9, 0, 0x42]);
    const r = buildRestoreFrame(raw);
    expect([r[0], r[35], r[144]]).toEqual([9, 3, 0x42]);
    expect(raw[0]).toBe(3);
  });
});

describe('askAtZeroHop', () => {
  it('asks straight away when the contact is already zero-hop', async () => {
    const { io, written } = fakeIo({ reply: parseContactReply(contactFrame(0)) });
    const ask = vi.fn(async () => {});
    expect(await askAtZeroHop(io, SELF, TARGET, ask)).toEqual({ asked: true });
    expect(ask).toHaveBeenCalledOnce();
    expect(written).toEqual([]);
  });

  it('holds a flooding contact zero-hop for the ask and puts it back', async () => {
    const raw = contactFrame(0xff);
    const { io, written } = fakeIo({ reply: parseContactReply(raw) });
    const order: string[] = [];
    const ask = vi.fn(async () => {
      order.push('ask');
      // The record is stored before the override.
      expect(localStorage.getItem(`${KEY_PREFIX}${SELF}:${TARGET}`)).not.toBeNull();
    });
    const r = await askAtZeroHop(io, SELF, TARGET, ask);
    expect(r).toEqual({ asked: true, restored: true });
    expect(written.map((f) => f[35])).toEqual([0, 0xff]);
    expect(order).toEqual(['ask']);
    expect(localStorage.getItem(`${KEY_PREFIX}${SELF}:${TARGET}`)).toBeNull();
  });

  it('asks nothing without a reading, for a stranger, or when the override did not ack', async () => {
    const ask = vi.fn(async () => {});
    expect((await askAtZeroHop(fakeIo({ reply: null }).io, SELF, TARGET, ask)).asked).toBe(false);
    expect(
      (await askAtZeroHop(fakeIo({ reply: { found: false } }).io, SELF, TARGET, ask)).asked
    ).toBe(false);
    const refused = fakeIo({ reply: parseContactReply(contactFrame(0xff)), writes: [false, true] });
    const r = await askAtZeroHop(refused.io, SELF, TARGET, ask);
    expect(r).toMatchObject({ asked: false, restored: true });
    expect(refused.written.map((f) => f[35])).toEqual([0, 0xff]);
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks a stranger when the request adds it itself', async () => {
    const ask = vi.fn(async () => {});
    const r = await askAtZeroHop(fakeIo({ reply: { found: false } }).io, SELF, TARGET, ask, {
      askNonContact: true,
    });
    expect(r).toEqual({ asked: true });
  });

  it('keeps the record when the restore did not ack, and replays it on the next connect', async () => {
    const raw = contactFrame(0xff);
    const first = fakeIo({ reply: parseContactReply(raw), writes: [true, null] });
    expect(await askAtZeroHop(first.io, SELF, TARGET, async () => {})).toMatchObject({
      restored: false,
    });
    expect(localStorage.getItem(`${KEY_PREFIX}${SELF}:${TARGET}`)).not.toBeNull();
    const next = fakeIo({ reply: null });
    expect(await replayPendingRestores(next.io, SELF)).toBe(true);
    expect(next.written.map((f) => [f[0], f[35]])).toEqual([[9, 0xff]]);
    expect(localStorage.getItem(`${KEY_PREFIX}${SELF}:${TARGET}`)).toBeNull();
  });

  it('replays only this companion records and drops broken ones', async () => {
    localStorage.setItem(
      `${KEY_PREFIX}${OTHER_SELF}:${TARGET}`,
      JSON.stringify({
        self: OTHER_SELF,
        target: TARGET,
        raw: Array.from(contactFrame(0xff), (b) => b.toString(16).padStart(2, '0')).join(''),
      })
    );
    localStorage.setItem(`${KEY_PREFIX}${SELF}:${TARGET}`, '{broken');
    const { io, written } = fakeIo({ reply: null });
    expect(await replayPendingRestores(io, SELF)).toBeNull();
    expect(written).toEqual([]);
    expect(localStorage.getItem(`${KEY_PREFIX}${SELF}:${TARGET}`)).toBeNull();
    expect(localStorage.getItem(`${KEY_PREFIX}${OTHER_SELF}:${TARGET}`)).not.toBeNull();
  });

  it('runs one dance at a time on the link', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const io = fakeIo({ reply: parseContactReply(contactFrame(0)) }).io;
    const a = askAtZeroHop(io, SELF, TARGET, async () => {
      order.push('a start');
      await gate;
      order.push('a end');
    });
    const b = askAtZeroHop(io, SELF, TARGET, async () => {
      order.push('b');
    });
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(['a start', 'a end', 'b']);
  });
});
