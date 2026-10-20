import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Fix } from '../../wardrive/messages';
import { MAX_NOISE_READINGS, useRadioStats } from '../../wardrive/useRadioStats';

function core(mv: number) {
  const f = new Uint8Array(11);
  f[0] = 24;
  new DataView(f.buffer).setUint16(2, mv, true);
  return f;
}
function radio(noise: number) {
  const f = new Uint8Array(14);
  f[0] = 24;
  f[1] = 1;
  new DataView(f.buffer).setInt16(2, noise, true);
  return f;
}

function fakeRadio(mv = 3700, noise = -110) {
  const calls: number[] = [];
  return {
    calls,
    stats: vi.fn(async (type: 0 | 1) => {
      calls.push(type);
      return type === 0 ? core(mv) : radio(noise);
    }),
  };
}

const fixAt = (lat: number): Fix => ({ lat, lon: 6, accM: 5, at: Date.now() });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('useRadioStats', () => {
  it('reads the battery at once and every minute', async () => {
    const r = fakeRadio();
    const { result } = renderHook(() => useRadioStats(r, null));
    await tick(10);
    expect(result.current.batteryMv).toBe(3700);
    const first = r.calls.filter((c) => c === 0).length;
    await tick(60000);
    expect(r.calls.filter((c) => c === 0).length).toBe(first + 1);
  });

  it('reads the noise floor every ten seconds', async () => {
    const r = fakeRadio();
    const { result } = renderHook(() => useRadioStats(r, null));
    await tick(10);
    expect(result.current.noiseFloor).toBe(-110);
    const before = r.calls.filter((c) => c === 1).length;
    await tick(10000);
    expect(r.calls.filter((c) => c === 1).length).toBe(before + 1);
  });

  it('reads the noise floor again after moving 50 m and keeps where', async () => {
    const r = fakeRadio();
    const { result, rerender } = renderHook(({ fix }) => useRadioStats(r, fix), {
      initialProps: { fix: fixAt(52.5) },
    });
    await tick(10);
    const before = r.calls.filter((c) => c === 1).length;
    rerender({ fix: fixAt(52.5 + 60 / 111320) });
    await tick(10);
    expect(r.calls.filter((c) => c === 1).length).toBe(before + 1);
    expect(result.current.noiseReadings[result.current.noiseReadings.length - 1]).toMatchObject({
      noise: -110,
      lon: 6,
    });
  });

  it('keeps at most 5000 readings', async () => {
    expect(MAX_NOISE_READINGS).toBe(5000);
  });

  it('asks nothing without a radio and keeps the last value on no answer', async () => {
    const { result } = renderHook(() => useRadioStats(null, null));
    await tick(70000);
    expect(result.current.batteryMv).toBeNull();
    const silent = { stats: vi.fn(async () => null) };
    const second = renderHook(() => useRadioStats(silent, null));
    await tick(10);
    expect(second.result.current.batteryMv).toBeNull();
    expect(second.result.current.noiseFloor).toBeNull();
  });
});
