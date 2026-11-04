import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api';
import {
  antennaTestCandidates,
  defaultSelection,
} from '../components/antennaTest/antennaTestCandidates';
import {
  isNoReplyError,
  runAntennaTest,
  worstCaseSeconds,
  type AntennaTestTarget,
} from '../components/antennaTest/antennaTestRunner';
import { bestIndex, compareRows } from '../components/antennaTest/AntennaTestReport';
import type { AntennaTestNodeStats, AntennaTestRunDetail, Contact, RadioConfig } from '../types';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
} from '../types';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);
const C = 'cc'.repeat(32);

const targets: AntennaTestTarget[] = [
  { publicKey: A, name: 'A', distanceKm: 1 },
  { publicKey: B, name: 'B', distanceKm: null },
];

const noSleep = vi.fn(async () => {});

describe('runAntennaTest', () => {
  it('goes node by node per round and records both SNR directions', async () => {
    const calls: string[] = [];
    const sleep = vi.fn(async () => {});
    const outcome = await runAntennaTest({
      targets,
      tracesPerNode: 2,
      gapMs: 500,
      sleep,
      trace: async (key) => {
        calls.push(key);
        return { remote_snr: 5.5, local_snr: -2.25, path_len: 1 };
      },
    });

    expect(calls).toEqual([A, B, A, B]);
    // No pause before the first trace, one before each of the other three.
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(500, undefined);
    expect(outcome.status).toBe('finished');
    expect(outcome.results.map((r) => r.attempts.length)).toEqual([2, 2]);
    expect(outcome.results[0].attempts[0]).toEqual({
      replied: true,
      remote_snr: 5.5,
      local_snr: -2.25,
    });
    expect(outcome.results[1].distance_km).toBeNull();
  });

  it('counts a 422 as a missed reply and keeps going', async () => {
    const outcome = await runAntennaTest({
      targets,
      tracesPerNode: 1,
      gapMs: 0,
      sleep: noSleep,
      trace: async (key) => {
        if (key === A) throw new ApiError('No trace response heard', 422);
        return { remote_snr: 1, local_snr: 2, path_len: 1 };
      },
    });
    expect(outcome.status).toBe('finished');
    expect(outcome.results[0].attempts).toEqual([
      { replied: false, remote_snr: null, local_snr: null },
    ]);
    expect(outcome.results[1].attempts[0].replied).toBe(true);
  });

  it('stops on any other error and keeps only nodes that were traced', async () => {
    const outcome = await runAntennaTest({
      targets,
      tracesPerNode: 2,
      gapMs: 0,
      sleep: noSleep,
      trace: async (key) => {
        if (key === B) throw new ApiError('Radio not connected', 503);
        return { remote_snr: 1, local_snr: 2, path_len: 1 };
      },
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.results.map((r) => r.public_key)).toEqual([A]);
    if (outcome.status === 'failed') {
      expect((outcome.error as Error).message).toBe('Radio not connected');
    }
  });

  it('stops when aborted and returns what ran', async () => {
    const controller = new AbortController();
    const trace = vi.fn(async () => {
      controller.abort();
      return { remote_snr: 3, local_snr: 4, path_len: 1 };
    });
    const outcome = await runAntennaTest({
      targets,
      tracesPerNode: 3,
      gapMs: 0,
      sleep: noSleep,
      signal: controller.signal,
      trace,
    });
    expect(trace).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe('cancelled');
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].public_key).toBe(A);
  });

  it('reports progress with the node about to be traced', async () => {
    const progress: (string | null)[] = [];
    await runAntennaTest({
      targets,
      tracesPerNode: 1,
      gapMs: 0,
      sleep: noSleep,
      trace: async () => ({ remote_snr: 1, local_snr: 1, path_len: 1 }),
      onProgress: (p) => progress.push(p.current?.publicKey ?? null),
    });
    expect(progress).toEqual([A, B, null]);
  });
});

