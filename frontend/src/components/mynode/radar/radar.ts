// Directly-heard radar: a dependency-free Canvas 2D polar plot of the nodes the
// connected radio heard directly (0-hop), placed by great-circle bearing
// (0 = north, up) and log-scaled distance from the radio's own coordinates, over
// a range-zoom (data scale) and a pan/zoom view transform. Dot colour encodes
// best SNR (grey when unknown); dot size scales mildly with reception count.
// Ported and trimmed from DutchMeshCore-Observers web/js/lib/radar.js: the
// source/neighbour-topic filter, the neighbour halo, and the relayed-fade are
// dropped because every plotted node is directly heard.
//
// The pure helpers (clampZoom/radarRange/defaultView/zoomAt/panBy/
// radarTooltipLines) are unit-tested; the canvas draw path is browser-verified.

import { bearingDeg, haversineKm, snrColor } from './signalCore';

export interface RadarNode {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  snr: number | null;
  receptions: number;
}

export interface RadarData {
  center: { lat: number; lon: number } | null;
  nodes: RadarNode[];
}

export interface RadarView {
  scale: number;
  panX: number;
  panY: number;
}

export interface RadarText {
  noLocation: string;
  noContacts: string;
  snrLabel: string;
  ringsLabel: string;
  noSnrLabel: string;
  sizeLabel: string;
}

export interface RadarOpts {
  text?: Partial<RadarText>;
  zoom?: number;
  view?: RadarView;
}

export interface RadarHit {
  x: number;
  y: number;
  r: number;
  node: RadarNode;
  distKm: number;
  brg: number;
}

interface RadarPalette {
  text: string;
  muted: string;
  faint: string;
  ring: string;
  axis: string;
  outline: string;
  noSnr: string;
}

interface RadarCanvas extends HTMLCanvasElement {
  _radarHits?: RadarHit[];
  _radarTip?: HTMLDivElement;
  _radarMove?: (e: MouseEvent) => void;
  _radarLeave?: () => void;
}

const D2R = Math.PI / 180;
const LOG_RANGE = 16;

// RADAR_MAX_ZOOM caps the range-zoom (data-scale) multiplier; zoom=1 is auto-fit.
export const RADAR_MAX_ZOOM = 8;

// VIEW_MIN/MAX_SCALE cap the viewport (pan/zoom) magnification.
export const VIEW_MIN_SCALE = 1;
export const VIEW_MAX_SCALE = 12;

const FONT = '12px system-ui, sans-serif';
const FONT_SMALL = '11px system-ui, sans-serif';

const FALLBACK: RadarPalette = {
  text: '#c9d1d9',
  muted: '#8b949e',
  faint: '#6b7480',
  ring: 'rgba(139, 148, 158, 0.30)',
  axis: 'rgba(139, 148, 158, 0.15)',
  outline: 'rgba(240, 246, 252, 0.35)',
  noSnr: '#8b949e',
};

const DEFAULT_TEXT: RadarText = {
  noLocation: 'This node has no location, so the radar is unavailable',
  noContacts: 'No directly-heard located contacts in range',
  snrLabel: 'best SNR',
  ringsLabel: 'rings',
  noSnrLabel: 'no SNR',
  sizeLabel: 'size = receptions',
};

// hslVar reads a CSS custom property that holds an HSL triplet (e.g. "224 11% 23%",
// as this app's theme tokens do) and returns a usable hsl(...) colour, falling back
// to a fixed colour when the property is missing.
function hslVar(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = cs.getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.startsWith('#') || raw.startsWith('rgb') || raw.startsWith('hsl')) return raw;
  return `hsl(${raw})`;
}

// resolvePalette pulls radar colours from the app's theme tokens at render time so
// the canvas matches the active (light/dark) theme; the source hex are fallbacks.
function resolvePalette(): RadarPalette {
  if (typeof window === 'undefined' || !window.getComputedStyle) return { ...FALLBACK };
  const cs = getComputedStyle(document.documentElement);
  return {
    text: hslVar(cs, '--foreground', FALLBACK.text),
    muted: hslVar(cs, '--muted-foreground', FALLBACK.muted),
    faint: hslVar(cs, '--muted-foreground', FALLBACK.faint),
    ring: hslVar(cs, '--border', FALLBACK.ring),
    axis: hslVar(cs, '--border', FALLBACK.axis),
    outline: hslVar(cs, '--muted-foreground', FALLBACK.outline),
    noSnr: hslVar(cs, '--muted-foreground', FALLBACK.noSnr),
  };
}

