import { VISUAL_RECT, type CardTone } from './cardChrome';
import type { PxRect } from './geo';

/** Map marks shared by the cards: markers, labels and route segments. */

export type Px = { x: number; y: number };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function drawMarker(ctx: CanvasRenderingContext2D, at: Px, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
}

/** Draws a label unless it would overlap one already drawn (mush on a card). */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  at: Px,
  label: string,
  tone: CardTone,
  taken: Box[],
  area: PxRect = VISUAL_RECT
) {
  ctx.font = '600 15px system-ui, sans-serif';
  const w = ctx.measureText(label).width;
  const x = Math.max(area.x + 4, Math.min(at.x + 14, area.x + area.w - 8 - w));
  const box = { x: x - 2, y: at.y - 25, w: w + 4, h: 20 };
  if (taken.some((t) => overlaps(t, box))) return;
  taken.push(box);
  ctx.lineWidth = 4;
  ctx.strokeStyle = tone === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)';
  ctx.fillStyle = tone === 'light' ? '#111827' : '#f8fafc';
  ctx.strokeText(label, x, at.y - 10);
  ctx.fillText(label, x, at.y - 10);
}

/** A route segment drawn `frac` (0..1) of the way, with a dark under-stroke
 *  so it reads on any basemap; dashed for a gap over unknown hops. */
export function drawSegment(
  ctx: CanvasRenderingContext2D,
  from: Px,
  to: Px,
  frac: number,
  color: string,
  dashed: boolean
) {
  if (frac <= 0) return;
  const end = { x: from.x + (to.x - from.x) * frac, y: from.y + (to.y - from.y) * frac };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dashed ? [10, 8] : []);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Colour for an SNR on the card's signal ramp (bad below -5 dB, good from 5 dB). */
export function snrColor(
  snr: number | null,
  signal: { bad: string; mid: string; good: string },
  unknown: string
): string {
  if (snr == null) return unknown;
  if (snr < -5) return signal.bad;
  if (snr < 5) return signal.mid;
  return signal.good;
}
