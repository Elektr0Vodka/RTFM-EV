/**
 * Map "home view" startup logic.
 *
 * The map can start from one of three modes (a server-side app setting):
 *  - 'auto'  keep the historical behaviour (geolocate, then fit all nodes)
 *  - 'home'  fly to a saved home coordinate + zoom
 *  - 'last'  restore the camera the browser saved locally on the last visit
 *
 * The home coordinate + mode live server-side; the frequently-updated "last
 * view" is per-browser and stored in localStorage. This module is pure (apart
 * from the two localStorage helpers) so the startup decision is unit-testable
 * without a live MapLibre instance.
 */

export type MapHomeMode = 'auto' | 'home' | 'last';

/** A MapLibre camera: [lng, lat] centre plus a zoom level. */
export interface MapCamera {
  center: [number, number];
  zoom: number;
}

export interface MapHomeSettings {
  mode: MapHomeMode;
  lat: number | null;
  lon: number | null;
  zoom: number | null;
}

/** localStorage key holding the last camera when mode is 'last'. */
export const MAP_LAST_VIEW_STORAGE_KEY = 'remoteterm-map-last-view';

/** Zoom used in 'home' mode when no home zoom has been saved yet. */
export const DEFAULT_HOME_ZOOM = 11;

const MIN_ZOOM = 0;
const MAX_ZOOM = 22;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function isValidLngLat(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

function isValidCamera(cam: MapCamera): boolean {
  return (
    Array.isArray(cam.center) &&
    cam.center.length === 2 &&
    isValidLngLat(cam.center[0], cam.center[1]) &&
    Number.isFinite(cam.zoom) &&
    cam.zoom >= MIN_ZOOM &&
    cam.zoom <= MAX_ZOOM
  );
}

/**
 * Resolve the startup camera for the given home settings and last saved view.
 * Returns null to signal "fall through to the default auto behaviour" (used by
 * 'auto' mode, and by 'home'/'last' when their data is missing or invalid).
 */
export function resolveHomeView(
  settings: MapHomeSettings,
  lastView: MapCamera | null
): MapCamera | null {
  if (settings.mode === 'home') {
    const { lat, lon, zoom } = settings;
    if (lat == null || lon == null || !isValidLngLat(lon, lat)) return null;
    const z = zoom != null && Number.isFinite(zoom) ? clampZoom(zoom) : DEFAULT_HOME_ZOOM;
    return { center: [lon, lat], zoom: z };
  }
  if (settings.mode === 'last') {
    return lastView && isValidCamera(lastView) ? lastView : null;
  }
  return null;
}

/** Read the last saved camera from localStorage, or null when absent/invalid. */
export function readLastView(): MapCamera | null {
  try {
    const raw = localStorage.getItem(MAP_LAST_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MapCamera;
    return isValidCamera(parsed)
      ? { center: [parsed.center[0], parsed.center[1]], zoom: parsed.zoom }
      : null;
  } catch {
    return null;
  }
}

/** Persist the last camera to localStorage (best-effort; ignores failures). */
export function writeLastView(cam: MapCamera): void {
  if (!isValidCamera(cam)) return;
  try {
    localStorage.setItem(MAP_LAST_VIEW_STORAGE_KEY, JSON.stringify(cam));
  } catch {
    /* ignore (private mode / quota) */
  }
}
