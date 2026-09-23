/**
 * Best-effort check that a WebGL context can be created. MapLibre needs WebGL;
 * when it is unavailable (locked-down browser, headless, blocklisted GPU) the
 * map falls back to a raster basemap and disables tilt/buildings/deck.
 *
 * The probe context is released right away. Browsers cap live WebGL contexts
 * per page (Chrome force-loses the oldest one past the cap), and an unreleased
 * probe holds a slot until garbage collection.
 */
export function isWebglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl == null) return false;
    gl.getExtension?.('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
