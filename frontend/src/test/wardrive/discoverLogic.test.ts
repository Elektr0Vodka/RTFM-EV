// When Auto-discover fires, whom it asks, and how answers are matched, against
// core-hunter's own results for the same inputs (discoverVectors.json).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  announceThisCycle,
  directedAskKind,
  matchAskTarget,
  matchTraceTarget,
  nextAnonAsk,
  nextTelemetryTarget,
  normalizeTag,
  rememberAsk,
  rememberPing,
} from '../../wardrive/discover/asks';
import { cadenceSeconds, shouldAutoFire, staggerTargets } from '../../wardrive/discover/gate';
import { nextSweepBatch, noteAsk, retryBackoffFor } from '../../wardrive/discover/sweep';
import {
  heardRepeaterIds,
  selectedCompanionIds,
  selectedRepeaterIds,
  type HeardEntry,
} from '../../wardrive/discover/targets';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V: any = JSON.parse(readFileSync(resolve(__dirname, 'discoverVectors.json'), 'utf-8'));
const T = 1_800_000_000_000;
type Pairs = [string, number][];
const ctx = (o: {
  attempts?: Pairs;
  lastAskedAt?: Pairs;
  heardAt?: Pairs;
  now?: number;
  cursor?: number;
}) => ({
  attempts: new Map(o.attempts ?? []),
  lastAskedAt: new Map(o.lastAskedAt ?? []),
  heardAt: new Map(o.heardAt ?? []),
  now: o.now ?? T,
  cursor: o.cursor ?? 0,
});

describe('fire gate', () => {
  it('fires like core-hunter on time, distance, floor and pending pings', () => {
    for (const c of V.gate) {
      const { fire, ...input } = c;
      expect(
        shouldAutoFire({ pendingTargets: 0, minPeriodMs: 0, ...input }),
        JSON.stringify(input)
      ).toBe(fire);
    }
  });

  it('spaces trace pings 1.5 s apart', () => {
    expect(staggerTargets(['a1', 'b2', 'c3'])).toEqual(V.stagger);
  });

  it('gives the cadence the Status tab shows', () => {
    expect([
      cadenceSeconds(false, 0),
      cadenceSeconds(true, 0),
      cadenceSeconds(true, 12900),
    ]).toEqual([null, 10, 13]);
    expect(V.cadence).toEqual(['Off', 'On, every 10 s', 'On, every 13 s']);
  });
});

describe('sweep', () => {
  it('picks the batch core-hunter picks', () => {
    for (const c of V.sweep)
      expect(nextSweepBatch(c.candidates, ctx(c.ctx)), JSON.stringify(c)).toEqual(c.batch);
  });

  it('counts unheard asks and starts over when the node was heard', () => {
    const heard = noteAsk(
      'a1',
      ctx({ attempts: [['a1', 2]], lastAskedAt: [['a1', T - 1000]], heardAt: [['a1', T - 500]] }),
      T
    );
    const cold = noteAsk('a1', ctx({ attempts: [['a1', 2]], lastAskedAt: [['a1', T - 1000]] }), T);
    expect([...heard.attempts]).toEqual(V.noteAsk.heard);
    expect([...cold.attempts]).toEqual(V.noteAsk.cold);
    expect(heard.lastAskedAt.get('a1')).toBe(T);
    expect([0, 1, 2, 3, 4, 9].map(retryBackoffFor)).toEqual(V.backoff);
  });
});

