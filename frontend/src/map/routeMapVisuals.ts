/**
 * Marker/colour helpers shared by the small route-drawing map embeds:
 * `PathRouteMap` (resolved message paths) and `TraceRouteMap` (trace
 * results). Kept in one place so both draw hop markers identically.
 */

// Colors for hop markers (indexed by hop number - 1)
export const HOP_COLORS = [
  '#f97316', // Hop 1: orange
  '#eab308', // Hop 2: yellow
  '#22c55e', // Hop 3: green
  '#06b6d4', // Hop 4: cyan
  '#ec4899', // Hop 5: pink
  '#f43f5e', // Hop 6: rose
  '#a855f7', // Hop 7: purple
  '#64748b', // Hop 8: slate
];
export const SENDER_COLOR = '#3b82f6'; // blue
export const RECEIVER_COLOR = '#8b5cf6'; // violet

export function getHopColor(hopIndex: number): string {
  return HOP_COLORS[hopIndex % HOP_COLORS.length];
}

export function markerEl(label: string, color: string, title: string): HTMLElement {
  const el = document.createElement('div');
  el.title = title;
  el.textContent = label;
  el.style.cssText =
    'width:24px;height:24px;border-radius:50%;color:#fff;display:flex;align-items:center;' +
    'justify-content:center;font-size:11px;font-weight:700;border:2px solid rgba(255,255,255,0.8);' +
    `box-shadow:0 1px 4px rgba(0,0,0,0.4);background:${color};`;
  return el;
}
