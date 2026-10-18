/**
 * Geometry for share cards: placing lat/lon points on a card in pixels.
 * Pure, so the same maths runs in tests and in the browser.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Projector = (p: LatLon) => { x: number; y: number };

const MAX_LAT = 85.0511287798;

/** Web Mercator in world units of 1 (0..1 on both axes, y down). */
function mercator(p: LatLon): { x: number; y: number } {
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat));
  const phi = (lat * Math.PI) / 180;
  return {
    x: (p.lon + 180) / 360,
    y: (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2,
  };
}

/**
 * Fit points into `rect` minus `paddingPx` on each side, with one scale for
 * both axes, centred. Used when the card has no base map (hidden position,
 * map failed) so the shape of the routes stays true.
 */
export function fitProjector(points: LatLon[], rect: PxRect, paddingPx: number): Projector | null {
  if (points.length === 0) return null;
  const merc = points.map(mercator);
  const minX = Math.min(...merc.map((m) => m.x));
  const maxX = Math.max(...merc.map((m) => m.x));
  const minY = Math.min(...merc.map((m) => m.y));
  const maxY = Math.max(...merc.map((m) => m.y));
  const innerW = Math.max(0, rect.w - 2 * paddingPx);
  const innerH = Math.max(0, rect.h - 2 * paddingPx);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale =
    spanX === 0 && spanY === 0
      ? 0
      : Math.min(spanX > 0 ? innerW / spanX : Infinity, spanY > 0 ? innerH / spanY : Infinity);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return (p) => {
    const m = mercator(p);
    return { x: cx + (m.x - midX) * scale, y: cy + (m.y - midY) * scale };
  };
}

/**
 * MapLibre's own projection at bearing 0 and pitch 0 (512 px tiles), so a
 * projector can outlive the off-screen map a base map image was taken from.
 */
export function mercatorProjector(
  center: LatLon,
  zoom: number,
  size: { w: number; h: number }
): Projector {
  const world = 512 * 2 ** zoom;
  const c = mercator(center);
  return (p) => {
    const m = mercator(p);
    return { x: size.w / 2 + (m.x - c.x) * world, y: size.h / 2 + (m.y - c.y) * world };
  };
}

const ENTITIES: Record<string, string> = {
  '&copy;': '©',
  '&mdash;': '—',
  '&ndash;': '–',
  '&amp;': '&',
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Basemap attribution HTML as plain text for drawing on a canvas. */
export function attributionText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}
