import { describe, expect, it } from 'vitest';

import { LiveLog, STORE_MAX, type LiveEntry } from '../../wardrive/liveLog';

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
  packetType: 'GroupText',
  heardDirect: false,
  sender: { kind: null, id: null, label: null, role: null },
  channel: null,
  text: null,
  stored: false,
});

describe('wardrive live log', () => {
  it('keeps the newest 5000, newest first', () => {
    const log = new LiveLog();
    for (let i = 0; i < 5100; i++) log.push(entry(i));
    const all = log.entries();
    expect(STORE_MAX).toBe(5000);
    expect(all).toHaveLength(5000);
    expect(all[0].at).toBe(5099);
    expect(all[4999].at).toBe(100);
    expect(all[0].id).toBeGreaterThan(all[1].id);
  });

  it('puts stored receptions after the live ones', () => {
    const log = new LiveLog();
    log.push(entry(100));
    log.addHistory([
      { ...entry(50), stored: true },
      { ...entry(40), stored: true },
    ]);
    log.push(entry(101));
    expect(log.entries().map((e) => e.at)).toEqual([101, 100, 50, 40]);
    log.clearHistory();
    expect(log.entries().map((e) => e.at)).toEqual([101, 100]);
  });

  it('caps the stored receptions too', () => {
    const log = new LiveLog();
    log.addHistory(Array.from({ length: 5100 }, (_, i) => entry(10000 - i)));
    expect(log.entries()).toHaveLength(5000);
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
