import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureChart } from '../../share/cards/chartCapture';

// jsdom has no layout; give every SVG a size so it counts as on screen.
function sized(w: number, h: number) {
  return vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: w,
    height: h,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: w,
    bottom: h,
  } as DOMRect);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

const RECHARTS = `
  <svg class="recharts-surface" width="400" height="200" viewBox="0 0 400 200">
    <defs><clipPath id="recharts1-clip"><rect x="50" y="5" width="340" height="170"></rect></clipPath></defs>
    <g class="recharts-cartesian-grid"><line x1="50" x2="390" y1="20" y2="20" stroke="#ccc"></line></g>
    <g class="recharts-layer recharts-line"><path d="M50,100L390,50" stroke="red"></path></g>
    <g class="recharts-tooltip-cursor"><path d="M1,1"></path></g>
  </svg>
  <ul class="recharts-default-legend">
    <li class="recharts-legend-item"><svg><path fill="rgb(255, 0, 0)" d="M0,0"></path></svg>
      <span class="recharts-legend-item-text">SNR</span></li>
  </ul>`;

describe('captureChart', () => {
  it('returns null when there is no chart on screen', () => {
    expect(captureChart(mount('<p>no chart</p>'))).toBeNull();
  });

  it('takes the plot area from a Recharts clip path', () => {
    sized(400, 200);
    const snap = captureChart(mount(RECHARTS));
    expect(snap?.plot).toEqual({ x: 50, y: 5, w: 340, h: 170 });
    expect(snap?.reveal).toBe('x');
  });

  it('leaves the hover cursor out and the series out of the base layer', () => {
    sized(400, 200);
    const snap = captureChart(mount(RECHARTS))!;
    expect(snap.fullSvg).toContain('recharts-line');
    expect(snap.fullSvg).not.toContain('recharts-tooltip-cursor');
    expect(snap.baseSvg).not.toBeNull();
    expect(snap.baseSvg).not.toContain('recharts-line');
    expect(snap.baseSvg).toContain('recharts-cartesian-grid');
  });

  it('writes the computed styles inline and sets the on-screen size', () => {
    sized(400, 200);
    const snap = captureChart(mount(RECHARTS))!;
    expect(snap.fullSvg).toMatch(/style="[^"]*stroke:/);
    expect(snap.fullSvg).toContain('width="400"');
    expect(snap.fullSvg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('reads the Recharts legend', () => {
    sized(400, 200);
    const snap = captureChart(mount(RECHARTS))!;
    expect(snap.legend.map((l) => l.label)).toEqual(['SNR']);
  });

  it('uses the plot hint for a custom SVG chart and has no base layer', () => {
    sized(360, 80);
    const snap = captureChart(
      mount('<svg viewBox="0 0 360 80"><rect x="0" y="0" width="10" height="10"></rect></svg>'),
      { left: 0.1, top: 0, width: 0.9, height: 1 }
    )!;
    expect(snap.baseSvg).toBeNull();
    expect(snap.plot.x).toBeCloseTo(36);
    expect(snap.plot.w).toBeCloseTo(324);
  });

  it('keeps labels a chart draws outside its box when it shows overflow', () => {
    sized(360, 80);
    // jsdom has no getBBox: the top label sticks out 4 above the box.
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: -4, width: 360, height: 84 }),
    });
    try {
      const snap = captureChart(
        mount('<svg viewBox="0 0 360 80" style="overflow: visible"><text y="0">-85</text></svg>'),
        { left: 0.1, top: 0, width: 0.9, height: 1 }
      )!;
      // 4 overflow plus 2 spare above; nothing sticks out elsewhere.
      expect(snap.fullSvg).toContain('viewBox="0 -6 360 86"');
      expect(snap.height).toBeCloseTo(86);
      expect(snap.width).toBeCloseTo(360);
      // The plot area moves down with the content.
      expect(snap.plot.y).toBeCloseTo(6);
      expect(snap.plot.h).toBeCloseTo(80);
    } finally {
      delete (SVGElement.prototype as { getBBox?: unknown }).getBBox;
    }
  });

  it('leaves the box alone when the chart clips its overflow', () => {
    sized(360, 80);
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: -4, width: 360, height: 84 }),
    });
    try {
      const snap = captureChart(
        mount('<svg viewBox="0 0 360 80" style="overflow: hidden"><text y="0">-85</text></svg>')
      )!;
      expect(snap.fullSvg).toContain('viewBox="0 0 360 80"');
      expect(snap.height).toBe(80);
    } finally {
      delete (SVGElement.prototype as { getBBox?: unknown }).getBBox;
    }
  });

  it('sweeps a pie chart', () => {
    sized(200, 200);
    const snap = captureChart(
      mount(
        '<svg width="200" height="200"><g class="recharts-pie"><path d="M0,0"></path></g></svg>'
      )
    )!;
    expect(snap.reveal).toBe('radial');
  });
});
