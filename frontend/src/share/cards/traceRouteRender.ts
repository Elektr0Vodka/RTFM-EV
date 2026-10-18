import type { CvdMode } from '../../utils/accessibility';
import { getDataColors } from '../../utils/cvd/palettes';
import { formatSNR } from '../../utils/traceMapUtils';
import type { CardBrand } from '../brand';
import { VISUAL_RECT, drawCardChrome, type CardText } from '../cardChrome';
import { drawCardBackground, prepareMapView, type MapView } from '../cardView';
import { drawLabel, drawMarker, drawSegment, snrColor, type Box, type Px } from '../marks';
import { renderCard, type RenderedCard } from '../renderCard';
import type { ShareBuildOptions } from '../ShareCardDialog';
import type { TraceModel } from './traceRoute';

/** Diagram position of stop `i` of `count`: a loop that starts at the bottom
 *  and comes back to the same spot (the trace returns to my radio). */
function loopPoint(i: number, count: number): Px {
  const cx = VISUAL_RECT.x + VISUAL_RECT.w / 2;
  const cy = VISUAL_RECT.y + VISUAL_RECT.h / 2;
  const r = Math.min(VISUAL_RECT.w, VISUAL_RECT.h) / 2 - 80;
  const t = count > 1 ? i / (count - 1) : 0;
  const a = Math.PI / 2 - 2 * Math.PI * t;
  return { x: cx + r * Math.cos(a) * 1.15, y: cy + r * Math.sin(a) };
}

/** One frame: legs drawn in the order the trace ran, nodes coloured by the
 *  SNR received there. */
export function drawTraceFrame(
  ctx: CanvasRenderingContext2D,
  model: TraceModel,
  view: MapView & { cvd: CvdMode },
  text: CardText,
  brand: CardBrand,
  progress: number
): void {
  const colors = getDataColors(view.cvd, view.tone);
  ctx.save();
  drawCardBackground(ctx, view.tone, view.mapImage);
  if (view.project || view.diagram) {
    const count = model.stops.length;
    const place = (i: number): Px | null => {
      const pt = model.stops[i].point;
      if (!pt) return null;
      return view.diagram ? loopPoint(i, count) : view.project!(pt);
    };
    const segs: { from: Px; to: Px; gap: boolean; toStop: number }[] = [];
    let last: { px: Px; i: number } | null = null;
    for (let i = 0; i < count; i++) {
      const px = place(i);
      if (!px) continue;
      if (last) segs.push({ from: last.px, to: px, gap: i - last.i > 1, toStop: i });
      last = { px, i };
    }
    const shown = Math.max(0, Math.min(1, progress)) * segs.length;
    const reached: number[] = [];
    segs.forEach((seg, j) => {
      const frac = Math.max(0, Math.min(1, shown - j));
      drawSegment(ctx, seg.from, seg.to, frac, colors.series[0] ?? '#3b82f6', seg.gap);
      if (frac >= 1) reached.push(seg.toStop);
    });
    // The first located stop is where the line starts: always shown.
    const firstLocated = model.stops.findIndex((s) => s.point);
    if (firstLocated >= 0) reached.unshift(firstLocated);

    const labels: { at: Px; text: string }[] = [];
    for (const i of reached) {
      const at = place(i);
      if (!at) continue;
      const stop = model.stops[i];
      const isMe = stop.role === 'local';
      drawMarker(
        ctx,
        at,
        isMe ? 11 : 8,
        i === 0 ? colors.sender : snrColor(stop.snr, colors.signal, colors.receiver)
      );
      const snr = i === 0 ? null : formatSNR(stop.snr);
      const name = view.hideNames ? '' : stop.name;
      const label = [name, snr].filter(Boolean).join(' ');
      if (label) labels.push({ at, text: label });
    }
    const taken: Box[] = [];
    for (const l of labels) drawLabel(ctx, l.at, l.text, view.tone, taken);
  }
  ctx.restore();
  drawCardChrome(ctx, text, brand, view.tone);
}

export async function renderTraceCard(
  model: TraceModel,
  text: CardText,
  brand: CardBrand,
  opts: ShareBuildOptions & { cvd: CvdMode }
): Promise<RenderedCard> {
  // A map around my radio alone would show home and no route: only with a located hop.
  const hopLocated = model.stops.some((s) => s.role !== 'local' && s.point);
  const map = await prepareMapView(hopLocated ? model.located : [], opts);
  const view = { ...map, cvd: opts.cvd };
  const cardText: CardText = { ...text, credit: map.credit };
  return renderCard((ctx, p) => drawTraceFrame(ctx, model, view, cardText, brand, p), {
    animate: true,
  });
}
