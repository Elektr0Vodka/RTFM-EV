// Pure view-window math for interactive chart zoom/pan, ported from
// DutchMeshCore-Observers/web/js/lib/svgchart.js (barViewClamp + the bindTimeZoom
// wheel/drag handlers) and generalized from a [0,n] index domain to an arbitrary
// [min,max] domain. The "x" unit is unix seconds for time charts and a bucket
// index for index/bin charts. A window is [lo, hi].
//
// This module is the single source of truth for the interaction; the Recharts
// hook and the MyNodeView custom-SVG charts both drive it, so they behave
// identically. Pure and unit-tested (chartZoom.test.ts).

export type ChartWindow = [number, number];

// Wheel factors: one notch toward the screen zooms in (shrinks span), away zooms
// out (grows span). Matches the reference (0.8 / 1.25).
export const WHEEL_IN = 0.8;
export const WHEEL_OUT = 1.25;

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// clampWindow clamps [a,b] into the full domain [full[0], full[1]], enforcing a
// minimum span. When the requested span exceeds the full span the full range is
// returned; a sub-minimum span grows around its midpoint, then is shifted back
// inside the bounds. Generalization of the reference barViewClamp.
export function clampWindow(view: ChartWindow, full: ChartWindow, minSpan: number): ChartWindow {
  const fMin = full[0];
  const fMax = full[1];
  const n = fMax - fMin;
  const ms = Math.min(minSpan, n);
  let [a, b] = view;
  if (b - a < ms) {
    const mid = (a + b) / 2;
    a = mid - ms / 2;
    b = mid + ms / 2;
  }
  if (b - a > n) {
    a = fMin;
    b = fMax;
  }
  if (a < fMin) {
    b += fMin - a;
    a = fMin;
  }
  if (b > fMax) {
    a -= b - fMax;
    b = fMax;
  }
  if (a < fMin) a = fMin;
  return [a, b];
}

// zoomAtFraction returns a new window zoomed by `factor` about the point at
// fraction `frac` (0..1) of the current window, keeping that point fixed on
// screen where the bounds allow. Span is clamped to [minSpan, fullSpan].
export function zoomAtFraction(
  view: ChartWindow,
  full: ChartWindow,
  frac: number,
  factor: number,
  minSpan: number
): ChartWindow {
  const [a, b] = view;
  const span = b - a;
  const fullSpan = full[1] - full[0];
  const ms = Math.min(minSpan, fullSpan);
  const ns = clampNum(span * factor, ms, fullSpan);
  const t = a + frac * span;
  const n0 = t - frac * ns;
  return clampWindow([n0, n0 + ns], full, minSpan);
}

// panByFraction shifts the window by `deltaFrac` of its own span (drag pan),
// preserving span and clamping to the full domain.
export function panByFraction(
  view: ChartWindow,
  full: ChartWindow,
  deltaFrac: number,
  minSpan: number
): ChartWindow {
  const [a, b] = view;
  const shift = deltaFrac * (b - a);
  return clampWindow([a + shift, b + shift], full, minSpan);
}
