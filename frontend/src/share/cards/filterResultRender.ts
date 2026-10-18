import type { CvdMode } from '../../utils/accessibility';
import { getDataColors } from '../../utils/cvd/palettes';
import { drawBarList, drawSparkline } from '../bars';
import type { CardBrand } from '../brand';
import {
  VISUAL_RECT,
  cardPalette,
  drawCardChrome,
  type CardText,
  type CardTone,
} from '../cardChrome';
import { drawCardBackground } from '../cardView';
import { renderCard, type RenderedCard } from '../renderCard';
import type { FilterResultModel } from './filterResult';

export interface FilterView {
  /** What the big number counts, e.g. "packets not repeated". */
  heroLabel: string;
  tone: CardTone;
  cvd: CvdMode;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const PAD = 40;

/**
 * One frame: the total counts up, the reason bars grow, and the per-bin line
 * draws along (day by day or hour by hour, whatever the bins are).
 */
export function drawFilterFrame(
  ctx: CanvasRenderingContext2D,
  model: FilterResultModel,
  view: FilterView,
  text: CardText,
  brand: CardBrand,
  progress: number,
  formatValue: (n: number) => string
): void {
  const pal = cardPalette(view.tone);
  const colors = getDataColors(view.cvd, view.tone);
  const p = Math.max(0, Math.min(1, progress));
  ctx.save();
  drawCardBackground(ctx, view.tone, null);
  const left = VISUAL_RECT.x + PAD;
  const width = VISUAL_RECT.w - 2 * PAD;

  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 64px ${FONT}`;
  ctx.fillStyle = colors.series[2] ?? pal.accent;
  ctx.fillText(formatValue(Math.round(model.total * p)), left, PAD + 60);
  ctx.font = `500 20px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText(view.heroLabel, left, PAD + 92);

  const hasLine = model.bins.length > 1;
  const barsBottom = hasLine ? VISUAL_RECT.h - 150 : VISUAL_RECT.h - PAD;
  drawBarList(
    ctx,
    { x: left, y: PAD + 124, w: width, h: barsBottom - (PAD + 124) },
    model.reasons.slice(0, 7).map((r, i) => ({
      label: r.label,
      value: r.value,
      color: colors.series[i % colors.series.length] ?? pal.accent,
    })),
    p,
    view.tone,
    formatValue
  );
  if (hasLine) {
    drawSparkline(
      ctx,
      { x: left, y: VISUAL_RECT.h - 120, w: width, h: 80 },
      model.bins,
      p,
      colors.series[2] ?? pal.accent
    );
  }
  ctx.restore();
  drawCardChrome(ctx, text, brand, view.tone);
}

/** No map and no position on these cards; animated only when there is history. */
export async function renderFilterCard(
  model: FilterResultModel,
  text: CardText,
  brand: CardBrand,
  view: FilterView,
  formatValue: (n: number) => string = (n) => String(n)
): Promise<RenderedCard> {
  return renderCard((ctx, p) => drawFilterFrame(ctx, model, view, text, brand, p, formatValue), {
    animate: model.bins.length > 1,
  });
}
