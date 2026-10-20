// What the coverage map shows at each zoom, on our hex grid (CoreScope's,
// sizes 6 to 15, `hexResForZoom`). Behaviour of map.mesh-hunter.eu's zoom
// fade (web 1.27.0): in Auto the points fade in as the map zooms in (flat)
// or stand up at zoom 19 (3D), and two cell sizes are on the map at a time,
// handing over across each zoom where the size changes, so the grid never
// jumps. Their grid has other sizes; the hand-over is drawn for ours.
import type { LayerMode } from './state';

export const POINT_FADE_2D = { from: 13.25, to: 18.25 };
export const POINT_STEP_3D = 19;
export const HEX_UNDER_PILLARS_3D = 0.95;
const BLEND_2D = 0.95;
const BLEND_3D = 0.75;

const MIN_RES = 6;
const MAX_RES = 15;
/** The zoom where each size takes over (`hexResForZoom`'s steps). */
const START: Record<number, number> = {
  7: 7,
  8: 9,
  9: 11,
  10: 13,
  11: 15,
  12: 16,
  13: 17,
  14: 18,
  15: 19,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function ramp(z: number, from: number, to: number): number {
  if (!(to > from)) return z >= from ? 1 : 0;
  return clamp01((z - from) / (to - from));
}

function resAt(z: number): number {
  let res = MIN_RES;
  for (let r = MIN_RES + 1; r <= MAX_RES; r++) if (z >= START[r]) res = r;
  return res;
}

export function pointShare(z: number, mode: LayerMode, mode3D: boolean): number {
  if (mode === 'hex') return 0;
  if (mode === 'points') return 1;
  if (mode3D) return z >= POINT_STEP_3D ? 1 : 0;
  return ramp(z, POINT_FADE_2D.from, POINT_FADE_2D.to);
}

export function hexShare(z: number, mode: LayerMode, mode3D: boolean): number {
  if (mode === 'points') return 0;
  if (mode === 'hex' || !mode3D) return 1;
  return z >= POINT_STEP_3D ? HEX_UNDER_PILLARS_3D : 1;
}

/** The two sizes to show: the zoom's own and the neighbour whose step is
 * nearer. Even sizes in slot a, odd in b, so a size keeps its layer when the
 * pair moves on. */
export function cellSizes(z: number): { a: number | null; b: number | null } {
  const own = resAt(z);
  let other: number;
  if (own === MIN_RES) other = own + 1;
  else if (own === MAX_RES) other = own - 1;
  else other = z - START[own] < START[own + 1] - z ? own - 1 : own + 1;
  const slots: { a: number | null; b: number | null } = { a: null, b: null };
  for (const res of [own, other]) slots[res % 2 === 0 ? 'a' : 'b'] = res;
  return slots;
}

const blendWidth = (mode3D: boolean) => (mode3D ? BLEND_3D : BLEND_2D);

/** How much of size `res` shows at zoom `z` (0..1). */
export function sizeShare(res: number, z: number, mode3D: boolean): number {
  const w = blendWidth(mode3D) / 2;
  const up = res <= MIN_RES ? 1 : ramp(z, START[res] - w, START[res] + w);
  const down = res >= MAX_RES ? 0 : ramp(z, START[res + 1] - w, START[res + 1] + w);
  return Math.min(up, 1 - down);
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

type Expr = unknown[] | number;

function zoomRamp(breaks: number[], shareAt: (z: number) => number): Expr {
  const zs = [...new Set(breaks.map(round3))].sort((a, b) => a - b);
  if (zs.length === 0) return ['*', ['get', 'op'], round3(shareAt(0))];
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...zs.flatMap((z) => [z, ['*', ['get', 'op'], round3(shareAt(z))]]),
  ];
}

/** The points' opacity: the feature's own, ramped by zoom in flat Auto. */
export function pointOpacityExpr(mode: LayerMode, mode3D: boolean): Expr {
  if (mode !== 'auto' || mode3D) return ['get', 'op'];
  return zoomRamp([POINT_FADE_2D.from, POINT_FADE_2D.to], (z) => pointShare(z, mode, mode3D));
}

/** A cell size's opacity across the zooms it hands over at. */
export function cellOpacityExpr(res: number, mode: LayerMode, mode3D: boolean): Expr {
  const w = blendWidth(mode3D) / 2;
  const breaks: number[] = [];
  if (res > MIN_RES) breaks.push(START[res] - w, START[res] + w);
  if (res < MAX_RES) breaks.push(START[res + 1] - w, START[res + 1] + w);
  if (mode === 'auto' && mode3D) breaks.push(POINT_STEP_3D - 0.001, POINT_STEP_3D);
  return zoomRamp(breaks, (z) => sizeShare(res, z, mode3D) * hexShare(z, mode, mode3D));
}

const BAR_OPACITY = 0.75;

/** A size's 3D bars: extrusion opacity cannot read feature values, so the
 * ramp carries plain numbers (the hand-over between sizes only). */
export function barOpacityExpr(res: number, mode: LayerMode): Expr {
  const w = BLEND_3D / 2;
  const breaks: number[] = [];
  if (res > MIN_RES) breaks.push(START[res] - w, START[res] + w);
  if (res < MAX_RES) breaks.push(START[res + 1] - w, START[res + 1] + w);
  const share = (z: number) =>
    round3(sizeShare(res, z, true) * hexShare(z, mode, true) * BAR_OPACITY);
  const zs = [...new Set(breaks.map(round3))].sort((a, b) => a - b);
  if (zs.length === 0) return share(0);
  return ['interpolate', ['linear'], ['zoom'], ...zs.flatMap((z) => [z, share(z)])];
}
