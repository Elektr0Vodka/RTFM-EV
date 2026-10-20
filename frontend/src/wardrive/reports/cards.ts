// Report share cards, drawn with RTFM-EV's share-card code: Drive (a driver's
// own drive, replayed in the GIF), Coverage (cells by best signal, filling in
// time order) and Weak spots (gaps and weak cells, the node placement
// evidence; a picture only).
import type { CvdMode } from '../../utils/accessibility';
import { getDataColors } from '../../utils/cvd/palettes';
import type { CardBrand } from '../../share/brand';
import { drawCardChrome, type CardText } from '../../share/cardChrome';
import { drawCardBackground, prepareMapView, type MapView } from '../../share/cardView';
import type { LatLon } from '../../share/geo';
import { drawMarker } from '../../share/marks';
import { renderCard, type RenderedCard } from '../../share/renderCard';
import type { ShareBuildOptions } from '../../share/ShareCardDialog';
import { cellRing } from '../map/hexgrid';
import { rssiTier, tierColor, type RssiTier } from '../signal';
import type { Band, WardriveReport } from './types';

export type ReportCardKind = 'drive' | 'coverage' | 'weak';

type Timed = LatLon & { ts: number };

export interface DriveCardModel {
  empty: boolean;
  located: LatLon[];
  tracks: Timed[][];
  points: (Timed & { rssi: number | null })[];
  t0: number;
  t1: number;
}

export interface CellShape {
  ring: LatLon[];
  band: Band;
  firstTs: number;
  flagged: boolean;
}

export interface CellsCardModel {
  empty: boolean;
  located: LatLon[];
  cells: CellShape[];
  t0: number;
  t1: number;
}

/** First and last time; a loop, since a spread of a large report's times
 *  overflows the call stack. */