// defaultView is the identity viewport (no magnification, no pan).
export function defaultView(): RadarView {
  return { scale: 1, panX: 0, panY: 0 };
}

// zoomAt returns a new view that multiplies the viewport scale by factor while
// keeping the plot point currently under (mx,my) fixed on screen. c0x/c0y are the
// canvas centre. Scale is clamped to [VIEW_MIN_SCALE, VIEW_MAX_SCALE]; when the
// clamp binds, the view is returned unchanged.
export function zoomAt(
  view: RadarView,
  mx: number,
  my: number,
  factor: number,
  c0x: number,
  c0y: number
): RadarView {
  const s = view.scale;
  const s2 = Math.max(VIEW_MIN_SCALE, Math.min(VIEW_MAX_SCALE, s * factor));
  if (s2 === s) return { scale: s, panX: view.panX, panY: view.panY };
  const cvx = c0x + view.panX;
  const cvy = c0y + view.panY;
  const k = s2 / s;
  const cv2x = mx - k * (mx - cvx);
  const cv2y = my - k * (my - cvy);
  return { scale: s2, panX: cv2x - c0x, panY: cv2y - c0y };
}

// panBy returns a new view shifted by (dx,dy) screen pixels.
export function panBy(view: RadarView, dx: number, dy: number): RadarView {
  return { scale: view.scale, panX: view.panX + dx, panY: view.panY + dy };
}

// clampZoom coerces a range-zoom to [1, RADAR_MAX_ZOOM].
export function clampZoom(zoom: number): number {
  const z = Number(zoom);
  if (!Number.isFinite(z) || z < 1) return 1;
  return Math.min(RADAR_MAX_ZOOM, z);
}

// radarRange returns the zoomed outer distance and the matching inner clamp.
export function radarRange(
  dMax: number,
  zoom: number | undefined
): { dOuter: number; dMin: number } {
  const safeMax = Number.isFinite(dMax) && dMax > 0 ? dMax : 1;
  const dOuter = safeMax / clampZoom(zoom as number);
  return { dOuter, dMin: dOuter / LOG_RANGE };
}

function formatKm(km: number): string {
  if (km >= 10) return `${Math.round(km)} km`;
  if (km >= 1) return `${km.toFixed(1)} km`;
  return `${Math.round(km * 1000)} m`;
}

function located(n: RadarNode): boolean {
  return typeof n.lat === 'number' && typeof n.lon === 'number';
}

// radarTooltipLines builds the tooltip content for one hit as [{text, bold}]:
// name, best SNR (omitted when unknown), reception count, and distance/bearing.
export function radarTooltipLines(hit: {
  node: RadarNode;
  distKm: number;
  brg: number;
}): { text: string; bold?: boolean }[] {
  const n = hit.node;
  const lines: { text: string; bold?: boolean }[] = [];
  lines.push({ text: n.name || n.id.slice(0, 8) || '?', bold: true });
  if (n.snr != null) lines.push({ text: `best ${Number(n.snr).toFixed(1)} dB` });
  const rx = n.receptions || 0;
  lines.push({ text: `${rx} reception${rx === 1 ? '' : 's'}` });
  lines.push({ text: `${hit.distKm.toFixed(1)} km @ ${Math.round(hit.brg)} deg` });
  return lines;
}

function setupCanvas(canvas: RadarCanvas): {
  ctx: CanvasRenderingContext2D;
  cssW: number;
  cssH: number;
} {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = canvas.clientWidth || canvas.width || 300;
  const cssH = canvas.clientHeight || canvas.height || 300;
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return { ctx, cssW, cssH };
}

function drawEmpty(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  msg: string,
  pal: RadarPalette
): void {
  ctx.font = FONT;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = Math.max(80, cssW - 40);
  const words = String(msg).split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(cand).width > maxW) {
      lines.push(line);
      line = w;
    } else {
      line = cand;
    }
  }
  if (line) lines.push(line);
  const lh = 17;
  const y0 = cssH / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cssW / 2, y0 + i * lh));
}

function tooltipFor(canvas: RadarCanvas): HTMLDivElement {
  if (canvas._radarTip && canvas._radarTip.isConnected) return canvas._radarTip;
  const tip = document.createElement('div');
  tip.style.cssText = [
    'position:fixed',
    'display:none',
    'z-index:1000',
    'pointer-events:none',
    'background:hsl(var(--popover))',
    'border:1px solid hsl(var(--border))',
    'border-radius:6px',
    'padding:6px 9px',
    'color:hsl(var(--popover-foreground))',
    'font:12px/1.45 system-ui, sans-serif',
    'max-width:260px',
    'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
  ].join(';');
  document.body.appendChild(tip);
  canvas._radarTip = tip;
  return tip;
}

