// The "Repeaters heard" share card (map.mesh-hunter.eu's export, drawn with
// RTFM-EV's share cards): every repeater in view with a line to each place it
// was heard, over the drivers' routes and the cells they drove. A repeater
// heard only farther than 30 km from its position is left off and named.
import type { CvdMode } from '../../utils/accessibility';
import type { CardBrand } from '../../share/brand';
import { drawCardChrome, type CardText } from '../../share/cardChrome';
import { drawCardBackground, prepareMapView, type MapView } from '../../share/cardView';
import type { LatLon } from '../../share/geo';
import { drawMarker } from '../../share/marks';
import { renderCard, type RenderedCard } from '../../share/renderCard';
import type { ShareBuildOptions } from '../../share/ShareCardDialog';
import { cellAt, cellRing } from '../map/hexgrid';
import type { Hearing } from './attribution';
import { haversineM } from './locate';
import { rayStrength, rayStyle, type Star } from './reach';
import type { MapPoint } from './types';

export const FAR_KM = 30;
const ROUTE_GAP_S = 5 * 60;
const ROUTE_GAP_KM = 3;
/** Our grid's 360 m cells (theirs picks its size nearest 360 m too). */
const CELL_RES = 8;
const HASH_KINDS = ['path_hash', 'direct_hash'];

const kmBetween = (a: LatLon, b: LatLon) => haversineM(a, b) / 1000;

export interface HeardStar {
  id: string;
  name: string;
  origin: LatLon;
  slotColor?: string;
  rays: { lat: number; lon: number; rssi: number | null; s: number; w: number; op: number }[];
}

export interface HeardModel {
  drawn: HeardStar[];
  offMap: { name: string; km: number }[];
  numbers: { repeaters: number; receptions: number; farthestKm: number };
}

const idLabel = (id: string, kind: string | null) =>
  HASH_KINDS.includes(kind ?? '') && id.length <= 6 ? `#${id}` : id.slice(0, 8);

export function heardModel<H extends Hearing>(
  stars: Star<H>[],
  bbox: [number, number, number, number],
  nameOf: (id: string) => string | null
): HeardModel {
  const [south, west, north, east] = bbox;
  const drawn: HeardStar[] = [];
  const offMap: { name: string; km: number }[] = [];
  for (const s of stars) {
    const o = s.origin;
    if (o.lat < south || o.lat > north || o.lon < west || o.lon > east) continue;
    const name = nameOf(s.id) ?? idLabel(s.id, s.points[0]?.sender_kind ?? null);
    const nearest = Math.min(...s.points.map((p) => kmBetween(o, p)));
    if (nearest > FAR_KM) {
      offMap.push({ name, km: Math.round(nearest) });
      continue;
    }
    drawn.push({
      id: s.id,
      name,
      origin: { lat: o.lat, lon: o.lon },
      rays: s.points.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        rssi: p.rssi,
        s: rayStrength(p.rssi),
        ...rayStyle(p.rssi),
      })),
    });
  }
  const receptions = drawn.reduce((n, s) => n + s.rays.length, 0);
  let farthestKm = 0;
  for (const s of drawn)
    for (const r of s.rays) farthestKm = Math.max(farthestKm, kmBetween(s.origin, r));
  return { drawn, offMap, numbers: { repeaters: drawn.length, receptions, farthestKm } };
}

/** Each driver's path through their receptions, broken at a gap of more than
 * 5 minutes or 3 km; single points make no route. */
export function routeSegments(points: MapPoint[]): [number, number][][] {
  const pts = points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .slice()
    .sort((a, b) => (a.driver === b.driver ? a.rx_ts - b.rx_ts : a.driver < b.driver ? -1 : 1));
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  let prev: MapPoint | null = null;
  for (const p of pts) {
    const gap =
      prev !== null &&
      (p.rx_ts - prev.rx_ts > ROUTE_GAP_S ||
        kmBetween(prev, p) > ROUTE_GAP_KM ||
        prev.driver !== p.driver);
    if (gap) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    cur.push([p.lon, p.lat]);
    prev = p;
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** The 360 m cells with a reception, as [lon, lat] rings. */
export function mappedCells(points: MapPoint[]): [number, number][][] {
  const ids = new Set<string>();
  for (const p of points)
    if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) ids.add(cellAt(p.lat, p.lon, CELL_RES));
  const out: [number, number][][] = [];
  for (const id of ids) {
    const ring = cellRing(id);
    if (ring) out.push(ring);
  }
  return out;
}

type View = MapView & { cvd: CvdMode };

function strokePath(ctx: CanvasRenderingContext2D, view: View, coords: [number, number][]) {
  if (!view.project) return;
  ctx.beginPath();
  coords.forEach(([lon, lat], i) => {
    const at = view.project!({ lat, lon });
    if (i === 0) ctx.moveTo(at.x, at.y);
    else ctx.lineTo(at.x, at.y);
  });
}

export async function renderHeardCard(
  model: HeardModel,
  routes: [number, number][][],
  cells: [number, number][][],
  colorOf: (id: string) => string,
  text: CardText,
  brand: CardBrand,
  opts: ShareBuildOptions & { cvd: CvdMode }
): Promise<RenderedCard> {
  const located: LatLon[] = model.drawn.flatMap((s) => [s.origin, ...s.rays]);
  const map = await prepareMapView(located, {
    hidePosition: false,
    noMap: opts.noMap || opts.hidePosition,
    view: opts.hidePosition ? null : (opts.view ?? null),
  });
  const view: View = { ...map, hideNames: opts.hidePosition, cvd: opts.cvd };
  const cardText: CardText = { ...text, credit: map.credit };
  return renderCard(
    (ctx) => {
      ctx.save();
      drawCardBackground(ctx, view.tone, view.mapImage);
      if (view.project) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#9ca3af';
        for (const ring of cells) {
          strokePath(ctx, view, ring);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        for (const r of routes) {
          strokePath(ctx, view, r);
          ctx.stroke();
        }
        for (const s of model.drawn) {
          const color = colorOf(s.id);
          for (const r of s.rays) {
            strokePath(ctx, view, [
              [s.origin.lon, s.origin.lat],
              [r.lon, r.lat],
            ]);
            ctx.globalAlpha = r.op;
            ctx.strokeStyle = color;
            ctx.lineWidth = r.w * 1.5;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          drawMarker(ctx, view.project(s.origin), 7, color);
        }
        if (!view.hideNames) {
          ctx.globalAlpha = 1;
          ctx.font = '600 20px system-ui, sans-serif';
          ctx.textBaseline = 'middle';
          for (const s of model.drawn) {
            const at = view.project(s.origin);
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.strokeText(s.name, at.x + 12, at.y);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(s.name, at.x + 12, at.y);
          }
        }
      }
      ctx.restore();
      drawCardChrome(ctx, cardText, brand, view.tone);
    },
    { animate: false }
  );
}
