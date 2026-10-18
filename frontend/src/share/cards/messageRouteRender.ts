import type { CvdMode } from '../../utils/accessibility';
import { getDataColors } from '../../utils/cvd/palettes';
import { getHopColor, getRouteColor } from '../../map/routeMapVisuals';
import { captureBasemap } from '../basemapCapture';
import type { CardBrand } from '../brand';
import {
  CARD_H,
  CARD_W,
  VISUAL_RECT,
  cardPalette,
  drawCardChrome,
  type CardText,
  type CardTone,
} from '../cardChrome';
import { fitProjector, type Projector } from '../geo';
import { GifWriter, buildPalette } from '../gifEncoder';
import type { ShareBuildOptions } from '../ShareCardDialog';
import type { MessageRouteModel, RouteStop } from './messageRoute';

/** Animation timing. The first frame is the finished picture (a chat preview
 *  that only shows frame 1 still shows the result), then it plays and holds. */
export const ANIM = { fps: 12, playMs: 4000, firstMs: 1000, holdMs: 2500 } as const;

const MAP_PADDING = 48;

/** Progress per GIF frame: 1 (finished picture), then 0..1 over `playMs`. */
export function frameProgressList(): number[] {
  const steps = Math.round((ANIM.playMs / 1000) * ANIM.fps);
  const list = [1];
  for (let i = 0; i <= steps; i++) list.push(i / steps);
  return list;
}

export interface MessageRouteView {
  project: Projector | null;
  mapImage: CanvasImageSource | null;
  tone: CardTone;
  hideNames: boolean;
  cvd: CvdMode;
  /** Hidden position: stops evenly spaced from a fixed start to a fixed end,
   *  so no real direction or scale is on the card. */
  schematic?: boolean;
}

type Px = { x: number; y: number };

/** Diagram position of stop `i` of `count` on route `k` of `n`. Every route
 *  runs from the same start (bottom left) to the same end (top right); routes
 *  bow apart so they stay distinguishable. */
function schematicPoint(k: number, n: number, i: number, count: number): Px {
  const start = { x: VISUAL_RECT.x + 90, y: VISUAL_RECT.y + VISUAL_RECT.h - 90 };
  const end = { x: VISUAL_RECT.x + VISUAL_RECT.w - 90, y: VISUAL_RECT.y + 90 };
  const t = count > 1 ? i / (count - 1) : 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  const spread = Math.max(-150, Math.min(150, (k - (n - 1) / 2) * 70));
  const bow = Math.sin(Math.PI * t) * spread;
  return { x: start.x + dx * t + (-dy / len) * bow, y: start.y + dy * t + (dx / len) * bow };
}

interface Segment {
  from: Px;
  to: Px;
  /** Unknown or ambiguous hops were skipped between these two stops. */
  gap: boolean;
  /** Index of the stop this segment ends at. */
  toStop: number;
}

function segmentsFor(stops: RouteStop[], place: (i: number) => Px | null): Segment[] {
  const segs: Segment[] = [];
  let last: { px: Px; i: number } | null = null;
  stops.forEach((_, i) => {
    const px = place(i);
    if (!px) return;
    if (last) segs.push({ from: last.px, to: px, gap: i - last.i > 1, toStop: i });
    last = { px, i };
  });
  return segs;
}

function drawMarker(ctx: CanvasRenderingContext2D, at: Px, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Draws a label unless it would overlap one already drawn (mush on a card). */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  at: Px,
  label: string,
  tone: CardTone,
  taken: Box[]
) {
  ctx.font = '600 15px system-ui, sans-serif';
  const w = ctx.measureText(label).width;
  const x = Math.min(at.x + 14, VISUAL_RECT.x + VISUAL_RECT.w - 8 - w);
  const box = { x: x - 2, y: at.y - 25, w: w + 4, h: 20 };
  if (taken.some((t) => overlaps(t, box))) return;
  taken.push(box);
  ctx.lineWidth = 4;
  ctx.strokeStyle = tone === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)';
  ctx.fillStyle = tone === 'light' ? '#111827' : '#f8fafc';
  ctx.strokeText(label, x, at.y - 10);
  ctx.fillText(label, x, at.y - 10);
}

