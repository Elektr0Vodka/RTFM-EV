// The phone's compass for the direction arrow. iPhones give a compass heading
// and ask permission (from a tap); Android gives an absolute alpha
// (counter-clockwise from north) without asking.

interface OrientationReading {
  webkitCompassHeading?: number;
  absolute?: boolean;
  alpha?: number | null;
}

/** Degrees clockwise from north, or null when the reading is not tied to north. */
export function compassDeg(e: OrientationReading): number | null {
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
    return e.webkitCompassHeading;
  }
  if (e.absolute === true && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
    return (360 - e.alpha) % 360;
  }
  return null;
}

type PermissionAsker = { requestPermission?: () => Promise<string> };

/** Asks for the compass where the browser wants a question (iPhone); must run
 * from a tap. True when the compass may be read. */
export async function requestCompassPermission(): Promise<boolean> {
  const ctor = (globalThis as { DeviceOrientationEvent?: PermissionAsker }).DeviceOrientationEvent;
  if (typeof ctor?.requestPermission !== 'function') return true;
  try {
    return (await ctor.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Calls `cb` with each compass heading; returns a function that stops it. */
export function watchCompass(cb: (deg: number, at: number) => void): () => void {
  const name =
    'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  const listener = (e: Event) => {
    const deg = compassDeg(e as unknown as OrientationReading);
    if (deg !== null) cb(deg, Date.now());
  };
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