describe('isNoReplyError / worstCaseSeconds', () => {
  it('treats only an ApiError 422 as no reply', () => {
    expect(isNoReplyError(new ApiError('x', 422))).toBe(true);
    expect(isNoReplyError(new ApiError('x', 500))).toBe(false);
    expect(isNoReplyError(new Error('x'))).toBe(false);
  });

  it('adds the full trace timeout plus the gaps between traces', () => {
    expect(worstCaseSeconds(0, 3, 2)).toBe(0);
    expect(worstCaseSeconds(2, 3, 2)).toBe(6 * 15 + 5 * 2);
  });
});

function contact(publicKey: string, name: string, type: number, extra: Partial<Contact> = {}) {
  return {
    public_key: publicKey,
    name,
    type,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...extra,
  } as Contact;
}

describe('antennaTestCandidates', () => {
  const config = { lat: 52, lon: 5 } as RadioConfig;

  it('offers full-key repeaters and room servers, direct-heard first and nearest first', () => {
    const candidates = antennaTestCandidates(
      [
        contact(A, 'Far direct', CONTACT_TYPE_REPEATER, { lat: 52.5, lon: 5 }),
        contact(B, 'Near direct', CONTACT_TYPE_ROOM, { lat: 52.05, lon: 5 }),
        contact(C, 'Two hops', CONTACT_TYPE_REPEATER),
        contact('dd'.repeat(32), 'Never heard', CONTACT_TYPE_REPEATER),
        contact('ee'.repeat(32), 'Companion', CONTACT_TYPE_CLIENT),
        contact('ff'.repeat(32), 'Sensor', CONTACT_TYPE_SENSOR),
        contact('1234', 'Prefix only', CONTACT_TYPE_REPEATER),
      ],
      config,
      new Map([
        [A, 0],
        [B, 0],
        [C, 2],
      ])
    );
    expect(candidates.map((c) => c.name)).toEqual([
      'Near direct',
      'Far direct',
      'Two hops',
      'Never heard',
    ]);
    expect(candidates[3].hops).toBeUndefined();
    expect(defaultSelection(candidates, 100)).toEqual([B, A]);
    expect(defaultSelection(candidates, 1)).toEqual([B]);
  });
});

function stats(publicKey: string, over: Partial<AntennaTestNodeStats> = {}): AntennaTestNodeStats {
  return {
    public_key: publicKey,
    name: publicKey.slice(0, 2),
    distance_km: null,
    attempts: 3,
    replies: 3,
    reply_rate: 1,
    remote_snr: { avg: 1, min: 1, max: 1 },
    local_snr: { avg: 1, min: 1, max: 1 },
    ...over,
  };
}

function run(id: number, nodes: AntennaTestNodeStats[]): AntennaTestRunDetail {
  return {
    id,
    antenna: `ant${id}`,
    notes: '',
    radio_public_key: null,
    radio_name: null,
    traces_per_node: 3,
    started_at: id,
    finished_at: id,
    summary: {
      nodes: nodes.length,
      nodes_replied: nodes.length,
      attempts: 3,
      replies: 3,
      reply_rate: 1,
      remote_snr_avg: 1,
      local_snr_avg: 1,
    },
    nodes,
  };
}

describe('compare helpers', () => {
  it('lists every node once with a gap where a run did not trace it', () => {
    const rows = compareRows([run(1, [stats(A), stats(B)]), run(2, [stats(B), stats(C)])]);
    expect(rows.map((r) => r.publicKey)).toEqual([A, B, C]);
    expect(rows[0].perRun[1]).toBeNull();
    expect(rows[2].perRun[0]).toBeNull();
    expect(rows[1].perRun.every((n) => n !== null)).toBe(true);
  });

  it('picks the single highest value, only when at least two runs have one', () => {
    expect(bestIndex([1, 3, 2])).toBe(1);
    expect(bestIndex([null, -4, -7])).toBe(1);
    expect(bestIndex([null, 5])).toBe(-1);
    expect(bestIndex([2, 2, 1])).toBe(-1);
  });
});