function fillTooltip(tip: HTMLDivElement, hit: RadarHit): void {
  tip.textContent = '';
  for (const { text, bold } of radarTooltipLines(hit)) {
    const d = document.createElement('div');
    d.textContent = text;
    if (bold) d.style.fontWeight = '600';
    tip.appendChild(d);
  }
}

function bindHover(canvas: RadarCanvas): void {
  if (canvas._radarMove) canvas.removeEventListener('mousemove', canvas._radarMove);
  if (canvas._radarLeave) canvas.removeEventListener('mouseleave', canvas._radarLeave);
  const move = (e: MouseEvent) => {
    const hits = canvas._radarHits || [];
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: RadarHit | null = null;
    let bestD = Infinity;
    for (const h of hits) {
      const d = Math.hypot(mx - h.x, my - h.y);
      if (d <= Math.max(h.r + 3, 8) && d < bestD) {
        best = h;
        bestD = d;
      }
    }
    const tip = tooltipFor(canvas);
    if (!best) {
      tip.style.display = 'none';
      return;
    }
    fillTooltip(tip, best);
    tip.style.display = 'block';
    const pad = 12;
    let tx = e.clientX + pad;
    let ty = e.clientY + pad;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    if (tx + tw > window.innerWidth - 4) tx = e.clientX - tw - pad;
    if (ty + th > window.innerHeight - 4) ty = e.clientY - th - pad;
    tip.style.left = `${tx}px`;
    tip.style.top = `${ty}px`;
  };
  const leave = () => {
    if (canvas._radarTip) canvas._radarTip.style.display = 'none';
  };
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseleave', leave);
  canvas._radarMove = move;
  canvas._radarLeave = leave;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  cssH: number,
  text: RadarText,
  ringLabels: string[],
  pal: RadarPalette
): void {
  const x = 10;
  let y = cssH - 10;
  ctx.font = FONT_SMALL;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.muted;
  ctx.fillText(`${text.ringsLabel}: ${ringLabels.join(' / ')}`, x, y);
  y -= 15;
  const bw = 90;
  const bh = 7;
  for (let i = 0; i < bw; i++) {
    ctx.fillStyle = snrColor(-20 + (30 * i) / (bw - 1));
    ctx.fillRect(x + i, y - bh, 1, bh);
  }
  ctx.fillStyle = pal.muted;
  ctx.fillText(`-20  ${text.snrLabel}  +10 dB`, x + bw + 6, y - 1);
}

const SYMBOL_ROW_H = 15;

