import { describe, it, expect, vi } from 'vitest';
import { applyBasemap, markBasemapApplied, getBasemap } from '../../map/engine/basemaps';

/* eslint-disable @typescript-eslint/no-explicit-any */
function stubMap() {
  const handlers: Record<string, (() => void)[]> = {};
  return {
    _sources: new Set<string>(['carto']), // starts on a raster style
    setStyle: vi.fn(),
    getSource(id: string) {
      return this._sources.has(id) ? { setTiles: vi.fn() } : undefined;
    },
    once(ev: string, cb: () => void) {
      (handlers[ev] ||= []).push(cb);
    },
    fire(ev: string) {
      (handlers[ev] || []).forEach((cb) => cb());
    },
  };
}

describe('applyBasemap', () => {
  it('is a no-op when the same basemap signature is applied twice', () => {
    const map = stubMap();
    const ofm = getBasemap('ofm-positron');
    applyBasemap(map as any, ofm, {});
    applyBasemap(map as any, ofm, {});
    expect(map.setStyle).toHaveBeenCalledTimes(1);
  });

  it('calls reapplyOverlays after styledata on a vector switch', () => {
    const map = stubMap();
    const reapplyOverlays = vi.fn();
    applyBasemap(map as any, getBasemap('ofm-positron'), { reapplyOverlays });
    map.fire('styledata');
    expect(reapplyOverlays).toHaveBeenCalledTimes(1);
  });

  it('markBasemapApplied seeds the guard so the first apply is skipped', () => {
    const map = stubMap();
    const ofm = getBasemap('ofm-positron');
    markBasemapApplied(map as any, ofm);
    applyBasemap(map as any, ofm, {});
    expect(map.setStyle).not.toHaveBeenCalled();
  });
});
