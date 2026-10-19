import type { CardBrand } from '../brand';
import { CARD_H, CARD_W, cardPalette, wrapLines } from '../cardChrome';
import { renderCard, type RenderedCard } from '../renderCard';
import type { ChartSnapshot, PxBox } from './chartCapture';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const PAD = 36;

/** Where the chart picture goes on the card. */
export const CHART_BOX: PxBox = { x: PAD, y: 128, w: CARD_W - 2 * PAD, h: CARD_H - 128 - 76 };

export interface ChartCardText {
  /** Above the title: the time range, or a plain "Graph". */
  kicker: string;
  title: string;
  /** "24 h in 4 seconds"; null when the time range is not known. */
  speed: string | null;
  /** The clock under the playing chart, for progress 0..1; null without a time range. */
  clock: ((progress: number) => string) | null;
}

export interface ChartImages {
  full: CanvasImageSource;
  base: CanvasImageSource | null;
}

/** The chart scaled to fit `CHART_BOX`, centred, in card px. */
export function fitChart(snap: Pick<ChartSnapshot, 'width' | 'height'>): PxBox {
  const scale = Math.min(CHART_BOX.w / snap.width, CHART_BOX.h / snap.height);
  const w = snap.width * scale;
  const h = snap.height * scale;
  return {
    x: CHART_BOX.x + (CHART_BOX.w - w) / 2,
    y: CHART_BOX.y + (CHART_BOX.h - h) / 2,
    w,
    h,
  };
}

/** The plot area in card px. */
export function plotOnCard(snap: ChartSnapshot, at: PxBox): PxBox {
  const s = at.w / snap.width;
  return {
    x: at.x + snap.plot.x * s,
    y: at.y + snap.plot.y * s,
    w: snap.plot.w * s,
    h: snap.plot.h * s,
  };
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  text: ChartCardText,
  brand: CardBrand,
  tone: ChartSnapshot['tone']
): void {
  const pal = cardPalette(tone);
  const measure = (s: string) => ctx.measureText(s).width;
  const right = CARD_W - PAD;

  // Brand top right; the title gets the width left of it.
  let brandLeft = right;
  if (brand.name) {
    ctx.font = `700 22px ${FONT}`;
    const [name] = wrapLines(measure, brand.name, 260, 1);
    if (name) {
      brandLeft -= measure(name);
      ctx.fillStyle = pal.accent;
      ctx.fillText(name, brandLeft, 62);
    }
  }
  if (brand.icon) {
    brandLeft -= brand.name ? 40 : 32;
    ctx.drawImage(brand.icon, brandLeft, 40, 32, 32);
  }
  const width = brandLeft - PAD - 24;

  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = pal.muted;
  for (const l of wrapLines(measure, text.kicker, width, 1)) ctx.fillText(l, PAD, 56);
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = pal.text;
  for (const l of wrapLines(measure, text.title, width, 1)) ctx.fillText(l, PAD, 100);
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  snap: ChartSnapshot,
  text: ChartCardText,
  progress: number
): void {
  const pal = cardPalette(snap.tone);
  const measure = (s: string) => ctx.measureText(s).width;
  const y = CARD_H - 30;
  const right = CARD_W - PAD;

  // Clock and speed on the right.
  let clockLeft = right;
  if (text.clock) {
    ctx.font = `700 22px ${FONT}`;
    ctx.fillStyle = pal.text;
    const clock = text.clock(progress);
    clockLeft -= measure(clock);
    ctx.fillText(clock, clockLeft, y);
  }
  if (text.speed) {
    ctx.font = `400 16px ${FONT}`;
    ctx.fillStyle = pal.muted;
    clockLeft -= measure(text.speed) + 16;
    ctx.fillText(text.speed, clockLeft, y);
  }

  // Legend on the left, as far as it fits.
  ctx.font = `400 16px ${FONT}`;
  let x = PAD;
  const limit = clockLeft - 24;
  for (const item of snap.legend) {
    const w = 12 + 8 + measure(item.label);
    if (x + w > limit) break;
    ctx.fillStyle = item.color;
    ctx.fillRect(x, y - 11, 12, 12);
    ctx.fillStyle = pal.muted;
    ctx.fillText(item.label, x + 20, y);
    x += w + 20;
  }
}

/** Clip to the part of the plot shown at `progress`. */
function clipRevealed(ctx: CanvasRenderingContext2D, snap: ChartSnapshot, plot: PxBox, p: number) {
  ctx.beginPath();
  if (snap.reveal === 'radial') {
    const cx = plot.x + plot.w / 2;
    const cy = plot.y + plot.h / 2;
    const r = Math.hypot(plot.w, plot.h);
    const start = -Math.PI / 2;
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + Math.PI * 2 * p);
    ctx.closePath();
  } else {
    ctx.rect(plot.x, plot.y, plot.w * p, plot.h);
  }
  ctx.clip();
}

/**
 * One frame. At progress 1 the finished chart; before that the axes stay and
 * the data flows in over the plot area, left to right (a pie sweeps round),
 * with the clock running along.
 */
export function drawChartFrame(
  ctx: CanvasRenderingContext2D,
  snap: ChartSnapshot,
  images: ChartImages,
  text: ChartCardText,
  brand: CardBrand,
  progress: number
): void {
  const p = Math.max(0, Math.min(1, progress));
  const pal = cardPalette(snap.tone);
  ctx.save();
  ctx.fillStyle = snap.background;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const at = fitChart(snap);
  const plot = plotOnCard(snap, at);
  if (p >= 1) {
    ctx.drawImage(images.full, at.x, at.y, at.w, at.h);
  } else {
    if (images.base) {
      ctx.drawImage(images.base, at.x, at.y, at.w, at.h);
    } else {
      // No axes-only layer: draw everything except the plot area that is still to come.
      ctx.save();
      ctx.beginPath();
      ctx.rect(at.x, at.y, at.w, at.h);
      ctx.rect(plot.x, plot.y, plot.w, plot.h);
      ctx.clip('evenodd');
      ctx.drawImage(images.full, at.x, at.y, at.w, at.h);
      ctx.restore();
    }
    ctx.save();
    clipRevealed(ctx, snap, plot, p);
    ctx.drawImage(images.full, at.x, at.y, at.w, at.h);
    ctx.restore();
    if (snap.reveal === 'x' && p > 0) {
      ctx.fillStyle = pal.accent;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(plot.x + plot.w * p - 1, plot.y, 2, plot.h);
      ctx.globalAlpha = 1;
    }
  }

  drawHeader(ctx, text, brand, snap.tone);
  drawFooter(ctx, snap, text, p);
  ctx.restore();
}

export function renderChartCard(
  snap: ChartSnapshot,
  images: ChartImages,
  text: ChartCardText,
  brand: CardBrand
): Promise<RenderedCard> {
  return renderCard((ctx, p) => drawChartFrame(ctx, snap, images, text, brand, p), {
    animate: true,
  });
}
