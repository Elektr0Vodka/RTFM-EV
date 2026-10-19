import { describe, expect, it } from 'vitest';
import { CHART_BOX, drawChartFrame, fitChart, plotOnCard } from '../../share/cards/chartCardRender';
import type { ChartSnapshot } from '../../share/cards/chartCapture';
import { chartClock, formatSpan } from '../../share/cards/useChartShare';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { recordingCtx } from './recordingCtx';

const brand = { name: 'RTFM-EV', icon: null };

function snap(over: Partial<ChartSnapshot> = {}): ChartSnapshot {
  return {
    width: 800,
    height: 300,
    fullSvg: '<svg/>',
    baseSvg: '<svg/>',
    plot: { x: 40, y: 10, w: 740, h: 260 },
    reveal: 'x',
    legend: [{ label: 'RSSI', color: 'rgb(255, 0, 0)' }],
    background: 'rgb(10, 10, 10)',
    tone: 'dark',
    ...over,
  };
}

const full = { id: 'full' } as unknown as CanvasImageSource;
const base = { id: 'base' } as unknown as CanvasImageSource;
const text = {
  kicker: '1 Oct 10:00 to 2 Oct 10:00',
  title: 'Signal',
  speed: '24 h in 4 seconds',
  clock: (p: number) => `clock ${p.toFixed(2)}`,
};

const drawn = (ctx: ReturnType<typeof recordingCtx>) =>
  ctx.calls('drawImage').map((c) => c.args[0]);

describe('chart card layout', () => {
  it('fits the chart in the chart box, keeping its shape', () => {
    const at = fitChart({ width: 800, height: 300 });
    expect(at.w / at.h).toBeCloseTo(800 / 300);
    expect(at.w).toBeLessThanOrEqual(CHART_BOX.w + 0.001);
    expect(at.h).toBeLessThanOrEqual(CHART_BOX.h + 0.001);
    expect(at.x).toBeGreaterThanOrEqual(CHART_BOX.x);
  });

  it('scales the plot area with the chart', () => {
    const s = snap();
    const at = fitChart(s);
    const plot = plotOnCard(s, at);
    const k = at.w / s.width;
    expect(plot.x).toBeCloseTo(at.x + 40 * k);
    expect(plot.w).toBeCloseTo(740 * k);
  });
});

describe('drawChartFrame', () => {
  it('draws the finished chart without a clip at progress 1', () => {
    const ctx = recordingCtx();
    drawChartFrame(ctx, snap(), { full, base }, text, brand, 1);
    expect(drawn(ctx)).toEqual([full]);
    expect(ctx.calls('clip')).toHaveLength(0);
    const texts = ctx.texts();
    expect(texts).toContain('Signal');
    expect(texts).toContain('clock 1.00');
    expect(texts).toContain('24 h in 4 seconds');
    expect(texts).toContain('RSSI');
    expect(texts).toContain('RTFM-EV');
  });

  it('keeps the axes and lets the data flow in over the plot', () => {
    const s = snap();
    const ctx = recordingCtx();
    drawChartFrame(ctx, s, { full, base }, text, brand, 0.5);
    expect(drawn(ctx)).toEqual([base, full]);
    const plot = plotOnCard(s, fitChart(s));
    const rect = ctx.calls('rect')[0].args as number[];
    expect(rect[0]).toBeCloseTo(plot.x);
    expect(rect[2]).toBeCloseTo(plot.w * 0.5);
    expect(ctx.texts()).toContain('clock 0.50');
  });

  it('hides only the plot still to come when there is no axes-only layer', () => {
    const ctx = recordingCtx();
    drawChartFrame(ctx, snap({ baseSvg: null }), { full, base: null }, text, brand, 0.25);
    expect(drawn(ctx)).toEqual([full, full]);
    expect(ctx.calls('clip')[0].args).toEqual(['evenodd']);
  });

  it('sweeps a pie round instead of left to right', () => {
    const ctx = recordingCtx();
    drawChartFrame(ctx, snap({ reveal: 'radial' }), { full, base }, text, brand, 0.5);
    const arc = ctx.calls('arc')[0].args as number[];
    expect(arc[4] - arc[3]).toBeCloseTo(Math.PI);
  });

  it('leaves out the clock and speed without a time range', () => {
    const ctx = recordingCtx();
    drawChartFrame(ctx, snap(), { full, base }, { ...text, speed: null, clock: null }, brand, 1);
    expect(ctx.texts().some((s) => s.startsWith('clock'))).toBe(false);
    expect(ctx.texts()).not.toContain('24 h in 4 seconds');
  });
});

describe('share clock and speed', () => {
  const t = (key: string, p?: Record<string, unknown>) => `${key}:${p?.n}`;

  it('names the span in minutes, hours or days', () => {
    expect(formatSpan(t as never, 30 * 60)).toBe('share_chart_span_minutes:30');
    expect(formatSpan(t as never, 24 * 3600)).toBe('share_chart_span_hours:24');
    expect(formatSpan(t as never, 7 * 86400)).toBe('share_chart_span_days:7');
  });

  it('runs the clock from start to end', () => {
    const start = Date.UTC(2026, 9, 1, 10, 0) / 1000;
    const clock = chartClock([start, start + 3600], false);
    const fmt = (ts: number) => formatDateTime(ts * 1000, { hour: '2-digit', minute: '2-digit' });
    expect(clock(0)).toBe(fmt(start));
    expect(clock(0.5)).toBe(fmt(start + 1800));
    expect(clock(1)).toBe(fmt(start + 3600));
  });
});