function span(times: number[]): { t0: number; t1: number } {
  if (times.length === 0) return { t0: 0, t1: 0 };
  let t0 = times[0];
  let t1 = times[0];
  for (const t of times) {
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  return { t0, t1 };
}

export function driveCardModel(report: WardriveReport): DriveCardModel {
  const tracks = report.tracks.map((tr) => tr.points.map(([lon, lat, ts]) => ({ lat, lon, ts })));
  const points = report.points.map((p) => ({ lat: p.lat, lon: p.lon, ts: p.ts, rssi: p.rssi }));
  const located: LatLon[] = [...tracks.flat(), ...points].map(({ lat, lon }) => ({ lat, lon }));
  return {
    empty: located.length === 0,
    located,
    tracks,
    points,
    ...span([...tracks.flat(), ...points].map((p) => p.ts)),
  };
}

function cellsModel(report: WardriveReport): CellsCardModel {
  const cells: CellShape[] = [];
  for (const c of report.cells) {
    const ring = cellRing(c.id);
    if (!ring) continue;
    cells.push({
      ring: ring.map(([lon, lat]) => ({ lat, lon })),
      band: c.band,
      firstTs: c.first_ts,
      flagged: c.receptions === 0 || c.band === 'weak',
    });
  }
  return {
    empty: cells.length === 0,
    // The basemap is fitted on the cell centres: one point per cell.
    located: report.cells.map((c) => ({ lat: c.lat, lon: c.lon })),
    cells,
    ...span(cells.map((c) => c.firstTs)),
  };
}

export const coverageCardModel = cellsModel;
export const weakCardModel = cellsModel;

const BAND_TIER: Record<Band, RssiTier> = {
  strong: 'warm',
  fair: 'mid',
  weak: 'cold',
  none: 'none',
};

export type CardModel =
  { kind: 'drive'; model: DriveCardModel } | { kind: 'coverage' | 'weak'; model: CellsCardModel };

type View = MapView & { cvd: CvdMode };

/** Shown at progress p: everything at 1, else what happened before the cut. */
const shownAt = (ts: number, t0: number, t1: number, p: number) =>
  p >= 1 || ts < t0 + p * (t1 - t0);

function drawRing(ctx: CanvasRenderingContext2D, ring: LatLon[], view: View) {
  if (!view.project) return;
  ctx.beginPath();
  ring.forEach((pt, i) => {
    const at = view.project!(pt);
    if (i === 0) ctx.moveTo(at.x, at.y);
    else ctx.lineTo(at.x, at.y);
  });
  ctx.closePath();
}

export function drawReportFrame(
  ctx: CanvasRenderingContext2D,
  card: CardModel,
  view: View,
  text: CardText,
  brand: CardBrand,
  progress: number
): void {
  const cvd = view.cvd !== 'off';
  const colors = getDataColors(view.cvd, view.tone);
  const p = Math.max(0, Math.min(1, progress));
  ctx.save();
  drawCardBackground(ctx, view.tone, view.mapImage);
  if (view.project) {
    if (card.kind === 'drive') {
      const m = card.model;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const track of m.tracks) {
        const shown = track.filter((pt) => shownAt(pt.ts, m.t0, m.t1, p));
        if (shown.length < 2) continue;
        for (const [width, color] of [
          [7, 'rgba(0,0,0,0.45)'],
          [4, colors.sender],
        ] as const) {
          ctx.beginPath();
          shown.forEach((pt, i) => {
            const at = view.project!(pt);
            if (i === 0) ctx.moveTo(at.x, at.y);
            else ctx.lineTo(at.x, at.y);
          });
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.stroke();
        }
      }
      for (const pt of m.points) {
        if (!shownAt(pt.ts, m.t0, m.t1, p)) continue;
        drawMarker(ctx, view.project(pt), 5, tierColor(rssiTier(pt.rssi), cvd));
      }
    } else {
      const m = card.model;
      for (const c of m.cells) {
        if (card.kind === 'coverage' && !shownAt(c.firstTs, m.t0, m.t1, p)) continue;
        drawRing(ctx, c.ring, view);
        const covered = c.band !== 'none';
        if (card.kind === 'weak') {
          ctx.globalAlpha = c.flagged ? 0.75 : 0.25;
          ctx.fillStyle = c.flagged
            ? covered
              ? tierColor('cold', cvd)
              : colors.signal.bad
            : tierColor(BAND_TIER[c.band], cvd);
        } else {
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = tierColor(BAND_TIER[c.band], cvd);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
        if (card.kind === 'weak' && c.flagged) {
          ctx.strokeStyle = colors.signal.bad;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
  drawCardChrome(ctx, text, brand, view.tone);
}

function modelFor(kind: ReportCardKind, report: WardriveReport): CardModel {
  if (kind === 'drive') return { kind, model: driveCardModel(report) };
  return { kind, model: kind === 'coverage' ? coverageCardModel(report) : weakCardModel(report) };
}

/** PNG (and for Drive and Coverage a GIF) of one report card. With "hide
 *  my position" the card has no basemap and no names: the shapes stay, on a
 *  plain card, since they are what the card is about. */
export async function renderReportCard(
  kind: ReportCardKind,
  report: WardriveReport,
  text: CardText,
  brand: CardBrand,
  opts: ShareBuildOptions & { cvd: CvdMode }
): Promise<RenderedCard> {
  const card = modelFor(kind, report);
  const map = await prepareMapView(card.model.located, {
    hidePosition: false,
    noMap: opts.noMap || opts.hidePosition,
    // The view framed by hand in the dialog, for the picture and the GIF.
    view: opts.hidePosition ? null : (opts.view ?? null),
  });
  const view: View = { ...map, hideNames: opts.hidePosition, cvd: opts.cvd };
  const cardText: CardText = { ...text, credit: map.credit };
  return renderCard((ctx, p) => drawReportFrame(ctx, card, view, cardText, brand, p), {
    animate: kind !== 'weak',
  });
}

/** Whether a card has anything to draw. */
export function cardIsEmpty(kind: ReportCardKind, report: WardriveReport): boolean {
  return modelFor(kind, report).model.empty;
}

/** The points a card's map fits by default (the framing map starts there). */
export function cardLocated(kind: ReportCardKind, report: WardriveReport): LatLon[] {
  return modelFor(kind, report).model.located;
}
