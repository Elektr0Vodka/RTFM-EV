import type { Map as MlMap } from 'maplibre-gl';

// Ported from EU-Meshcore-Analyzer web/js/lib/map-2d-lock.js. Locking flattens
// the camera and disables all rotate/pitch handlers; unlocking restores them.
export function setMapLock2D(
  map: MlMap | null | undefined,
  on: boolean,
  opts?: { maxPitch?: number },
): void {
  if (!map) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  const call = (obj: unknown, method: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = obj as any;
      if (o && typeof o[method] === 'function') o[method]();
    } catch {
      /* non-fatal */
    }
  };
  if (on) {
    call(m.dragRotate, 'disable');
    call(m.touchZoomRotate, 'disableRotation');
    call(m.touchPitch, 'disable');
    call(m.keyboard, 'disableRotation');
    try {
      if (typeof m.setMaxPitch === 'function') m.setMaxPitch(0);
    } catch {
      /* ignore */
    }
    try {
      m.easeTo({ pitch: 0, bearing: 0, duration: 300 });
    } catch {
      /* ignore */
    }
  } else {
    call(m.dragRotate, 'enable');
    call(m.touchZoomRotate, 'enableRotation');
    call(m.touchPitch, 'enable');
    call(m.keyboard, 'enableRotation');
    const maxPitch = typeof opts?.maxPitch === 'number' ? opts.maxPitch : 60;
    try {
      if (typeof m.setMaxPitch === 'function') m.setMaxPitch(maxPitch);
    } catch {
      /* ignore */
    }
  }
}
