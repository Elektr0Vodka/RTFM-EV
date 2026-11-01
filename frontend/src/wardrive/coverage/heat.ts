// Locate's density cloud as an image (map.mesh-hunter.eu's heatImageData):
// warm to hot only, since low density is not "cold signal"; cells below the
// floor stay clear so the grid's rectangle never shows; alpha ramps to 210.
// Grid row 0 is south and image row 0 is north, hence the flip.
import type { Heatmap } from './locate';

const FLOOR = 0.12;

export type Rgb = [number, number, number];

export function heatColor(v: number, stops: Rgb[]): Rgb {
  const t = Math.max(0, Math.min(1, v)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  const f = t - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as Rgb;
}

export function heatImageData(grid: Float32Array, rows: number, cols: number, stops: Rgb[]) {
  const data = new Uint8ClampedArray(rows * cols * 4);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r * cols + c];
      const idx = ((rows - 1 - r) * cols + c) * 4;
      const [cr, cg, cb] = heatColor(v, stops);
      data[idx] = cr;
      data[idx + 1] = cg;
      data[idx + 2] = cb;
      data[idx + 3] = v < FLOOR ? 0 : Math.round((210 * (v - FLOOR)) / (1 - FLOOR));
    }
  }
  return data;
}

export function imageCoordinates(b: Heatmap['bounds']): [number, number][] {
  return [
    [b.minLon, b.maxLat],
    [b.maxLon, b.maxLat],
    [b.maxLon, b.minLat],
    [b.minLon, b.minLat],
  ];
}

const hexRgb = (hex: string): Rgb => {
  const s = hex.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};

/** The heatmap as a data URL over its bounds, or null where a canvas cannot draw. */
export function heatImage(
  hm: Heatmap,
  stopColors: string[]
): { url: string; coordinates: [number, number][] } | null {
  const canvas = document.createElement('canvas');
  canvas.width = hm.cols;
  canvas.height = hm.rows;
  const ctx = (() => {
    try {
      return canvas.getContext('2d');
    } catch {
      return null;
    }
  })();
  if (!ctx) return null;
  const img = ctx.createImageData(hm.cols, hm.rows);
  img.data.set(heatImageData(hm.grid, hm.rows, hm.cols, stopColors.map(hexRgb)));
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL(), coordinates: imageCoordinates(hm.bounds) };
}
