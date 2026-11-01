import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ObsMessage, TrackMessage } from '../../wardrive/messages';
import { openQueue } from '../../wardrive/queue';

const A = 'AA'.repeat(32);
const B = 'BB'.repeat(32);
const DAY = 86400000;
let dbName = '';
let n = 0;

function obs(rxAt: string): ObsMessage {
  return {
    v: 1,
    origin_id: A,
    rx_at: rxAt,
    hash: '0123456789abcdef',
    raw: '15000102',
    len: 4,
    packet_type: 5,
    payload_len: 2,
    path: [],
    pos: { lat: 52, lon: 5, src: 'phone' },
  };
}

function track(t0: string): TrackMessage {
  return {
    v: 1,
    origin_id: A,
    t0,
    t1: t0,
    lat: 52,
    lon: 5,
    rx_count: 0,
    listening: true,
    src: 'phone',
  };
}

beforeEach(() => {
  dbName = `test-queue-${n++}`;
});

describe('wardrive queue', () => {
  it('returns rows after the watermark, oldest first', async () => {
    const q = await openQueue(dbName);
    const id1 = await q.addObs(A, obs('2026-10-19T10:00:00.000Z'), 1);
    const id2 = await q.addObs(A, obs('2026-10-19T10:00:01.000Z'), 2);
    const batch = await q.batch('rtfm', 'obs', 10);
    expect(batch.map((r) => r.id)).toEqual([id1, id2]);
    await q.ack('rtfm', 'obs', id1);
    expect((await q.batch('rtfm', 'obs', 10)).map((r) => r.id)).toEqual([id2]);
  });

  it('limits the batch size', async () => {
    const q = await openQueue(dbName);
    for (let i = 0; i < 5; i++) await q.addObs(A, obs(`t${i}`), i);
    expect(await q.batch('rtfm', 'obs', 2)).toHaveLength(2);
  });

  it('keeps one radio per batch', async () => {
    const q = await openQueue(dbName);
    await q.addObs(A, obs('a1'), 1);
    await q.addObs(B, { ...obs('b1'), origin_id: B }, 2);
    await q.addObs(A, obs('a2'), 3);
    const batch = await q.batch('rtfm', 'obs', 10);
    expect(batch.map((r) => r.radioKey)).toEqual([A]);
    expect(batch).toHaveLength(1);
  });

  it('keeps obs and tracks apart', async () => {
    const q = await openQueue(dbName);
    await q.addObs(A, obs('o'), 1);
    await q.addTrack(A, track('t'), 1);
    expect(await q.batch('rtfm', 'track', 10)).toEqual([
      { id: expect.any(Number), radioKey: A, message: track('t'), driveId: null },
    ]);
  });

  it('moves the watermark per destination independently', async () => {
    const q = await openQueue(dbName);
    const id = await q.addObs(A, obs('o'), 1);
    await q.ack('rtfm', 'obs', id);
    expect(await q.batch('rtfm', 'obs', 10)).toEqual([]);
    expect(await q.batch('dmc-wardriver', 'obs', 10)).toHaveLength(1);
    expect(await q.pending('rtfm')).toEqual({ obs: 0, tracks: 0 });
    expect(await q.pending('dmc-wardriver')).toEqual({ obs: 1, tracks: 0 });
  });

  it('never moves a watermark backwards', async () => {
    const q = await openQueue(dbName);
    const id1 = await q.addObs(A, obs('1'), 1);
    const id2 = await q.addObs(A, obs('2'), 2);
    await q.ack('rtfm', 'obs', id2);
    await q.ack('rtfm', 'obs', id1);
    expect(await q.batch('rtfm', 'obs', 10)).toEqual([]);
  });

  it('prunes only rows every destination has acked and that are old enough', async () => {
    const q = await openQueue(dbName);
    const old = await q.addObs(A, obs('old'), 0);
    await q.addObs(A, obs('new'), 10 * DAY);
    await q.ack('rtfm', 'obs', old);
    const both = () => ['rtfm', 'dmc-wardriver'];
    expect(await q.prune(7, both, 10 * DAY)).toBe(0);
    await q.ack('dmc-wardriver', 'obs', old);
    expect(await q.prune(7, both, 10 * DAY)).toBe(1);
    expect((await q.batch('other', 'obs', 10)).map((r) => (r.message as ObsMessage).rx_at)).toEqual(
      ['new']
    );
  });

  it('reads one radio after a per-radio watermark, skipping other radios', async () => {
    const q = await openQueue(dbName);
    const a1 = await q.addObs(A, obs('a1'), 1);
    await q.addObs(B, { ...obs('b1'), origin_id: B }, 2);
    const a2 = await q.addObs(A, obs('a2'), 3);
    const dest = `dmc-wardriver@${A}`;
    expect((await q.batchForRadio(dest, 'obs', A, 10)).map((r) => r.id)).toEqual([a1, a2]);
    await q.ack(dest, 'obs', a1);
    expect((await q.batchForRadio(dest, 'obs', A, 10)).map((r) => r.id)).toEqual([a2]);
    expect(await q.batchForRadio(dest, 'obs', A, 1)).toHaveLength(1);
  });

  it('knows the newest row id', async () => {
    const q = await openQueue(dbName);
    expect(await q.lastId('obs')).toBe(0);
    await q.addObs(A, obs('1'), 1);
    const id = await q.addObs(A, obs('2'), 2);
    expect(await q.lastId('obs')).toBe(id);
    expect(await q.lastId('track')).toBe(0);
  });

  it('prune keeps a row a broker of its radio has not acked', async () => {
    const q = await openQueue(dbName);
    const id = await q.addObs(A, obs('old'), 0);
    await q.ack('rtfm', 'obs', id);
    const destsFor = (key: string) => (key === A ? ['rtfm', `dmc-wardriver@${A}`] : ['rtfm']);
    expect(await q.prune(7, destsFor, 10 * DAY)).toBe(0);
    await q.ack(`dmc-wardriver@${A}`, 'obs', id);
    expect(await q.prune(7, destsFor, 10 * DAY)).toBe(1);
  });

  it('prune ignores brokers of other radios', async () => {
    const q = await openQueue(dbName);
    const id = await q.addObs(B, { ...obs('old'), origin_id: B }, 0);
    await q.ack('rtfm', 'obs', id);
    const destsFor = (key: string) => (key === A ? ['rtfm', `dmc-wardriver@${A}`] : ['rtfm']);
    expect(await q.prune(7, destsFor, 10 * DAY)).toBe(1);
  });

  it('counts one radio after a per-radio watermark without loading rows', async () => {
    const q = await openQueue(dbName);
    const a1 = await q.addObs(A, obs('a1'), 1);
    await q.addObs(B, { ...obs('b1'), origin_id: B }, 2);
    await q.addObs(A, obs('a2'), 3);
    const dest = `dmc-wardriver@${A}`;
    expect(await q.countForRadio(dest, 'obs', A)).toBe(2);
    await q.ack(dest, 'obs', a1);
    expect(await q.countForRadio(dest, 'obs', A)).toBe(1);
    expect(await q.countForRadio(dest, 'track', A)).toBe(0);
  });

  it('prune stops at the first row that is young enough', async () => {
    const q = await openQueue(dbName);
    const old = await q.addObs(A, obs('old'), 0);
    const young = await q.addObs(A, obs('young'), 10 * DAY);
    const late = await q.addObs(A, obs('late-but-old'), 1);
    await q.ack('rtfm', 'obs', late);
    expect(await q.prune(7, () => ['rtfm'], 10 * DAY)).toBe(1);
    expect((await q.batch('other', 'obs', 10)).map((r) => r.id)).toEqual([young, late]);
    expect(old).toBeLessThan(young);
  });

  it('lists the radios that have rows of a kind', async () => {
    const q = await openQueue(dbName);
    const C = 'CC'.repeat(32);
    await q.addObs(B, { ...obs('b1'), origin_id: B }, 1);
    await q.addObs(A, obs('a1'), 2);
    await q.addObs(B, { ...obs('b2'), origin_id: B }, 3);
    await q.addTrack(C, { ...track('c1'), origin_id: C }, 4);
    expect(await q.radios('obs')).toEqual([A, B]);
    expect(await q.radios('track')).toEqual([C]);
  });

  it('prune drops old rows of a radio it is told to drop, acked or not', async () => {
    const q = await openQueue(dbName);
    await q.addObs(B, { ...obs('other account'), origin_id: B }, 0);
    await q.addObs(A, obs('own, not uploaded'), 1);
    await q.addObs(B, { ...obs('other account, young'), origin_id: B }, 10 * DAY);
    const destsFor = (key: string) => [`rtfm@${key}`];
    expect(await q.prune(7, destsFor, 10 * DAY, (key) => key === B)).toBe(1);
    expect((await q.batch('other', 'obs', 10)).map((r) => (r.message as ObsMessage).rx_at)).toEqual(
      ['own, not uploaded']
    );
    expect(await q.countForRadio('x', 'obs', B)).toBe(1);
  });

  it('survives reopening the database', async () => {
    const q1 = await openQueue(dbName);
    const id = await q1.addObs(A, obs('o'), 1);
    await q1.ack('rtfm', 'obs', id);
    q1.close();
    const q2 = await openQueue(dbName);
    await q2.addObs(A, obs('p'), 2);
    expect((await q2.batch('rtfm', 'obs', 10)).map((r) => (r.message as ObsMessage).rx_at)).toEqual(
      ['p']
    );
  });

  it('reads stored receptions of given radios added before a time, newest first', async () => {
    const q = await openQueue(dbName);
    await q.addObs(A, obs('a1'), 10);
    await q.addObs(B, { ...obs('b1'), origin_id: B }, 20);
    await q.addObs(A, obs('a2'), 30);
    await q.addObs('CC'.repeat(32), obs('c1'), 35);
    await q.addObs(A, obs('a3'), 50);
    const rows = await q.obsBefore([A, B], 40, 10);
    expect(rows.map((r) => r.message.rx_at)).toEqual(['a2', 'b1', 'a1']);
    expect(rows[0]).toMatchObject({ radioKey: A, addedAt: 30 });
    expect((await q.obsBefore([A, B], 40, 2)).map((r) => r.message.rx_at)).toEqual(['a2', 'b1']);
    expect(await q.obsBefore([], 40, 10)).toEqual([]);
  });

  it('keeps the drive id next to the message and batches one drive at a time', async () => {
    const q = await openQueue(dbName);
    const dest = 'rtfm@' + A;
    await q.addObs(A, obs('a1'), 1, 'x');
    await q.addObs(A, obs('a2'), 2, 'x');
    await q.addObs(A, obs('a3'), 3, 'y');
    await q.addObs(A, obs('a4'), 4);
    const first = await q.batchForRadio(dest, 'obs', A, 10, true);
    expect(first.map((r) => [(r.message as ObsMessage).rx_at, r.driveId])).toEqual([
      ['a1', 'x'],
      ['a2', 'x'],
    ]);
    expect(first[0].message).toEqual(obs('a1'));
    await q.ack(dest, 'obs', first[1].id);
    expect((await q.batchForRadio(dest, 'obs', A, 10, true)).map((r) => r.driveId)).toEqual(['y']);
    // Brokers read across drives, as before.
    expect((await q.batchForRadio(dest, 'obs', A, 10)).map((r) => r.driveId)).toEqual(['y', null]);
  });
});