/**
 * One frame of card 1. Routes play one after another in the order they were
 * heard: route k is drawn while progress runs from k/n to (k+1)/n.
 */
export function drawMessageRouteFrame(
  ctx: CanvasRenderingContext2D,
  model: MessageRouteModel,
  view: MessageRouteView,
  text: CardText,
  brand: CardBrand,
  progress: number
): void {
  const pal = cardPalette(view.tone);
  const colors = getDataColors(view.cvd, view.tone);
  ctx.save();
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (view.mapImage) {
    ctx.drawImage(view.mapImage, VISUAL_RECT.x, VISUAL_RECT.y, VISUAL_RECT.w, VISUAL_RECT.h);
  }

  if (view.project || view.schematic) {
    const project = view.project;
    const n = Math.max(1, model.routes.length);
    // Where stop i of route k goes: on the map, or in the diagram. A stop
    // without a known position has no place either way (drawn as a gap).
    const place = (k: number, i: number): Px | null => {
      const stops = model.routes[k].stops;
      const pt = stops[i]?.point;
      if (!pt) return null;
      if (view.schematic) return schematicPoint(k, n, i, stops.length);
      return project ? project(pt) : null;
    };
    const multi = model.routes.length > 1;
    const routeColor = (i: number) =>
      view.cvd === 'off' ? getRouteColor(i) : colors.series[i % colors.series.length];
    const hopLabels: Array<{ at: Px; name: string }> = [];
    const reachedHops: Array<{ at: Px; color: string }> = [];
    let receiverReached = false;

    model.routes.forEach((route, k) => {
      const p = Math.max(0, Math.min(1, progress * n - k));
      const segs = segmentsFor(route.stops, (i) => place(k, i));
      const shown = p * segs.length;
      const color = routeColor(route.colorIndex);
      const hopColor = (stopIdx: number) => (multi ? color : getHopColor(stopIdx - 1, colors.hops));
      // With the sender unlocated the line starts at a hop, which no segment
      // ends at: mark it as soon as this route starts playing.
      const firstLocated = route.stops.findIndex((s) => s.point);
      const start = firstLocated >= 0 ? route.stops[firstLocated] : null;
      const startAt = firstLocated >= 0 ? place(k, firstLocated) : null;
      if (start?.kind === 'hop' && startAt && p > 0) {
        const at = startAt;
        reachedHops.push({ at, color: hopColor(firstLocated) });
        if (start.name) hopLabels.push({ at, name: start.name });
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      segs.forEach((seg, j) => {
        const frac = Math.max(0, Math.min(1, shown - j));
        if (frac <= 0) return;
        const end = {
          x: seg.from.x + (seg.to.x - seg.from.x) * frac,
          y: seg.from.y + (seg.to.y - seg.from.y) * frac,
        };
        ctx.setLineDash(seg.gap ? [10, 8] : []);
        ctx.beginPath();
        ctx.moveTo(seg.from.x, seg.from.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 8;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(seg.from.x, seg.from.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.stroke();
        if (frac < 1) return;
        const stop = route.stops[seg.toStop];
        if (stop.kind === 'receiver') receiverReached = true;
        if (stop.kind === 'hop') {
          reachedHops.push({ at: seg.to, color: hopColor(seg.toStop) });
          if (stop.name) hopLabels.push({ at: seg.to, name: stop.name });
        }
      });
      ctx.setLineDash([]);
    });

    for (const h of reachedHops) drawMarker(ctx, h.at, 8, h.color);
    // Sender and receiver labels first, so they win over hop labels.
    const labels: Array<{ at: Px; name: string }> = [];
    const first = model.routes[0];
    const lastIdx = first ? first.stops.length - 1 : -1;
    const sender = first?.stops[0];
    const receiver = first?.stops[lastIdx];
    const senderAt = first ? place(0, 0) : null;
    const receiverAt = first ? place(0, lastIdx) : null;
    if (sender && senderAt) {
      drawMarker(ctx, senderAt, 11, colors.sender);
      if (sender.name) labels.push({ at: senderAt, name: sender.name });
    }
    if (receiver && receiverAt && (receiverReached || progress >= 1)) {
      drawMarker(ctx, receiverAt, 12, colors.receiver);
      if (receiver.name) labels.push({ at: receiverAt, name: receiver.name });
    }
    if (!view.hideNames) {
      const taken: Box[] = [];
      for (const l of [...labels, ...hopLabels]) drawLabel(ctx, l.at, l.name, view.tone, taken);
    }
  }
  ctx.restore();
  drawCardChrome(ctx, text, brand, view.tone);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type)
  );
}

/**
 * The PNG now, the GIF on demand. With the position hidden, "without the
 * map" chosen, or nothing located, no base map is fetched: the routes are
 * fitted on a plain background and the card carries no map credit.
 */
export async function renderMessageRouteCard(
  model: MessageRouteModel,
  text: CardText,
  brand: CardBrand,
  opts: ShareBuildOptions & { cvd: CvdMode }
): Promise<{ png: Blob; gif: (signal?: AbortSignal) => Promise<Blob> }> {
  let view: MessageRouteView;
  let cardText: CardText;
  if (opts.hidePosition || opts.noMap || model.located.length === 0) {
    // Hidden position: a diagram, so the drawing shows no real direction or
    // scale. Without a map otherwise: the true shape on a plain background.
    view = {
      project: opts.hidePosition ? null : fitProjector(model.located, VISUAL_RECT, MAP_PADDING),
      mapImage: null,
      tone: 'dark',
      hideNames: opts.hidePosition,
      cvd: opts.cvd,
      schematic: opts.hidePosition,
    };
    cardText = { ...text, credit: undefined };
  } else {
    const cap = await captureBasemap(
      model.located,
      { w: VISUAL_RECT.w, h: VISUAL_RECT.h },
      MAP_PADDING
    );
    view = {
      project: cap.project,
      mapImage: cap.image,
      tone: cap.tone,
      hideNames: false,
      cvd: opts.cvd,
    };
    cardText = { ...text, credit: cap.credit || undefined };
  }

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const draw = (p: number) => drawMessageRouteFrame(ctx, model, view, cardText, brand, p);

  draw(1);
  const png = await canvasToBlob(canvas, 'image/png');

  /** Stops between frames once `signal` aborts (dialog closed or rebuilt). */
  const gif = async (signal?: AbortSignal): Promise<Blob> => {
    const checkAborted = () => {
      if (signal?.aborted) throw new DOMException('GIF cancelled', 'AbortError');
    };
    const pixels = (p: number) => {
      draw(p);
      return ctx.getImageData(0, 0, CARD_W, CARD_H).data;
    };
    checkAborted();
    const palette = buildPalette([pixels(1), pixels(0)]);
    const writer = new GifWriter(CARD_W, CARD_H, palette);
    const list = frameProgressList();
    const frameCs = Math.round(100 / ANIM.fps);
    for (let i = 0; i < list.length; i++) {
      checkAborted();
      const delay =
        i === 0 ? ANIM.firstMs / 10 : i === list.length - 1 ? ANIM.holdMs / 10 : frameCs;
      writer.addFrame(pixels(list[i]), delay);
      // Keep the page responsive while the frames are encoded.
      await new Promise((r) => setTimeout(r, 0));
    }
    checkAborted();
    return new Blob([writer.finish() as BlobPart], { type: 'image/gif' });
  };

  return { png, gif };
}
