import type { CardTone } from '../cardChrome';

/** A rectangle as fractions (0..1) of the chart's SVG box. */
export interface PlotFrac {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChartLegendItem {
  label: string;
  color: string;
}

/**
 * A chart as it is on screen, made self-contained so it can be drawn into a
 * canvas: the SVG with every computed style written inline (classes and CSS
 * variables do not resolve in a detached image).
 */
export interface ChartSnapshot {
  /** Size of the SVG on screen, in CSS px. */
  width: number;
  height: number;
  /** The whole chart. */
  fullSvg: string;
  /** Axes and grid without the data series; null when the series are not
   *  known (custom SVG charts), then the plot area is hidden instead. */
  baseSvg: string | null;
  /** The plot area in CSS px of the SVG box; the data flows in across it. */
  plot: PxBox;
  /** 'radial' for a pie (it sweeps round), else left to right. */
  reveal: 'x' | 'radial';
  legend: ChartLegendItem[];
  /** The page background behind the chart, as a CSS colour. */
  background: string;
  tone: CardTone;
}

// The styles a chart's look depends on. Copied from the live element because
// Tailwind classes and `hsl(var(--x))` values only resolve inside the page.
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stop-color',
  'stop-opacity',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
  'visibility',
  'display',
];

/** Hover state that should not be in a shared picture. */
const HOVER_SELECTORS = '.recharts-tooltip-cursor, .recharts-active-dot';
/** Recharts data series; removed for the axes-only base layer. */
const SERIES_SELECTORS =
  '.recharts-line, .recharts-area, .recharts-bar, .recharts-scatter, .recharts-pie, .recharts-label-list';

function largestSvg(container: HTMLElement): SVGSVGElement | null {
  let best: SVGSVGElement | null = null;
  let bestArea = 0;
  container.querySelectorAll('svg').forEach((svg) => {
    if (svg.closest('.recharts-legend-wrapper, button')) return;
    const r = svg.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      best = svg;
      bestArea = area;
    }
  });
  return best;
}

function inlineStyles(src: Element, dst: Element): void {
  const from = [src, ...Array.from(src.querySelectorAll('*'))];
  const to = [dst, ...Array.from(dst.querySelectorAll('*'))];
  for (let i = 0; i < from.length && i < to.length; i++) {
    const cs = getComputedStyle(from[i]);
    const decl = STYLE_PROPS.map((p) => {
      const v = cs.getPropertyValue(p);
      return v ? `${p}:${v}` : '';
    })
      .filter(Boolean)
      .join(';');
    if (decl) (to[i] as SVGElement).setAttribute('style', decl);
  }
}

/** First non-transparent background behind `el`, as a CSS colour. */
export function backgroundBehind(el: Element | null): string {
  for (let node = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return bg;
  }
  return '#1b2430';
}

/** Light or dark, from the colour's luminance (any CSS colour the browser knows). */
export function toneOf(color: string): CardTone {
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext('2d');
    if (!ctx) return 'dark';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function viewBoxOf(svg: SVGSVGElement, w: number, h: number): [number, number, number, number] {
  const vb = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    return vb as [number, number, number, number];
  }
  return [0, 0, w, h];
}

/** Spare room, in CSS px, kept around content that sticks out of the box. */
const OVERFLOW_PAD = 2;

/**
 * The viewBox grown to take in what the chart draws outside it. A chart with
 * `overflow: visible` (a label centred on the top grid line) shows that part
 * on screen, but an SVG loaded as an image clips it to the viewBox.
 */
function viewBoxWithOverflow(
  svg: SVGSVGElement,
  vb: [number, number, number, number],
  w: number,
  h: number
): [number, number, number, number] {
  if (getComputedStyle(svg).overflow !== 'visible' || typeof svg.getBBox !== 'function') return vb;
  let bb: { x: number; y: number; width: number; height: number };
  try {
    bb = svg.getBBox();
  } catch {
    return vb;
  }
  if (![bb.x, bb.y, bb.width, bb.height].every(Number.isFinite)) return vb;
  const [vx, vy, vw, vh] = vb;
  const px = (OVERFLOW_PAD * vw) / w;
  const py = (OVERFLOW_PAD * vh) / h;
  const x0 = bb.x < vx ? bb.x - px : vx;
  const y0 = bb.y < vy ? bb.y - py : vy;
  const x1 = bb.x + bb.width > vx + vw ? bb.x + bb.width + px : vx + vw;
  const y1 = bb.y + bb.height > vy + vh ? bb.y + bb.height + py : vy + vh;
  return [x0, y0, x1 - x0, y1 - y0];
}

