import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  bearingDeg,
  distanceKm,
  flyLegDurationMs,
  flyoverPoints,
  pickNextFlyoverIndex,
  runScreensaver,
  SCREENSAVER_PITCH,
  type LngLat,
} from '../../map/screensaver';
import { useMapScreensaver } from '../../map/useMapScreensaver';

/* eslint-disable @typescript-eslint/no-explicit-any */
function stubMap(center: LngLat = [5, 52]) {
  const cam = { center, zoom: 9, bearing: 10, pitch: 0 };
  return {
    cam,
    getCenter: () => ({ lng: cam.center[0], lat: cam.center[1] }),
    getZoom: () => cam.zoom,
    getBearing: () => cam.bearing,
    getPitch: () => cam.pitch,
    easeTo: vi.fn(),
    flyTo: vi.fn((o: any) => {
      cam.center = o.center;
    }),
    jumpTo: vi.fn(),
    stop: vi.fn(),
    dragRotate: { disable: vi.fn(), enable: vi.fn() },
    touchZoomRotate: { disableRotation: vi.fn(), enableRotation: vi.fn() },
    touchPitch: { disable: vi.fn(), enable: vi.fn() },
    keyboard: { disableRotation: vi.fn(), enableRotation: vi.fn() },
    setMaxPitch: vi.fn(),
  };
}

describe('screensaver helpers', () => {
  it('flyoverPoints keeps only heard nodes with a usable position', () => {
    expect(
      flyoverPoints([
        { lat: 52, lon: 5, last_seen: 1 },
        { lat: 52.1, lon: 5.1, last_seen: null },
        { lat: null, lon: 5, last_seen: 1 },
        { lat: 0, lon: 0, last_seen: 1 },
        { lat: 51, lon: 4, last_seen: 2 },
      ])
    ).toEqual([
      [5, 52],
      [4, 51],
    ]);
  });

  it('distance and bearing are sane', () => {
    expect(distanceKm([5, 52], [5, 53])).toBeCloseTo(111.2, 0);
    expect(bearingDeg([5, 52], [5, 53])).toBeCloseTo(0, 5);
    expect(bearingDeg([5, 52], [6, 52])).toBeGreaterThan(85);
    expect(bearingDeg([5, 52], [6, 52])).toBeLessThan(95);
  });

  it('leg duration is clamped between 8s and 40s', () => {
    expect(flyLegDurationMs(0)).toBe(8000);
    expect(flyLegDurationMs(10)).toBe(13000);
    expect(flyLegDurationMs(1000)).toBe(40000);
  });

  it('picks among the nearest unvisited nodes and restarts the round when all are visited', () => {
    const pts: LngLat[] = [
      [5, 52],
      [5.01, 52],
      [5.02, 52],
      [5.03, 52],
      [5.04, 52],
      [9, 52],
    ];
    const visited = new Set<number>();
    // rng 0 picks the nearest candidate; the start point itself is skipped.
    expect(pickNextFlyoverIndex(pts, [5, 52], visited, () => 0)).toBe(1);
    // The far node is never among the 4 nearest from the cluster.
    for (let i = 0; i < 20; i++) {
      expect(pickNextFlyoverIndex(pts, [5, 52], new Set(), () => 0.99)).not.toBe(5);
    }
    const all = new Set([1, 2, 3, 4, 5]);
    expect(pickNextFlyoverIndex(pts, [5, 52], all, () => 0)).toBe(1);
    expect(all.size).toBe(0);
  });

  it('returns -1 when there is nowhere else to go', () => {
    expect(pickNextFlyoverIndex([], [5, 52], new Set())).toBe(-1);
    expect(pickNextFlyoverIndex([[5, 52]], [5, 52], new Set())).toBe(-1);
  });
});

describe('runScreensaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('orbit tilts towards the given centre, then rotates in linear segments', () => {
    const m = stubMap();
    const run = runScreensaver(m as any, {
      mode: 'orbit',
      orbitCenter: [4.5, 51.9],
      getPoints: () => [],
    });
    expect(m.easeTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [4.5, 51.9], pitch: SCREENSAVER_PITCH })
    );
    vi.advanceTimersByTime(2500);
    expect(m.easeTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [4.5, 51.9], bearing: 100, duration: 30000 })
    );
    vi.advanceTimersByTime(30000);
    expect(m.easeTo).toHaveBeenCalledTimes(3);
    run.stop();
    expect(m.stop).toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(m.easeTo).toHaveBeenCalledTimes(3);
  });

  it('flyover flies to a heard node facing the direction of travel, holds, then continues', () => {
    const m = stubMap([5, 52]);
    const pts: LngLat[] = [
      [5, 52.1],
      [5.1, 52.1],
    ];
    runScreensaver(m as any, {
      mode: 'flyover',
      orbitCenter: null,
      getPoints: () => pts,
      rng: () => 0,
    });
    expect(m.flyTo).toHaveBeenCalledTimes(1);
    const leg = m.flyTo.mock.calls[0][0];
    expect(leg.center).toEqual([5, 52.1]);
    expect(leg.bearing).toBeCloseTo(0, 3);
    expect(leg.pitch).toBe(SCREENSAVER_PITCH);
    vi.advanceTimersByTime(leg.duration);
    expect(m.easeTo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(12000);
    expect(m.flyTo).toHaveBeenCalledTimes(2);
    expect(m.flyTo.mock.calls[1][0].center).toEqual([5.1, 52.1]);
  });

  it('flyover started from a node flies there first, then tours on', () => {
    const m = stubMap([5, 52]);
    const pts: LngLat[] = [
      [5, 52.1],
      [5.1, 52.1],
      [5.2, 52.1],
    ];
    runScreensaver(m as any, {
      mode: 'flyover',
      orbitCenter: null,
      flyFrom: [5.2, 52.1],
      getPoints: () => pts,
      rng: () => 0,
    });
    expect(m.flyTo.mock.calls[0][0].center).toEqual([5.2, 52.1]);
    vi.advanceTimersByTime(m.flyTo.mock.calls[0][0].duration + 12000);
    // Nearest unvisited from the start node, never the start node again.
    expect(m.flyTo.mock.calls[1][0].center).toEqual([5.1, 52.1]);
  });

  it('flyover with no heard nodes orbits the map centre instead', () => {
    const m = stubMap([5, 52]);
    runScreensaver(m as any, { mode: 'flyover', orbitCenter: null, getPoints: () => [] });
    expect(m.flyTo).not.toHaveBeenCalled();
    expect(m.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [5, 52] }));
  });
});

