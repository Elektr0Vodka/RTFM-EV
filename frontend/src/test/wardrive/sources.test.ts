import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Fix } from '../../wardrive/messages';
import { DevicePosition, isMobileDevice } from '../../wardrive/position/sources';

const WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';

describe('device location is for phones and tablets', () => {
  it('trusts the browser mobile hint when there is one', () => {
    expect(
      isMobileDevice({ userAgent: WIN, maxTouchPoints: 10, userAgentData: { mobile: false } })
    ).toBe(false);
    expect(
      isMobileDevice({ userAgent: ANDROID, maxTouchPoints: 5, userAgentData: { mobile: true } })
    ).toBe(true);
  });

  it('accepts an Android tablet that Chromium does not call mobile', () => {
    const tablet =
      'Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';
    expect(
      isMobileDevice({ userAgent: tablet, maxTouchPoints: 10, userAgentData: { mobile: false } })
    ).toBe(true);
  });

  it('refuses a touchscreen Windows laptop without the hint', () => {
    expect(isMobileDevice({ userAgent: WIN, maxTouchPoints: 10 })).toBe(false);
  });

  it('accepts an iPhone and an iPad that reports a Mac', () => {
    expect(isMobileDevice({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isMobileDevice({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 })).toBe(true);
  });

  it('refuses a Mac without touch', () => {
    expect(isMobileDevice({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0 })).toBe(false);
  });
});

describe('device position', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'geolocation');
  });

  function watch(coords: Partial<GeolocationCoordinates>): Promise<Fix> {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: vi.fn((ok: PositionCallback) => {
          ok({
            coords: { latitude: 52, longitude: 5, accuracy: 4, ...coords },
            timestamp: 1000,
          } as GeolocationPosition);
          return 1;
        }),
        clearWatch: vi.fn(),
      },
    });
    return new Promise((resolve) => void new DevicePosition().start(resolve, () => {}));
  }

  it('passes on the speed and heading the phone reports', async () => {
    const fix = await watch({ speed: 5, heading: 90 });
    expect(fix.speedMps).toBe(5);
    expect(fix.headingDeg).toBe(90);
  });

  it('has no speed or heading when the phone gives none', async () => {
    const fix = await watch({ speed: null, heading: Number.NaN });
    expect(fix.speedMps).toBeNull();
    expect(fix.headingDeg).toBeNull();
  });
});
