import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureBasemap = vi.fn();
vi.mock('../../share/basemapCapture', () => ({
  captureBasemap: (...args: unknown[]) => captureBasemap(...args),
  BasemapLoadError: class extends Error {},
}));

import { buildFilterResult } from '../../share/cards/filterResult';
import { drawFilterFrame, renderFilterCard } from '../../share/cards/filterResultRender';
import type { CardText } from '../../share/cardChrome';
import { recordingCtx, type RecordingCtx } from './recordingCtx';

const text: CardText = {
  kicker: 'Filter results, 7d',
  title: "What X's filter did not repeat",
  figures: [],
};
const brand = { name: 'RTFM-EV', icon: null };
const model = buildFilterResult(
  [
    { key: 'channel', label: 'channel', value: 1204 },
    { key: 'rate', label: 'rate limit', value: 702 },
  ],
  { airtimeMs: 840000, bins: [100, 400, 1406] }
);
const view = { heroLabel: 'packets not repeated', tone: 'dark' as const, cvd: 'off' as const };

let ctx: RecordingCtx;
beforeEach(() => {
  vi.clearAllMocks();
  ctx = recordingCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
    cb(new Blob(['png'], { type: 'image/png' }));
  });
});
afterEach(() => vi.restoreAllMocks());

describe('drawFilterFrame', () => {
  it('shows the total, the hero label and every reason when finished', () => {
    drawFilterFrame(ctx, model, view, text, brand, 1, (n) => String(n));
    const texts = ctx.texts();
    expect(texts).toContain('1906');
    expect(texts).toContain('packets not repeated');
    expect(texts).toEqual(expect.arrayContaining(['channel', 'rate limit']));
  });

  it('starts from zero', () => {
    drawFilterFrame(ctx, model, view, text, brand, 0, (n) => String(n));
    expect(ctx.texts()).toContain('0');
    expect(ctx.texts()).not.toContain('1906');
  });
});

describe('renderFilterCard', () => {
  it('never asks for a map and animates when there is history', async () => {
    const res = await renderFilterCard(model, text, brand, view);
    expect(captureBasemap).not.toHaveBeenCalled();
    expect(res.gif).toBeTypeOf('function');
  });

  it('has no animation without history', async () => {
    const res = await renderFilterCard({ ...model, bins: [] }, text, brand, view);
    expect(res.gif).toBeUndefined();
  });
});
