import { describe, expect, it } from 'vitest';

import { LIVE_LOG_MAX, LiveLog, type LiveEntry } from '../../wardrive/liveLog';

const entry = (at: number): Omit<LiveEntry, 'id'> => ({
  at,
  rssi: -90,
  snr: 4,
  payloadType: 5,
  typeName: 'GroupText',
  direct: false,
  hops: 2,
  lat: null,
  lon: null,
  kept: false,
});

describe('wardrive live log', () => {
  it('keeps the newest 200, newest first', () => {
    const log = new LiveLog();
    for (let i = 0; i < 250; i++) log.push(entry(i));
    const all = log.entries();
    expect(LIVE_LOG_MAX).toBe(200);
    expect(all).toHaveLength(200);
    expect(all[0].at).toBe(249);
    expect(all[199].at).toBe(50);
    expect(all[0].id).toBeGreaterThan(all[1].id);
  });

  it('gives every entry its own id', () => {
    const log = new LiveLog();
    const a = log.push(entry(1));
    const b = log.push(entry(2));
    expect(b.id).not.toBe(a.id);
  });

  it('clears', () => {
    const log = new LiveLog();
    log.push(entry(1));
    log.clear();
    expect(log.entries()).toEqual([]);
  });
});
