import type { CvdMode } from '../../utils/accessibility';
import { getDataColors } from '../../utils/cvd/palettes';
import type { CardBrand } from '../brand';
import { VISUAL_RECT, drawCardChrome, type CardText } from '../cardChrome';
import { drawCardBackground, prepareMapView, type MapView } from '../cardView';
import { renderCard, type RenderedCard } from '../renderCard';
import type { ShareBuildOptions } from '../ShareCardDialog';
import type { MeshSummaryModel } from './meshSummary';

export const LIT_RADIUS = 6;
const DIM_RADIUS = 3;

/** The packets-per-bin strip along the bottom of the visual area. */
const STRIP = { x: VISUAL_RECT.x + 24, y: VISUAL_RECT.h - 70, w: VISUAL_RECT.w - 48, h: 50 };

/**
 * One frame: the window plays bin by bin; a node lights up once it was heard
 * in a bin up to now, and the packets strip fills along.
 */
export function drawMeshSummaryFrame(
  ctx: CanvasRenderingContext2D,
  model: MeshSummaryModel,
  view: MapView & { cvd: CvdMode },
  text: CardText,
  brand: CardBrand,
  progress: number
): void {
  const colors = getDataColors(view.cvd, view.tone);
  const accent = colors.series[0] ?? '#3b82f6';
  ctx.save();
  drawCardBackground(ctx, view.tone, view.mapImage);
  const p = Math.max(0, Math.min(1, progress));
  const binsShown = Math.round(p * model.bins.length);
  const heard = new Set<string>();
  model.bins.slice(0, binsShown).forEach((b) => b.keys.forEach((k) => heard.add(k)));
  const allLit = model.bins.length === 0 && p >= 1;

  if (view.project) {
    for (const node of model.nodes) {
      const at = view.project(node.point);
      const on = allLit || heard.has(node.key);
      ctx.beginPath();
      ctx.arc(at.x, at.y, on ? LIT_RADIUS : DIM_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = on ? accent : 'rgba(148,163,184,0.55)';
      ctx.fill();
      if (on) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
      }
    }
  }

  if (model.bins.length > 1) {
    const max = Math.max(1, ...model.bins.map((b) => b.packets));
    const w = STRIP.w / model.bins.length;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(STRIP.x - 8, STRIP.y - 8, STRIP.w + 16, STRIP.h + 16);
    model.bins.slice(0, binsShown).forEach((b, i) => {
      const h = (b.packets / max) * STRIP.h;
      ctx.fillStyle = accent;
      ctx.fillRect(STRIP.x + i * w + 1, STRIP.y + STRIP.h - h, Math.max(1, w - 2), h);
    });
  }
  ctx.restore();
  drawCardChrome(ctx, text, brand, view.tone);
}

/** No "Hide my position" here: the card shows the mesh, not my radio. */
export async function renderMeshSummaryCard(
  model: MeshSummaryModel,
  text: CardText,
  brand: CardBrand,
  opts: ShareBuildOptions & { cvd: CvdMode }
): Promise<RenderedCard> {
  const map = await prepareMapView(model.located, { hidePosition: false, noMap: opts.noMap });
  const view = { ...map, cvd: opts.cvd };
  const cardText: CardText = { ...text, credit: map.credit };
  return renderCard((ctx, p) => drawMeshSummaryFrame(ctx, model, view, cardText, brand, p), {
    animate: model.bins.length > 1,
  });
}