describe('answers', () => {
  it('names a trace reply after the live ping with its tag, never when ambiguous', () => {
    expect([0xdeadbeef, 'DEADBEEF', '7', -1, 'xyz'].map(normalizeTag)).toEqual(V.trace.normalize);
    let pings = rememberPing([], 0xdeadbeef, 'A1B2C3', T);
    pings = rememberPing(pings, 7, 'c3d4', T + 100);
    expect(matchTraceTarget(pings, 'deadbeef', T + 1000)).toBe(V.trace.hit);
    expect(matchTraceTarget(pings, 'deadbeef', T + 30000)).toBe(V.trace.expired);
    expect(matchTraceTarget(pings, '00000001', T + 1000)).toBe(V.trace.unknown);
    expect(matchTraceTarget(rememberPing(pings, 9, 'a1ffff', T + 200), 'deadbeef', T + 1000)).toBe(
      V.trace.ambiguous
    );
  });

  it('names a response after the one live ask with that first byte', () => {
    const key = V.frames.key;
    const asks = rememberAsk([], key, T);
    expect(matchAskTarget(asks, '01', T + 1000)).toBe(V.asks.match);
    expect(matchAskTarget(asks, '02', T + 1000)).toBe(V.asks.miss);
    expect(matchAskTarget(asks, '01', T + 30000)).toBe(V.asks.expired);
    expect(matchAskTarget(rememberAsk(asks, '01' + 'ff'.repeat(31), T), '01', T + 1000)).toBe(
      V.asks.ambiguous
    );
    expect([
      nextTelemetryTarget(['a', 'b'], 0),
      nextTelemetryTarget(['a', 'b'], 3),
      nextTelemetryTarget([], 0),
    ]).toEqual(V.asks.rotate);
  });

  it('asks each repeater anonymously at most once a minute, alternating kind', () => {
    const key = V.frames.key;
    const k2 = 'ff'.repeat(32);
    const got = [
      nextAnonAsk([key, k2], {}, T),
      nextAnonAsk([key, k2], { [key]: { at: T - 70000, type: 1 } }, T),
      nextAnonAsk([key], { [key]: { at: T - 30000, type: 1 } }, T),
      nextAnonAsk(
        [key, k2],
        { [key]: { at: T - 70000, type: 1 }, [k2]: { at: T - 90000, type: 2 } },
        T
      ),
      nextAnonAsk(['a1b2'], {}, T),
    ];
    expect(got).toEqual(V.anonAsk);
  });

  it('carries one directed ask per cycle and the advert only when it is for a companion target', () => {
    for (const c of V.directed) {
      expect(
        directedAskKind({ telemetryDue: c.telemetryDue, anonDue: c.anonDue, last: c.last })
      ).toBe(c.kind);
    }
    expect([
      announceThisCycle({ introduce: true, connected: true, companionTargets: 1 }),
      announceThisCycle({
        introduce: 'true' as unknown as boolean,
        connected: true,
        companionTargets: 1,
      }),
      announceThisCycle({ introduce: true, connected: true, companionTargets: 0 }),
      announceThisCycle({ introduce: true, connected: false, companionTargets: 2 }),
    ]).toEqual(V.announce);
  });
});

describe('who is a repeater', () => {
  const e = (
    id: string,
    at: number,
    kind: HeardEntry['sender']['kind'],
    role: string | null = null
  ): HeardEntry => ({
    at,
    sender: { kind, id, label: null, role },
  });

  it('reads the newest reception per sender and collapses on the byte a trace sends', () => {
    const entries = [
      e('a1b2', 1, 'relay'),
      e('a1b2c3d4', 2, 'relay'),
      e('c3d4', 3, 'advert_pubkey', 'Repeater'),
      e('c3d4', 4, 'advert_pubkey', 'Companion'),
      e('e5f6', 5, 'trace_reply'),
      e('77', 6, 'path_hash'),
    ];
    expect(heardRepeaterIds(entries)).toEqual(['a1b2c3d4', 'e5f6']);
  });

  it('splits the selection into repeaters and companions on full ids', () => {
    const entries = [
      e('a1b2', 1, 'relay'),
      e('a1ff' + '00'.repeat(30), 2, 'advert_pubkey', 'Companion'),
    ];
    const selected = new Set(['a1b2', 'a1ff' + '00'.repeat(30)]);
    expect(selectedRepeaterIds(entries, selected)).toEqual(['a1b2']);
    expect(selectedCompanionIds(entries, selected)).toEqual(['a1ff' + '00'.repeat(30)]);
    expect(selectedRepeaterIds(entries, new Set())).toEqual([]);
  });

  it('keeps a repeater a repeater after it answered an anonymous ask', () => {
    const k = 'b1' + '22'.repeat(31);
    const entries = [
      { at: 1, sender: { kind: 'relay' as const, id: k, label: null, role: null } },
      { at: 2, sender: { kind: 'anon_reply' as const, id: k, label: null, role: null } },
    ];
    expect(selectedRepeaterIds(entries, new Set([k]))).toEqual([k]);
    expect(selectedCompanionIds(entries, new Set([k]))).toEqual([]);
  });

  it('takes only full keys as companion targets (a channel or short id gets no ask)', () => {
    const full = 'c0' + '11'.repeat(31);
    const entries = [
      { at: 1, sender: { kind: 'direct_hash' as const, id: 'c0', label: null, role: null } },
      { at: 2, sender: { kind: 'channel' as const, id: '#wardrive', label: null, role: null } },
      { at: 3, sender: { kind: 'advert_pubkey' as const, id: full, label: null, role: null } },
    ] as unknown as HeardEntry[];
    expect(selectedCompanionIds(entries, new Set(['c0', '#wardrive', full]))).toEqual([full]);
  });
});
