import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  applyBasemap,
  rasterFallbackFor,
  getBasemap,
  VECTOR_LOAD_TIMEOUT_MS,
} from '../../map/engine/basemaps';

/* eslint-disable @typescript-eslint/no-explicit-any */
function stubMap() {
  const once: Record<string, Array<() => void>> = {};
  const on: Record<string, Array<() => void>> = {};
  const cartoSetTiles = vi.fn();
  const sources = new Set<string>(['carto']); // starts on a raster style
  return {
    setStyle: vi.fn(),
    getSource(id: string) {
      return sources.has(id) ? { setTiles: cartoSetTiles } : undefined;
    },
    once(ev: string, cb: () => void) {
      (once[ev] ||= []).push(cb);
    },
    on(ev: string, cb: () => void) {
      (on[ev] ||= []).push(cb);
    },
    off(ev: string, cb: () => void) {
      if (once[ev]) once[ev] = once[ev].filter((f) => f !== cb);
      if (on[ev]) on[ev] = on[ev].filter((f) => f !== cb);
    },
    fireIdle() {
      const cbs = once['idle'] || [];
      once['idle'] = [];
      cbs.forEach((cb) => cb());
    },
    _cartoSetTiles: cartoSetTiles,
  };
}

describe('rasterFallbackFor', () => {
  it('maps a dark vector to the dark keyless raster', () => {
    expect(rasterFallbackFor(getBasemap('nova')).id).toBe('darkgray');
    expect(rasterFallbackFor(getBasemap('ofm-dark')).id).toBe('darkgray');
  });
  it('maps a light vector to the light keyless raster', () => {
    expect(rasterFallbackFor(getBasemap('ofm-positron')).id).toBe('lightgray');
  });
});

describe('applyBasemap raster fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('falls back to a keyless raster when the vector-recolor style fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('rate limited')))
    );
    const map = stubMap();
    applyBasemap(map as any, getBasemap('nova'), {});
    await vi.waitFor(() => expect(map._cartoSetTiles).toHaveBeenCalled());
    expect(map._cartoSetTiles.mock.calls[0][0]).toEqual(getBasemap('darkgray').tiles);
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it('falls back to a keyless raster when a vector style never reaches idle', () => {
    vi.useFakeTimers();
    const map = stubMap();
    applyBasemap(map as any, getBasemap('ofm-positron'), {});
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(VECTOR_LOAD_TIMEOUT_MS + 1);
    expect(map._cartoSetTiles).toHaveBeenCalledWith(getBasemap('lightgray').tiles);
  });

  it('does not fall back when the vector style reaches idle in time', () => {
    vi.useFakeTimers();
    const map = stubMap();
    applyBasemap(map as any, getBasemap('ofm-positron'), {});
    map.fireIdle();
    vi.advanceTimersByTime(VECTOR_LOAD_TIMEOUT_MS + 1);
    expect(map._cartoSetTiles).not.toHaveBeenCalled();
  });
});
