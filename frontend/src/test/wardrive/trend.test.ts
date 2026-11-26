import { describe, expect, it } from 'vitest';

import type { LiveEntry } from '../../wardrive/liveLog';
import { signalTrend, TREND_MAX_GAP_MS } from '../../wardrive/trend';

type Reading = Pick<LiveEntry, 'id' | 'at' | 'rssi' | 'sender'>;

const NOW = 1_800_000_000_000;
const SENDER = { kind: 'relay', id: 'abcd', label: null, role: null } as LiveEntry['sender'];

let nextId = 1;
/** Readings newest first, 10 s apart, ending at NOW. */
function series(rssis: (number | null)[], sender = SENDER): Reading[] {
  return rssis.map((rssi, i) => ({ id: nextId++, at: NOW - i * 10_000, rssi, sender }));
}

describe('signalTrend', () => {
  it('is warmer when the last three are stronger', () => {
    const e = series([-80, -81, -82, -88, -89, -90]);
    expect(signalTrend(e[0], e)).toEqual({ dir: 'warmer', deltaDb: 8 });
  });

  it('is colder when the last three are weaker', () => {
    const e = series([-95, -94, -96, -90, -91, -89]);
    expect(signalTrend(e[0], e)).toEqual({ dir: 'colder', deltaDb: -5 });
  });

  it('is steady inside the 3 dB band', () => {
    const e = series([-88, -89, -90, -90, -91, -92]);
    expect(signalTrend(e[0], e)).toEqual({ dir: 'steady', deltaDb: 2 });
  });

  it('band edge: 3 dB is a change', () => {
    const up = series([-87, -87, -87, -90, -90, -90]);
    expect(signalTrend(up[0], up)).toEqual({ dir: 'warmer', deltaDb: 3 });
    const down = series([-93, -93, -93, -90, -90, -90]);
    expect(signalTrend(down[0], down)).toEqual({ dir: 'colder', deltaDb: -3 });
  });

  it('uses the median, so one spike does not count', () => {
    const e = series([-70, -90, -90, -90, -90, -90]);
    expect(signalTrend(e[0], e)?.dir).toBe('steady');
  });

  it('is null with fewer than six readings', () => {
    const e = series([-80, -81, -82, -88, -89]);
    expect(signalTrend(e[0], e)).toBeNull();
  });

  it('is null without a shown entry or sender id', () => {
    const e = series([-80, -81, -82, -88, -89, -90]);
    expect(signalTrend(null, e)).toBeNull();
    const anon = series([-80, -81, -82, -88, -89, -90], {
      kind: null,
      id: null,
      label: null,
      role: null,
    });
    expect(signalTrend(anon[0], anon)).toBeNull();
  });

  it('cuts the series at a gap of more than ten minutes', () => {
    const e = series([-80, -81, -82, -88, -89, -90]);
    for (let i = 3; i < e.length; i++) e[i] = { ...e[i], at: e[i].at - TREND_MAX_GAP_MS - 1 };
    expect(signalTrend(e[0], e)).toBeNull();
  });

  it('keeps a gap of exactly ten minutes', () => {
    const e = series([-80, -81, -82, -88, -89, -90]);
    const shift = TREND_MAX_GAP_MS - 10_000;
    for (let i = 3; i < e.length; i++) e[i] = { ...e[i], at: e[i].at - shift };
    expect(signalTrend(e[0], e)?.dir).toBe('warmer');
  });

  it('ignores readings heard after an older shown entry', () => {
    const e = series([-60, -60, -60, -80, -81, -82, -88, -89, -90]);
    expect(signalTrend(e[3], e)).toEqual({ dir: 'warmer', deltaDb: 8 });
  });

  it('ignores other senders', () => {
    const mine = series([-80, -81, -82, -88, -89]);
    const other = series([-50], { kind: 'relay', id: 'ffff', label: null, role: null });
    expect(signalTrend(mine[0], [...mine, ...other])).toBeNull();
  });

  it('matches the sender id without regard to case', () => {
    const e = series([-80, -81, -82, -88, -89, -90]);
    const upper = { ...e[5], sender: { ...SENDER, id: 'ABCD' } };
    expect(signalTrend(e[0], [...e.slice(0, 5), upper])?.dir).toBe('warmer');
  });

  it('skips readings without an rssi', () => {
    const e = series([null, -80, Number.NaN, -81, -82, -88, -89, -90]);
    expect(signalTrend(e[0], e)).toEqual({ dir: 'warmer', deltaDb: 8 });
  });

  it('sorts its input', () => {
    const e = series([-80, -81, -82, -88, -89, -90]);
    expect(signalTrend(e[0], [...e].reverse())).toEqual({ dir: 'warmer', deltaDb: 8 });
  });

  it('orders readings heard at the same moment by id', () => {
    const e = series([-80, -81, -82, -88, -89, -90]).map((r) => ({ ...r, at: NOW }));
    // Same time: the higher id is the newer copy.
    const ids = e.map((r, i) => ({ ...r, id: 100 - i }));
    expect(signalTrend(ids[0], [...ids].reverse())).toEqual({ dir: 'warmer', deltaDb: 8 });
  });
});
