import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureBasemap = vi.fn();
vi.mock('../../share/basemapCapture', () => ({
  captureBasemap: (...args: unknown[]) => captureBasemap(...args),
  BasemapLoadError: class extends Error {},
}));

import { buildMeshSummaryModel } from '../../share/cards/meshSummary';
import {
  LIT_RADIUS,
  drawMeshSummaryFrame,
  renderMeshSummaryCard,
} from '../../share/cards/meshSummaryRender';
import type { CardText } from '../../share/cardChrome';
import { fitProjector } from '../../share/geo';
import { recordingCtx, type RecordingCtx } from './recordingCtx';

const text: CardText = { kicker: 'Last 24h', title: 'The mesh around Base', figures: [] };
const brand = { name: 'RTFM-EV', icon: null };

const model = buildMeshSummaryModel({
  totalContacts: 3,
  contacts: [
    { public_key: 'a', lat: 52, lon: 5, flood_count: 1 },
    { public_key: 'b', lat: 52.2, lon: 5.1, flood_count: 0 },
    { public_key: 'c', lat: 52.4, lon: 4.9, flood_count: 0 },
  ],
  totalPackets: 100,
  airtime: [],
  heardBins: [{ keys: ['a'] }, { keys: ['b'] }],
  packetBins: [3, 5],
});

const view = {
  project: fitProjector(model.located, { x: 0, y: 0, w: 690, h: 630 }, 48),
  mapImage: null,
  tone: 'dark' as const,
  diagram: false,
  hideNames: false,
  cvd: 'off' as const,
};

const lit = (ctx: RecordingCtx) => ctx.calls('arc').filter((c) => c.args[2] === LIT_RADIUS).length;

let ctx: RecordingCtx;
beforeEach(() => {
  vi.clearAllMocks();
  ctx = recordingCtx();
});
afterEach(() => vi.restoreAllMocks());

describe('drawMeshSummaryFrame', () => {
  it('lights no node at progress 0 and every heard node at the end', () => {
    drawMeshSummaryFrame(ctx, model, view, text, brand, 0);
    expect(lit(ctx)).toBe(0);
    const end = recordingCtx();
    drawMeshSummaryFrame(end, model, view, text, brand, 1);
    expect(lit(end)).toBe(2);
  });

  it('lights every located node when there is no history', () => {
    const noBins = { ...model, bins: [] };
    drawMeshSummaryFrame(ctx, noBins, view, text, brand, 1);
    expect(lit(ctx)).toBe(3);
  });
});

describe('renderMeshSummaryCard', () => {
  it('asks for the map around the heard nodes and animates', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ctx as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
      cb(new Blob(['png'], { type: 'image/png' }));
    });
    captureBasemap.mockResolvedValue({
      image: {} as HTMLCanvasElement,
      project: () => ({ x: 1, y: 1 }),
      credit: 'OpenFreeMap',
      tone: 'dark',
    });
    const res = await renderMeshSummaryCard(model, text, brand, {
      hidePosition: false,
      noMap: false,
      flags: {},
      cvd: 'off',
    });
    expect(captureBasemap).toHaveBeenCalled();
    expect(res.gif).toBeTypeOf('function');
  });
});
