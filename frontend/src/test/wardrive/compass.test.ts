import { afterEach, describe, expect, it, vi } from 'vitest';

import { compassDeg, requestCompassPermission, watchCompass } from '../../wardrive/compass';

type OrientationCtor = { requestPermission?: () => Promise<string> };
const ctor = () => window as unknown as { DeviceOrientationEvent?: OrientationCtor };

afterEach(() => {
  delete (ctor().DeviceOrientationEvent as OrientationCtor | undefined)?.requestPermission;
  vi.restoreAllMocks();
});

describe('compassDeg', () => {
  it('takes the iPhone compass heading as is', () => {
    expect(compassDeg({ webkitCompassHeading: 30 })).toBe(30);
  });

  it('turns an absolute alpha into a heading', () => {
    expect(compassDeg({ absolute: true, alpha: 90 })).toBe(270);
    expect(compassDeg({ absolute: true, alpha: 0 })).toBe(0);
  });

  it('has none for a relative or missing alpha', () => {
    expect(compassDeg({ absolute: false, alpha: 90 })).toBeNull();
    expect(compassDeg({ absolute: true, alpha: null })).toBeNull();
    expect(compassDeg({})).toBeNull();
  });
});

describe('requestCompassPermission', () => {
  it('needs no question where the browser asks none', async () => {
    expect(await requestCompassPermission()).toBe(true);
  });

  it('asks on iPhone and reads the answer', async () => {
    if (!ctor().DeviceOrientationEvent) {
      (window as unknown as Record<string, unknown>).DeviceOrientationEvent = function () {};
    }
    const orientation = ctor().DeviceOrientationEvent as OrientationCtor;
    orientation.requestPermission = vi.fn().mockResolvedValue('denied');
    expect(await requestCompassPermission()).toBe(false);
    orientation.requestPermission = vi.fn().mockResolvedValue('granted');
    expect(await requestCompassPermission()).toBe(true);
    orientation.requestPermission = vi.fn().mockRejectedValue(new Error('no gesture'));
    expect(await requestCompassPermission()).toBe(false);
  });
});

describe('watchCompass', () => {
  it('reports headings until stopped', () => {
    const seen: number[] = [];
    const stop = watchCompass((deg) => seen.push(deg));
    const name =
      'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    const fire = (alpha: number) => {
      const e = new Event(name);
      Object.assign(e, { absolute: true, alpha });
      window.dispatchEvent(e);
    };
    fire(90);
    stop();
    fire(180);
    expect(seen).toEqual([270]);
  });
});
