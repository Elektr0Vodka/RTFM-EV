import type { CvdMode } from '../../utils/accessibility';
import { getDataColors } from '../../utils/cvd/palettes';
import type { CardBrand } from '../brand';
import { VISUAL_RECT, drawCardChrome, type CardText } from '../cardChrome';
import { drawCardBackground, prepareMapView, type MapView } from '../cardView';
import { drawLabel, drawMarker, drawSegment, snrColor, type Box, type Px } from '../marks';
import { renderCard, type RenderedCard } from '../renderCard';
import type { ShareBuildOptions } from '../ShareCardDialog';
import type { NodeReachModel } from './nodeReach';

const CENTER: Px = { x: VISUAL_RECT.x + VISUAL_RECT.w / 2, y: VISUAL_RECT.y + VISUAL_RECT.h / 2 };

/** Diagram position: neighbours evenly round a ring in the order heard; a
 *  stronger signal sits closer to the centre. No real direction or distance. */
function ringPoint(i: number, n: number, snr: number | null): Px {
  const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
  const strength = snr == null ? 0 : Math.max(0, Math.min(1, (snr + 15) / 25));
  const r = 250 - strength * 160;
  return { x: CENTER.x + Math.cos(angle) * r * 1.15, y: CENTER.y + Math.sin(angle) * r };
}

/** One frame: neighbours appear one by one in the order first heard. */
export function drawNodeReachFrame(
  ctx: CanvasRenderingContext2D,
  model: NodeReachModel,
  view: MapView & { cvd: CvdMode },
  text: CardText,
  brand: CardBrand,
  progress: number
): void {
  const colors = getDataColors(view.cvd, view.tone);
  ctx.save();
  drawCardBackground(ctx, view.tone, view.mapImage);
  const center = view.diagram
    ? CENTER
    : model.center && view.project
      ? view.project(model.center)
      : null;
  if (center) {
    const n = model.nodes.length;
    const shown = Math.max(0, Math.min(1, progress)) * n;
    const reached: { at: Px; name: string; color: string }[] = [];
    model.nodes.forEach((node, i) => {
      const at = view.diagram
        ? ringPoint(i, n, node.snr)
        : node.point && view.project
          ? view.project(node.point)
          : null;
      if (!at) return;
      const frac = Math.max(0, Math.min(1, shown - i));
      if (frac <= 0) return;
      const color = snrColor(node.snr, colors.signal, colors.receiver);
      drawSegment(ctx, center, at, frac, color, false);
      if (frac >= 1) reached.push({ at, name: node.name, color });
    });
    for (const r of reached) drawMarker(ctx, r.at, 7, r.color);
    drawMarker(ctx, center, 12, colors.sender);
    if (!view.hideNames) {
      const taken: Box[] = [];
      for (const r of reached) drawLabel(ctx, r.at, r.name, view.tone, taken);
    }
  }
  ctx.restore();
  drawCardChrome(ctx, text, brand, view.tone);
}

/**
 * Without my own position, or with it hidden, the neighbours are a ring
 * diagram (names kept only when the position was not hidden).
 */
export async function renderNodeReachCard(
  model: NodeReachModel,
  text: CardText,
  brand: CardBrand,
  opts: ShareBuildOptions & { cvd: CvdMode }
): Promise<RenderedCard> {
  const map: MapView = model.center
    ? await prepareMapView(model.located, opts)
    : { project: null, mapImage: null, tone: 'dark', diagram: true, hideNames: opts.hidePosition };
  const view = { ...map, cvd: opts.cvd };
  const cardText: CardText = { ...text, credit: map.credit };
  return renderCard((ctx, p) => drawNodeReachFrame(ctx, model, view, cardText, brand, p), {
    animate: true,
  });
}
