import type { CvdMode } from '../../utils/accessibility';
import { getDataColors } from '../../utils/cvd/palettes';
import { getHopColor, getRouteColor } from '../../map/routeMapVisuals';
import type { CardBrand } from '../brand';
import { VISUAL_RECT, drawCardChrome, type CardText, type CardTone } from '../cardChrome';
import { drawCardBackground, prepareMapView } from '../cardView';
import type { Projector } from '../geo';
import { drawLabel, drawMarker, drawSegment, type Box, type Px } from '../marks';
import { renderCard, type RenderedCard } from '../renderCard';
import type { ShareBuildOptions } from '../ShareCardDialog';
import type { MessageRouteModel, RouteStop } from './messageRoute';

export { ANIM, frameProgressList } from '../renderCard';

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
  const colors = getDataColors(view.cvd, view.tone);
  ctx.save();
  drawCardBackground(ctx, view.tone, view.mapImage);

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
      segs.forEach((seg, j) => {
        const frac = Math.max(0, Math.min(1, shown - j));
        if (frac <= 0) return;
        drawSegment(ctx, seg.from, seg.to, frac, color, seg.gap);
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

/**
 * The PNG now, the GIF on demand. With the position hidden the routes are a
 * diagram; without a map otherwise they keep their true shape on a plain
 * background; in both cases the card carries no map credit.
 */
export async function renderMessageRouteCard(
  model: MessageRouteModel,
  text: CardText,
  brand: CardBrand,
  opts: ShareBuildOptions & { cvd: CvdMode }
): Promise<RenderedCard> {
  const map = await prepareMapView(model.located, opts);
  const view: MessageRouteView = {
    project: map.project,
    mapImage: map.mapImage,
    tone: map.tone,
    hideNames: map.hideNames,
    cvd: opts.cvd,
    schematic: map.diagram,
  };
  const cardText: CardText = { ...text, credit: map.credit };
  return renderCard((ctx, p) => drawMessageRouteFrame(ctx, model, view, cardText, brand, p), {
    animate: true,
  });
}
