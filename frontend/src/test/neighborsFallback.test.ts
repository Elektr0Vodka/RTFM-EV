import { describe, it, expect } from 'vitest';
import { buildNeighborsFromHistory } from '../components/repeater/neighborsFallback';
import type { RepeaterNeighborHistoryResponse } from '../types';

const now = 1_000_000; // seconds

const history = (
  neighbors: RepeaterNeighborHistoryResponse['neighbors']
): RepeaterNeighborHistoryResponse => ({ neighbors });

describe('buildNeighborsFromHistory', () => {
  it('reconstructs one neighbor per entry from the latest repeater sample', () => {
    const out = buildNeighborsFromHistory(
      history([
        {
          neighbor_pubkey: 'aa11bb22',
          repeater_samples: [
            { observed_at: now - 600, snr: 3.0, secs_ago: 600 },
            { observed_at: now - 120, snr: 5.5, secs_ago: 120 },
          ],
          self_samples: [],
        },
      ]),
      now
    );
    expect(out).toEqual([
      { pubkey_prefix: 'aa11bb22', name: null, snr: 5.5, last_heard_seconds: 120 },
    ]);
  });

  it('picks the newest sample by observed_at, not array position', () => {
    const out = buildNeighborsFromHistory(
      history([
        {
          neighbor_pubkey: 'cc33',
          repeater_samples: [
            { observed_at: now - 60, snr: 9.0, secs_ago: 60 },
            { observed_at: now - 3600, snr: 1.0, secs_ago: 3600 },
          ],
          self_samples: [],
        },
      ]),
      now
    );
    expect(out[0].snr).toBe(9.0);
    expect(out[0].last_heard_seconds).toBe(60);
  });

  it('derives last_heard_seconds from observed_at when secs_ago is null', () => {
    const out = buildNeighborsFromHistory(
      history([
        {
          neighbor_pubkey: 'dd44',
          repeater_samples: [{ observed_at: now - 900, snr: 2.0, secs_ago: null }],
          self_samples: [],
        },
      ]),
      now
    );
    expect(out[0].last_heard_seconds).toBe(900);
  });

  it('skips entries that have no repeater samples', () => {
    const out = buildNeighborsFromHistory(
      history([
        {
          neighbor_pubkey: 'ee55',
          repeater_samples: [],
          self_samples: [{ observed_at: now, snr: 4, rssi: null }],
        },
        {
          neighbor_pubkey: 'ff66',
          repeater_samples: [{ observed_at: now - 30, snr: 7.0, secs_ago: 30 }],
          self_samples: [],
        },
      ]),
      now
    );
    expect(out.map((n) => n.pubkey_prefix)).toEqual(['ff66']);
  });

  it('never returns a negative last_heard_seconds for a future observed_at', () => {
    const out = buildNeighborsFromHistory(
      history([
        {
          neighbor_pubkey: 'aa99',
          repeater_samples: [{ observed_at: now + 50, snr: 1.0, secs_ago: null }],
          self_samples: [],
        },
      ]),
      now
    );
    expect(out[0].last_heard_seconds).toBe(0);
  });

  it('returns an empty array for empty history', () => {
    expect(buildNeighborsFromHistory(history([]), now)).toEqual([]);
  });
});