function drawSymbolGlyph(
  ctx: CanvasRenderingContext2D,
  kind: 'nosnr' | 'size',
  gx: number,
  y: number,
  pal: RadarPalette
): void {
  const r = 3.5;
  if (kind === 'nosnr') {
    ctx.fillStyle = pal.noSnr;
    ctx.beginPath();
    ctx.arc(gx, y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(gx, y, r, 0, 2 * Math.PI);
    ctx.stroke();
  } else {
    ctx.fillStyle = pal.text;
    ctx.beginPath();
    ctx.arc(gx - 3, y, 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(gx + 4, y, 4.5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

// drawSymbolKey paints the no-SNR and size legend rows (the directly-heard radar
// has no neighbour-halo or relayed-fade glyphs).
function drawSymbolKey(ctx: CanvasRenderingContext2D, text: RadarText, pal: RadarPalette): void {
  const rows: { kind: 'nosnr' | 'size'; label: string }[] = [
    { kind: 'nosnr', label: text.noSnrLabel },
    { kind: 'size', label: text.sizeLabel },
  ];
  ctx.font = FONT_SMALL;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const gx = 16;
  const lx = 30;
  let y = 12;
  for (const row of rows) {
    drawSymbolGlyph(ctx, row.kind, gx, y, pal);
    ctx.fillStyle = pal.muted;
    ctx.fillText(row.label, lx, y);
    y += SYMBOL_ROW_H;
  }
}

// renderRadar draws the radar into canvas from data = { center, nodes }. opts.text
// overrides label strings, opts.zoom is the range-zoom (data scale), opts.view is
// the {scale,panX,panY} viewport transform. Re-render fully replaces the previous
// frame.
export function renderRadar(
  canvas: HTMLCanvasElement,
  data: RadarData,
  opts: RadarOpts = {}
): void {
  const rc = canvas as RadarCanvas;
  const text: RadarText = { ...DEFAULT_TEXT, ...(opts.text || {}) };
  const view = opts.view || defaultView();
  const pal = resolvePalette();
  const { ctx, cssW, cssH } = setupCanvas(rc);
  bindHover(rc);
  rc._radarHits = [];
  if (rc._radarTip) rc._radarTip.style.display = 'none';

  const center = data && data.center;
  const nodes = ((data && data.nodes) || []).filter((n) => located(n));
  if (!center || typeof center.lat !== 'number' || typeof center.lon !== 'number') {
    drawEmpty(ctx, cssW, cssH, text.noLocation, pal);
    return;
  }
  if (nodes.length === 0) {
    drawEmpty(ctx, cssW, cssH, text.noContacts, pal);
    return;
  }

  const placed = nodes.map((n) => ({
    node: n,
    distKm: haversineKm(center.lat, center.lon, n.lat, n.lon),
    brg: bearingDeg(center.lat, center.lon, n.lat, n.lon),
  }));
  let dMax = 0;
  for (const p of placed) if (p.distKm > dMax) dMax = p.distKm;
  if (dMax <= 0) dMax = 1;
  const { dOuter, dMin } = radarRange(dMax, opts.zoom);

  // Effective centre and scale include the viewport transform. dataRadius is the
  // range-zoomed log radius; radiusFor multiplies by the viewport scale. Dot radii
  // and fonts stay in screen pixels so magnification never blurs them.
  const cx = cssW / 2 + view.panX;
  const cy = cssH / 2 + view.panY;
  const baseOuterR = Math.max(20, Math.min(cssW, cssH) / 2 - 26);
  const outerR = baseOuterR * view.scale;
  const dataRadius = (d: number) => {
    if (d <= dMin) return baseOuterR * 0.02;
    const t = Math.log(d / dMin) / Math.log(LOG_RANGE);
    return baseOuterR * Math.min(1, t);
  };
  const radiusFor = (d: number) => dataRadius(d) * view.scale;

  ctx.strokeStyle = pal.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - outerR, cy);
  ctx.lineTo(cx + outerR, cy);
  ctx.moveTo(cx, cy - outerR);
  ctx.lineTo(cx, cy + outerR);
  ctx.stroke();

  ctx.font = FONT_SMALL;
  const ringLabels: string[] = [];
  for (let k = 1; k <= 4; k++) {
    const d = dOuter * Math.pow(2, k - 4);
    const r = radiusFor(d);
    ctx.strokeStyle = pal.ring;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
    const label = formatKm(d);
    ringLabels.push(label);
    ctx.fillStyle = pal.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx + r * Math.SQRT1_2 + 3, cy + r * Math.SQRT1_2 + 1);
  }

  ctx.fillStyle = pal.text;
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const compass: [string, number, number][] = [
    ['N', 0, -1],
    ['E', 1, 0],
    ['S', 0, 1],
    ['W', -1, 0],
  ];
  for (const [letter, dx, dy] of compass) {
    ctx.strokeStyle = pal.ring;
    ctx.beginPath();
    ctx.moveTo(cx + dx * outerR, cy + dy * outerR);
    ctx.lineTo(cx + dx * (outerR + 4), cy + dy * (outerR + 4));
    ctx.stroke();
    ctx.fillText(letter, cx + dx * (outerR + 13), cy + dy * (outerR + 13));
  }

  ctx.fillStyle = pal.text;
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, 2 * Math.PI);
  ctx.fill();

  const hits: RadarHit[] = [];
  for (const p of placed) {
    if (p.distKm > dOuter) continue;
    const n = p.node;
    const r = radiusFor(p.distKm);
    const a = p.brg * D2R;
    const x = cx + r * Math.sin(a);
    const y = cy - r * Math.cos(a);
    const dotR = Math.min(9, 3 + Math.sqrt(n.receptions || 1));
    ctx.fillStyle = n.snr == null ? pal.noSnr : snrColor(n.snr);
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, 2 * Math.PI);
    ctx.stroke();
    hits.push({ x, y, r: dotR, node: n, distKm: p.distKm, brg: p.brg });
  }
  rc._radarHits = hits;

  drawLegend(ctx, cssH, text, ringLabels, pal);
  drawSymbolKey(ctx, text, pal);
}
