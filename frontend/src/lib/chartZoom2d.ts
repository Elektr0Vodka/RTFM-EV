// Pure 2-D view-box math for interactive scatter-plot zoom/pan. Where chartZoom.ts
// windows a single [min,max] domain (time / index charts), this windows both axes
// at once for an unordered point cloud (e.g. SNR vs RSSI), where index-window
// slicing is meaningless. Each axis reuses the 1-D math in chartZoom.ts, so the
// zoom/pan/clamp behaviour is identical per axis and stays a single source of
// truth. Pure and unit-tested (chartZoom2d.test.ts).

import { clampWindow, zoomAtFraction, panByFraction, type ChartWindow } from './chartZoom';

// A 2-D domain window: x is the horizontal domain (e.g. RSSI), y the vertical
// (e.g. SNR), each a [lo, hi] pair in data units.
export interface ChartBox {
  x: ChartWindow;
  y: ChartWindow;
}

// clampBox clamps each axis of `view` into `full`, honouring per-axis minimum spans.
export function clampBox(
  view: ChartBox,
  full: ChartBox,
  minSpanX: number,
  minSpanY: number
): ChartBox {
  return {
    x: clampWindow(view.x, full.x, minSpanX),
    y: clampWindow(view.y, full.y, minSpanY),
  };
}

// zoomBoxAtPoint zooms both axes by `factor` about the point at domain fractions
// (fracX, fracY) of the current box, keeping that point fixed where bounds allow.
export function zoomBoxAtPoint(
  view: ChartBox,
  full: ChartBox,
  fracX: number,
  fracY: number,
  factor: number,
  minSpanX: number,
  minSpanY: number
): ChartBox {
  return {
    x: zoomAtFraction(view.x, full.x, fracX, factor, minSpanX),
    y: zoomAtFraction(view.y, full.y, fracY, factor, minSpanY),
  };
}

// panBox shifts both axes by the given fractions of their own spans (drag pan),
// preserving span and clamping to the full box.
export function panBox(
  view: ChartBox,
  full: ChartBox,
  deltaFracX: number,
  deltaFracY: number,
  minSpanX: number,
  minSpanY: number
): ChartBox {
  return {
    x: panByFraction(view.x, full.x, deltaFracX, minSpanX),
    y: panByFraction(view.y, full.y, deltaFracY, minSpanY),
  };
}
