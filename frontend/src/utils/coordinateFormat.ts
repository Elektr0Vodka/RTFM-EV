// Display format for lat/lon positions (Settings > Local). Stored per browser,
// like the distance unit. Wire formats (m: markers, share-location text) are
// not affected; this only changes how positions are shown.

import { useSyncExternalStore } from 'react';
import { forward as mgrsForward } from 'mgrs';

export const COORDINATE_FORMAT_KEY = 'remoteterm-coordinate-format';

export const COORDINATE_FORMATS = ['decimal', 'dms', 'mgrs'] as const;

export type CoordinateFormat = (typeof COORDINATE_FORMATS)[number];

function isCoordinateFormat(value: unknown): value is CoordinateFormat {
  return typeof value === 'string' && COORDINATE_FORMATS.includes(value as CoordinateFormat);
}

export function getSavedCoordinateFormat(): CoordinateFormat {
  try {
    const raw = localStorage.getItem(COORDINATE_FORMAT_KEY);
    return isCoordinateFormat(raw) ? raw : 'decimal';
  } catch {
    return 'decimal';
  }
}

const listeners = new Set<() => void>();

export function setSavedCoordinateFormat(format: CoordinateFormat): void {
  try {
    localStorage.setItem(COORDINATE_FORMAT_KEY, format);
  } catch {
    // localStorage may be unavailable
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === COORDINATE_FORMAT_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The saved coordinate display format; re-renders when it changes (also across tabs). */
export function useCoordinateFormat(): CoordinateFormat {
  return useSyncExternalStore(subscribe, getSavedCoordinateFormat, () => 'decimal');
}

function formatDmsPart(value: number, positive: string, negative: string): string {
  const hemisphere = value < 0 ? negative : positive;
  // Work in tenths of a second so rounding carries into minutes/degrees.
  const tenths = Math.round(Math.abs(value) * 36000);
  const degrees = Math.floor(tenths / 36000);
  const minutes = Math.floor((tenths % 36000) / 600);
  const seconds = (tenths % 600) / 10;
  const mm = String(minutes).padStart(2, '0');
  const ss = seconds.toFixed(1).padStart(4, '0');
  return `${degrees}°${mm}'${ss}"${hemisphere}`;
}

/** Degrees, minutes, seconds, e.g. 52°05'26.5"N 5°07'17.0"E. */
export function formatDms(lat: number, lon: number): string {
  return `${formatDmsPart(lat, 'N', 'S')} ${formatDmsPart(lon, 'E', 'W')}`;
}

/**
 * MGRS at 1 m precision, spaced as "31U FT 45332 73249". Returns null outside
 * the MGRS area (80°S to 84°N; the poles use UPS).
 */
export function formatMgrs(lat: number, lon: number): string | null {
  if (lat < -80 || lat > 84 || lon < -180 || lon > 180) return null;
  try {
    const compact = mgrsForward([lon, lat], 5);
    const match = /^(\d{1,2}[A-Z])([A-Z]{2})(\d*)$/.exec(compact);
    if (!match) return compact;
    const digits = match[3];
    const half = digits.length / 2;
    return `${match[1]} ${match[2]} ${digits.slice(0, half)} ${digits.slice(half)}`;
  } catch {
    return null;
  }
}

/**
 * Format a position for display. `decimals` applies to the decimal format (and
 * to the decimal fallback when MGRS cannot represent the point).
 */
export function formatCoordinates(
  lat: number,
  lon: number,
  format: CoordinateFormat,
  decimals = 5
): string {
  if (format === 'dms') return formatDms(lat, lon);
  if (format === 'mgrs') {
    const mgrs = formatMgrs(lat, lon);
    if (mgrs) return mgrs;
  }
  return `${lat.toFixed(decimals)}, ${lon.toFixed(decimals)}`;
}
