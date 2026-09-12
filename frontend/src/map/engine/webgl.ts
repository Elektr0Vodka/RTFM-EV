/**
 * Best-effort check that a WebGL context can be created. MapLibre needs WebGL;
 * when it is unavailable (locked-down browser, headless, blocklisted GPU) the
 * map falls back to a raster basemap and disables tilt/buildings/deck.
 */
export function isWebglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return gl != null;
  } catch {
    return false;
  }
}
