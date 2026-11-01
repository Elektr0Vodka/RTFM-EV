import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STATE,
  QUICK_RANGES,
  decodeState,
  encodeState,
  isLive,
  queryParams,
  resolveTime,
  type CoverageState,
} from '../../../wardrive/coverage/state';

const T = new Date(2026, 9, 20, 15, 30, 0).getTime(); // local time

const FULL: CoverageState = {
  lat: 52.1,
  lon: 5.25,
  z: 12.5,
  pitch: 45,
  bearing: 30,
  view3d: true,
  mode: 'auto',
  from: 'now-7d',
  to: 'now',
  drivers: [3, 1],
  senders: ['ab12', 'alice'],
  senderPrefix: '42',
  types: ['Advert', 'GroupText'],
  idclass: ['2b', 'pubkey'],
  nopath: true,
  nodepos: 'reach',
  stand: 'all',
  locate: true,
};

describe('coverage state in the URL', () => {
  it('round trips a full state', () => {
    expect(decodeState(encodeState(FULL))).toEqual(FULL);
  });

  it('writes only what differs from the defaults', () => {
    expect(encodeState(DEFAULT_STATE).toString()).toBe('');
    expect(encodeState({ ...DEFAULT_STATE, mode: 'points' }).toString()).toBe('mode=points');
  });

  it('opens junk on the defaults, key by key', () => {
    const s = decodeState(
      new URLSearchParams(
        'mode=zzz&z=abc&lat=200&lon=x&pitch=-5&from=garbage&drivers=a,2&types=Bogus,Advert&idclass=9b&nodepos=x&stand=y&view=4d'
      )
    );
    expect(s.mode).toBe('hex');
    expect(s.z).toBeNull();
    expect(s.lat).toBeNull();
    expect(s.lon).toBeNull();
    expect(s.pitch).toBe(0);
    expect(s.from).toBe('now-30d');
    expect(s.drivers).toEqual([2]);
    expect(s.types).toEqual(['Advert']);
    expect(s.idclass).toEqual([]);
    expect(s.nodepos).toBe('off');
    expect(s.stand).toBe('filtered');
    expect(s.view3d).toBe(false);
  });
});

describe('time ranges', () => {
  it('offers the quick ranges, Last 30 days last', () => {
    expect(QUICK_RANGES.map((r) => r.id)).toEqual([
      '5m',
      '15m',
      '30m',
      '1h',
      '3h',
      '6h',
      '12h',
      '24h',
      'today',
      '2d',
      '7d',
      '30d',
    ]);
    expect(QUICK_RANGES.find((r) => r.id === 'today')).toEqual({
      id: 'today',
      from: 'now/d',
      to: 'now',
    });
  });

  it('resolves tokens and absolute values to unix seconds', () => {
    expect(resolveTime('now', T)).toBe(Math.floor(T / 1000));
    expect(resolveTime('now-30d', T)).toBe(Math.floor(T / 1000) - 30 * 86400);
    expect(resolveTime('now-15m', T)).toBe(Math.floor(T / 1000) - 900);
    expect(resolveTime('now/d', T)).toBe(Math.floor(new Date(2026, 9, 20).getTime() / 1000));
    expect(resolveTime('2026-10-20T10:00', T)).toBe(
      Math.floor(new Date(2026, 9, 20, 10, 0).getTime() / 1000)
    );
    expect(resolveTime('zzz', T)).toBeNull();
    expect(resolveTime('', T)).toBeNull();
  });

  it('is live while the range ends now', () => {
    expect(isLive('now')).toBe(true);
    expect(isLive('2026-10-20T10:00')).toBe(false);
  });
});

describe('API parameters', () => {
  const BBOX: [number, number, number, number] = [52, 5, 53, 6];

  it('carries every filter', () => {
    const p = queryParams({ ...FULL, stand: 'filtered' }, [1, 2, 3, 4], ['ff'], BBOX, T);
    expect(p).toEqual({
      since: String(Math.floor(T / 1000) - 7 * 86400),
      until: String(Math.floor(T / 1000)),
      users: '3,1',
      sender: ['ab12', 'alice'],
      sender_prefix: '42',
      types: 'Advert,GroupText',
      idclass: '2b,pubkey',
      nopath: 'true',
      ignore: ['ff'],
      bbox: '52,5,53,6',
    });
  });

  it('keeps only drivers, time and ignore in the All stand', () => {
    const p = queryParams(FULL, [1, 2, 3, 4], ['ff'], null, T);
    expect(Object.keys(p).sort()).toEqual(['ignore', 'since', 'until', 'users']);
  });

  it('sends no users when every known driver is picked', () => {
    const p = queryParams({ ...DEFAULT_STATE, drivers: [2, 1] }, [1, 2], [], null, T);
    expect(p.users).toBeUndefined();
  });
});