describe('useMapScreensaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(overrides: Partial<Parameters<typeof useMapScreensaver>[0]> = {}) {
    const m = stubMap();
    const mapRef = { current: m as any };
    const hook = renderHook((props: Partial<Parameters<typeof useMapScreensaver>[0]>) =>
      useMapScreensaver({
        mapRef,
        mapReady: true,
        enabled: true,
        mode: 'orbit',
        idleMinutes: 1,
        tilt3D: false,
        getSelectedCenter: () => null,
        getFlyoverPoints: () => [],
        ...overrides,
        ...props,
      })
    );
    return { m, hook };
  }

  it('starts after the idle time, lifting 2D lock', () => {
    const { m, hook } = setup();
    act(() => vi.advanceTimersByTime(59_000));
    expect(hook.result.current.active).toBe(false);
    act(() => vi.advanceTimersByTime(2_000));
    expect(hook.result.current.active).toBe(true);
    expect(m.dragRotate.enable).toHaveBeenCalled();
  });

  it('activity resets the idle clock', () => {
    const { hook } = setup();
    act(() => vi.advanceTimersByTime(50_000));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    act(() => vi.advanceTimersByTime(30_000));
    expect(hook.result.current.active).toBe(false);
  });

  it('input wakes it and restores the saved camera and 2D lock', () => {
    const { m, hook } = setup();
    act(() => vi.advanceTimersByTime(61_000));
    expect(hook.result.current.active).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(hook.result.current.active).toBe(false);
    expect(m.stop).toHaveBeenCalled();
    expect(m.jumpTo).toHaveBeenCalledWith({ center: [5, 52], zoom: 9, bearing: 10, pitch: 0 });
    expect(m.dragRotate.disable).toHaveBeenCalled();
  });

  it('ignores pointer jitter but counts a slow drag made of small steps', () => {
    const { hook } = setup();
    const move = (x: number, y: number) =>
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
    act(() => move(100, 100));
    act(() => vi.advanceTimersByTime(61_000));
    expect(hook.result.current.active).toBe(true);
    // Jitter within 4px of the last counted position does not wake it.
    act(() => {
      move(101, 100);
      move(102, 101);
      move(103, 100);
    });
    expect(hook.result.current.active).toBe(true);
    // 1px steps that add up to 4px do.
    act(() => move(104, 100));
    expect(hook.result.current.active).toBe(false);
  });

  it('keeps 3D when the user had tilt on', () => {
    const { m, hook } = setup({ tilt3D: true });
    act(() => vi.advanceTimersByTime(61_000));
    act(() => {
      window.dispatchEvent(new Event('wheel'));
    });
    expect(hook.result.current.active).toBe(false);
    expect(m.dragRotate.enable).not.toHaveBeenCalled();
    expect(m.dragRotate.disable).not.toHaveBeenCalled();
  });

  it('orbits the selected node when one is open', () => {
    const { m } = setup({ getSelectedCenter: () => [4.2, 51.8] });
    act(() => vi.advanceTimersByTime(61_000));
    expect(m.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [4.2, 51.8] }));
  });

  it('startAt runs while the idle toggle is off, ignores moves, and stops on a click', () => {
    const { m, hook } = setup({ enabled: false });
    const move = (x: number, y: number) =>
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
    act(() => hook.result.current.startAt('orbit', [4.4, 51.9]));
    expect(hook.result.current.active).toBe(true);
    expect(m.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [4.4, 51.9] }));
    act(() => {
      move(10, 10);
      move(300, 300);
    });
    expect(hook.result.current.active).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(hook.result.current.active).toBe(false);
    expect(m.jumpTo).toHaveBeenCalledWith({ center: [5, 52], zoom: 9, bearing: 10, pitch: 0 });
  });

  it('does nothing while disabled', () => {
    const { hook } = setup({ enabled: false });
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(hook.result.current.active).toBe(false);
  });
});
