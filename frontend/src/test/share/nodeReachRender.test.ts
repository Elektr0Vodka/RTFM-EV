import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureBasemap = vi.fn();
vi.mock('../../share/basemapCapture', () => ({
  captureBasemap: (...args: unknown[]) => captureBasemap(...args),
  BasemapLoadError: class extends Error {},
}));
vi.mock('../../share/gifEncoder', () => ({
  buildPalette: () => new Uint8Array(3),
  GifWriter: class {
    addFrame() {}
    finish() {
      return new Uint8Array([0x47]);
    }
  },
}));

import { buildNodeReachModel } from '../../share/cards/nodeReach';
import { drawNodeReachFrame, renderNodeReachCard } from '../../share/cards/nodeReachRender';
import type { CardText } from '../../share/cardChrome';
import { recordingCtx, type RecordingCtx } from './recordingCtx';

const text: CardText = { kicker: 'Last 7 days', title: 'Who Me hears directly', figures: [] };
const brand = { name: 'RTFM-EV', icon: null };
const opts = { hidePosition: false, noMap: false, flags: {}, cvd: 'off' as const };

const model = (dLat: number, dLon: number, center = true) =>
  buildNodeReachModel(
    [
      { public_key: 'a', name: 'Alpha', first_seen: 1, lat: 52 + dLat, lon: 5 + dLon, best_snr: 8 },
      {
        public_key: 'b',
        name: 'Bravo',
        first_seen: 2,
        lat: 52 - dLat,
        lon: 5 + 2 * dLon,
        best_snr: -9,
      },
    ],
    center ? { lat: 52, lon: 5 } : null,
    []
  );

let ctx: RecordingCtx;
function freshCtx() {
  ctx = recordingCtx();
  (ctx as unknown as { getImageData: () => ImageData }).getImageData = () =>
    ({ data: new Uint8ClampedArray(4) }) as ImageData;
}

beforeEach(() => {
  vi.clearAllMocks();
  freshCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
    cb(new Blob(['png'], { type: 'image/png' }));
  });
  captureBasemap.mockResolvedValue({
    image: {} as HTMLCanvasElement,
    project: (p: { lat: number; lon: number }) => ({
      x: (p.lon - 5) * 300 + 300,
      y: 300 - (p.lat - 52) * 300,
    }),
    credit: 'OpenFreeMap',
    tone: 'dark',
  });
});
afterEach(() => vi.restoreAllMocks());

describe('renderNodeReachCard', () => {
  it('draws a line to each neighbour with its name on the map', async () => {
    await renderNodeReachCard(model(0.1, 0.1), text, brand, opts);
    expect(captureBasemap).toHaveBeenCalled();
    expect(ctx.calls('lineTo').length).toBeGreaterThanOrEqual(2);
    expect(ctx.texts()).toEqual(expect.arrayContaining(['Alpha', 'Bravo']));
  });

  it('draws a ring diagram with no names and no real geometry when the position is hidden', async () => {
    await renderNodeReachCard(model(0.1, 0), text, brand, { ...opts, hidePosition: true });
    const a = ctx.calls('lineTo').map((c) => c.args);
    const namesA = ctx.texts();
    freshCtx();
    await renderNodeReachCard(model(0.01, 0.4), text, brand, { ...opts, hidePosition: true });
    const b = ctx.calls('lineTo').map((c) => c.args);
    expect(captureBasemap).not.toHaveBeenCalled();
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(namesA).not.toContain('Alpha');
  });

  it('uses the diagram without my position, and keeps the names', async () => {
    await renderNodeReachCard(model(0.1, 0.1, false), text, brand, opts);
    expect(captureBasemap).not.toHaveBeenCalled();
    expect(ctx.calls('lineTo').length).toBeGreaterThan(0);
    expect(ctx.texts()).toContain('Alpha');
  });

  it('shows no neighbour at progress 0', () => {
    const m = model(0.1, 0.1, false);
    drawNodeReachFrame(
      ctx,
      m,
      { project: null, mapImage: null, tone: 'dark', diagram: true, hideNames: false, cvd: 'off' },
      text,
      brand,
      0
    );
    expect(ctx.calls('lineTo')).toHaveLength(0);
  });
});
