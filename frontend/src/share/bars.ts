import { cardPalette, wrapLines, type CardTone } from './cardChrome';
import type { PxRect } from './geo';

export interface BarItem {
  label: string;
  value: number;
  color: string;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * A ranked bar list: label left, value right, a bar underneath that grows with
 * `progress` (0..1). Items with value 0 are left out.
 */
export function drawBarList(
  ctx: CanvasRenderingContext2D,
  rect: PxRect,
  items: BarItem[],
  progress: number,
  tone: CardTone,
  formatValue: (n: number) => string
): void {
  const pal = cardPalette(tone);
  const shown = items.filter((i) => i.value > 0);
  if (shown.length === 0) return;
  const max = Math.max(...shown.map((i) => i.value));
  const rowH = Math.min(64, rect.h / shown.length);
  const measure = (s: string) => ctx.measureText(s).width;
  const p = Math.max(0, Math.min(1, progress));
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  shown.forEach((item, i) => {
    const y = rect.y + i * rowH;
    const value = formatValue(Math.round(item.value * p));
    ctx.font = `700 20px ${FONT}`;
    const valueW = measure(value);
    ctx.fillStyle = pal.text;
    ctx.fillText(value, rect.x + rect.w - valueW, y + 22);
    ctx.font = `500 18px ${FONT}`;
    ctx.fillStyle = pal.muted;
    for (const l of wrapLines(measure, item.label, rect.w - valueW - 16, 1))
      ctx.fillText(l, rect.x, y + 22);
    const barY = y + 32;
    const barH = Math.max(6, Math.min(14, rowH - 42));
    ctx.fillStyle = tone === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(rect.x, barY, rect.w, barH);
    const w = (item.value / max) * rect.w * p;
    if (w > 0) {
      ctx.fillStyle = item.color;
      ctx.fillRect(rect.x, barY, w, barH);
    }
  });
  ctx.restore();
}

/** A line over `values`, drawn up to `progress` (0..1). */
export function drawSparkline(
  ctx: CanvasRenderingContext2D,
  rect: PxRect,
  values: number[],
  progress: number,
  color: string
): void {
  if (values.length < 2) return;
  const max = Math.max(1, ...values);
  const upto = Math.max(0, Math.min(values.length - 1, Math.round(progress * (values.length - 1))));
  const at = (i: number) => ({
    x: rect.x + (i / (values.length - 1)) * rect.w,
    y: rect.y + rect.h - (values[i] / max) * rect.h,
  });
  ctx.save();
  ctx.beginPath();
  const first = at(0);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i <= upto; i++) {
    const pt = at(i);
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}