/** The plot area: Recharts clips its series to it; otherwise the caller's hint. */
function plotBox(svg: SVGSVGElement, w: number, h: number, hint: PlotFrac | undefined): PxBox {
  const [vx, vy, vw, vh] = viewBoxOf(svg, w, h);
  const clip = svg.querySelector('clipPath[id$="-clip"] rect');
  if (clip) {
    const num = (a: string) => Number(clip.getAttribute(a));
    const [x, y, cw, ch] = [num('x'), num('y'), num('width'), num('height')];
    if ([x, y, cw, ch].every(Number.isFinite) && cw > 0 && ch > 0) {
      const sx = w / vw;
      const sy = h / vh;
      return { x: (x - vx) * sx, y: (y - vy) * sy, w: cw * sx, h: ch * sy };
    }
  }
  const f = hint ?? { left: 0, top: 0, width: 1, height: 1 };
  return { x: f.left * w, y: f.top * h, w: f.width * w, h: f.height * h };
}

function legendOf(container: HTMLElement): ChartLegendItem[] {
  const items: ChartLegendItem[] = [];
  container.querySelectorAll('.recharts-legend-item').forEach((li) => {
    const textEl = li.querySelector('.recharts-legend-item-text');
    const label = (textEl?.textContent ?? li.textContent ?? '').trim();
    if (!label) return;
    const icon = li.querySelector('svg path, svg line, svg rect');
    const iconStyle = icon ? getComputedStyle(icon) : null;
    const fill = iconStyle?.fill;
    const color =
      fill && fill !== 'none'
        ? fill
        : iconStyle?.stroke && iconStyle.stroke !== 'none'
          ? iconStyle.stroke
          : textEl
            ? getComputedStyle(textEl).color
            : '#888';
    items.push({ label, color });
  });
  return items;
}

/**
 * Snapshot the biggest chart SVG inside `container`. Null when there is none
 * on screen. `plotHint` is the plot area for a custom SVG chart (Recharts
 * charts carry their own).
 */
export function captureChart(container: HTMLElement, plotHint?: PlotFrac): ChartSnapshot | null {
  const svg = largestSvg(container);
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.querySelectorAll(HOVER_SELECTORS).forEach((n) => n.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const box = viewBoxOf(svg, rect.width, rect.height);
  const [vx, vy, vw, vh] = viewBoxWithOverflow(svg, box, rect.width, rect.height);
  // Same scale as on screen; the size grows with any overflow taken in.
  const sx = rect.width / box[2];
  const sy = rect.height / box[3];
  const width = vw * sx;
  const height = vh * sy;
  const plot = plotBox(svg, rect.width, rect.height, plotHint);
  plot.x += (box[0] - vx) * sx;
  plot.y += (box[1] - vy) * sy;
  clone.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const serializer = new XMLSerializer();
  const fullSvg = serializer.serializeToString(clone);
  let baseSvg: string | null = null;
  if (clone.querySelector(SERIES_SELECTORS)) {
    const base = clone.cloneNode(true) as SVGSVGElement;
    base.querySelectorAll(SERIES_SELECTORS).forEach((n) => n.remove());
    baseSvg = serializer.serializeToString(base);
  }

  const background = backgroundBehind(container);
  return {
    width,
    height,
    fullSvg,
    baseSvg,
    plot,
    reveal: svg.querySelector('.recharts-pie') ? 'radial' : 'x',
    legend: legendOf(container),
    background,
    tone: toneOf(background),
  };
}

/** Loads a serialized SVG as an image the canvas can draw. */
export function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('chart image did not load'));
    };
    img.src = url;
  });
}
