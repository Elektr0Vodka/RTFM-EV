// Where the driver's position comes from: the device's own location (phones
// and tablets) or a USB GPS read through Web Serial (laptops: a laptop only
// publishes with a connected GPS, never with Wi-Fi or IP location).
import type { Fix } from '../messages';
import { NmeaFixBuilder, NmeaLineReader } from './nmea';

const GPS_BAUD = 9600;

export interface PositionSource {
  kind: 'device' | 'usb-gps';
  start(onFix: (f: Fix) => void, onError: (e: Error) => void): Promise<void>;
  stop(): Promise<void>;
}

interface DeviceHints {
  userAgent: string;
  maxTouchPoints: number;
  userAgentData?: { mobile?: boolean };
}

/** A phone or tablet, not a laptop: a touchscreen alone is not enough (touch
 * laptops exist and locate by Wi-Fi). The user agent names Android and iOS
 * devices; otherwise Chromium's userAgentData says; an iPad that reports a
 * Mac is told apart by its touchscreen. */
export function isMobileDevice(d: DeviceHints): boolean {
  // Phones and tablets by name first: Chromium calls an Android tablet not
  // mobile, but it has a location like a phone.
  if (/Android|iPhone|iPad|iPod/i.test(d.userAgent)) return true;
  if (typeof d.userAgentData?.mobile === 'boolean') return d.userAgentData.mobile;
  if (/Mobile/i.test(d.userAgent)) return true;
  return /Macintosh/i.test(d.userAgent) && d.maxTouchPoints > 1;
}

/** Device location is offered on phones and tablets only. */
export function deviceLocationAllowed(): boolean {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return isMobileDevice({
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    userAgentData: nav.userAgentData,
  });
}

const finiteOrNull = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export class DevicePosition implements PositionSource {
  kind = 'device' as const;
  private watchId: number | null = null;

  async start(onFix: (f: Fix) => void, onError: (e: Error) => void): Promise<void> {
    if (!navigator.geolocation) throw new Error('Location is not available');
    this.watchId = navigator.geolocation.watchPosition(
      (p) =>
        onFix({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accM: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
          at: p.timestamp || Date.now(),
          speedMps: finiteOrNull(p.coords.speed),
          headingDeg: finiteOrNull(p.coords.heading),
        }),
      (err) => onError(new Error(err.message || 'Location error')),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  async stop(): Promise<void> {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }
}

export class UsbGpsPosition implements PositionSource {
  kind = 'usb-gps' as const;
  private port: WardriveSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  async start(onFix: (f: Fix) => void, onError: (e: Error) => void): Promise<void> {
    if (!navigator.serial) throw new Error('Web Serial is not available');
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: GPS_BAUD });
    void this.readLoop(onFix, onError);
  }

  private async readLoop(onFix: (f: Fix) => void, onError: (e: Error) => void): Promise<void> {
    const lines = new NmeaLineReader();
    const fixes = new NmeaFixBuilder();
    const text = new TextDecoder();
    try {
      this.reader = this.port!.readable!.getReader();
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        for (const line of lines.push(text.decode(value, { stream: true }))) {
          const fix = fixes.line(line, Date.now());
          if (fix) onFix(fix);
        }
      }
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async stop(): Promise<void> {
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
      await this.port?.close();
    } catch {
      // Already closed.
    }
    this.port = null;
    this.reader = null;
  }
}
