import { describe, it, expect, vi } from 'vitest';
import { setMapLock2D } from '../../map/engine/mapLock2D';

/* eslint-disable @typescript-eslint/no-explicit-any */
function stubMap() {
  return {
    dragRotate: { disable: vi.fn(), enable: vi.fn() },
    touchZoomRotate: { disableRotation: vi.fn(), enableRotation: vi.fn() },
    touchPitch: { disable: vi.fn(), enable: vi.fn() },
    keyboard: { disableRotation: vi.fn(), enableRotation: vi.fn() },
    setMaxPitch: vi.fn(),
    easeTo: vi.fn(),
  };
}

describe('setMapLock2D', () => {
  it('does not throw on a null map', () => {
    expect(() => setMapLock2D(null as any, true)).not.toThrow();
  });
  it('locks: disables rotation, clamps pitch to 0, flattens camera', () => {
    const m = stubMap();
    setMapLock2D(m as any, true);
    expect(m.dragRotate.disable).toHaveBeenCalled();
    expect(m.touchZoomRotate.disableRotation).toHaveBeenCalled();
    expect(m.setMaxPitch).toHaveBeenCalledWith(0);
    expect(m.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 0, bearing: 0 }));
  });
  it('unlocks: re-enables rotation and restores maxPitch (default 60)', () => {
    const m = stubMap();
    setMapLock2D(m as any, false);
    expect(m.dragRotate.enable).toHaveBeenCalled();
    expect(m.setMaxPitch).toHaveBeenCalledWith(60);
  });
  it('unlocks with a custom maxPitch', () => {
    const m = stubMap();
    setMapLock2D(m as any, false, { maxPitch: 85 });
    expect(m.setMaxPitch).toHaveBeenCalledWith(85);
  });
});
