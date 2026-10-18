import { describe, expect, it } from 'vitest';
import { drawBarList, drawSparkline } from '../../share/bars';
import { recordingCtx } from './recordingCtx';

const rect = { x: 40, y: 40, w: 600, h: 400 };
const items = [
  { label: 'channel', value: 1204, color: '#f00' },
  { label: 'rate limit', value: 702, color: '#0f0' },
  { label: 'unused', value: 0, color: '#00f' },
];

describe('drawBarList', () => {
  it('draws labels and values for non-zero items only', () => {
    const ctx = recordingCtx();
    drawBarList(ctx, rect, items, 1, 'dark', (n) => String(n));
    const texts = ctx.texts();
    expect(texts).toContain('channel');
    expect(texts).toContain('1204');
    expect(texts).not.toContain('unused');
  });

  it('grows the bars with progress', () => {
    const widths = (p: number) => {
      const ctx = recordingCtx();
      drawBarList(ctx, rect, items, p, 'dark', String);
      return ctx
        .calls('fillRect')
        .map((c) => c.args[2] as number)
        .filter((w) => w > 0 && w < rect.w);
    };
    expect(widths(0)).toEqual([]);
    expect(Math.max(...widths(1))).toBeGreaterThan(Math.max(...widths(0.5)));
  });

  it('keeps every bar inside its rect', () => {
    const ctx = recordingCtx();
    drawBarList(ctx, rect, items, 1, 'light', String);
    for (const c of ctx.calls('fillRect')) {
      const [x, , w] = c.args as number[];
      expect(x).toBeGreaterThanOrEqual(rect.x);
      expect(x + w).toBeLessThanOrEqual(rect.x + rect.w + 0.5);
    }
  });
});

describe('drawSparkline', () => {
  it('draws nothing for fewer than two values', () => {
    const ctx = recordingCtx();
    drawSparkline(ctx, rect, [5], 1, '#0f0');
    expect(ctx.calls('lineTo')).toHaveLength(0);
  });

  it('draws up to the progress point', () => {
    const ctx = recordingCtx();
    drawSparkline(ctx, rect, [1, 2, 3, 4, 5], 0.5, '#0f0');
    const half = ctx.calls('lineTo').length;
    const full = recordingCtx();
    drawSparkline(full, rect, [1, 2, 3, 4, 5], 1, '#0f0');
    expect(full.calls('lineTo').length).toBeGreaterThan(half);
  });
});
