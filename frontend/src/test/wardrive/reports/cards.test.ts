import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureBasemap = vi.fn();
vi.mock('../../../share/basemapCapture', () => ({
  captureBasemap: (...args: unknown[]) => captureBasemap(...args),
  BasemapLoadError: class extends Error {},
}));
vi.mock('../../../share/gifEncoder', () => ({
  buildPalette: () => new Uint8Array(3),
  GifWriter: class {
    addFrame() {}
    finish() {
      return new Uint8Array([0x47]);
    }
  },
}));

import type { CardText } from '../../../share/cardChrome';
import {
  coverageCardModel,
  driveCardModel,
  drawReportFrame,
  renderReportCard,
  weakCardModel,
} from '../../../wardrive/reports/cards';
import { recordingCtx, type RecordingCtx } from '../../share/recordingCtx';
import { T0, cell, emptyReport, report } from './fixtures';

const text: CardText = { kicker: 'Wardrive', title: 'My drive', figures: [] };
const brand = { name: 'RTFM-EV', icon: null };
const opts = { hidePosition: false, noMap: false, flags: {}, cvd: 'off' as const };

let ctx: RecordingCtx;
function freshCtx() {
  ctx = recordingCtx();
  (ctx as unknown as { getImageData: () => ImageData }).getImageData = () =>
    ({ data: new Uint8ClampedArray(4) }) as ImageData;
}

const view = {
  project: (p: { lat: number; lon: number }) => ({ x: p.lon * 10, y: p.lat * 10 }),
  mapImage: null,
  tone: 'dark' as const,
  diagram: false,
  hideNames: false,
  cvd: 'off' as const,
};

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
    project: view.project,
    credit: 'OpenFreeMap',
    tone: 'dark',
  });
});
afterEach(() => vi.restoreAllMocks());

const arcs = () => ctx.calls('arc').length;

describe('report card models', () => {
  it('the drive card holds the track and the receptions', () => {
    const m = driveCardModel(report());
    expect(m.points).toHaveLength(2);
    expect(m.tracks[0]).toHaveLength(2);
    expect(m.located.length).toBe(4);
    expect([m.t0, m.t1]).toEqual([T0, T0 + 600]);
    expect(m.empty).toBe(false);
  });

  it('a report without receptions or track has an empty drive card', () => {
    expect(driveCardModel(emptyReport()).empty).toBe(true);
    expect(coverageCardModel(emptyReport()).empty).toBe(true);
  });

  it('the coverage card holds every cell with its ring', () => {
    const m = coverageCardModel(
      report({ cells: [cell(), cell({ id: '9:1:2', first_ts: T0 + 60 })] })
    );
    expect(m.cells).toHaveLength(2);
    expect(m.cells[0].ring).toHaveLength(7);
    expect(m.located.length).toBe(2);
  });

  it('the weak card flags gaps and weak cells', () => {
    const m = weakCardModel(
      report({
        cells: [
          cell(),
          cell({ id: '9:1:2', receptions: 0, band: 'none' }),
          cell({ id: '9:2:3', band: 'weak' }),
        ],
      })
    );
    expect(m.cells.map((c) => c.flagged)).toEqual([false, true, true]);
  });
});

describe('report card frames', () => {
  it('the drive replay shows no reception at the start and all at the end', () => {
    const m = driveCardModel(report());
    drawReportFrame(ctx, { kind: 'drive', model: m }, view, text, brand, 0);
    const atStart = arcs();
    freshCtx();
    drawReportFrame(ctx, { kind: 'drive', model: m }, view, text, brand, 1);
    expect(arcs() - atStart).toBe(2);
  });

  it('the coverage card fills cells in time order', () => {
    const m = coverageCardModel(
      report({ cells: [cell(), cell({ id: '9:1:2', first_ts: T0 + 600 })] })
    );
    drawReportFrame(ctx, { kind: 'coverage', model: m }, view, text, brand, 0.5);
    const half = ctx.calls('fill').length;
    freshCtx();
    drawReportFrame(ctx, { kind: 'coverage', model: m }, view, text, brand, 1);
    expect(ctx.calls('fill').length - half).toBe(1);
  });

  it('renders the drive card as PNG and GIF on the basemap', async () => {
    const card = await renderReportCard('drive', report(), text, brand, opts);
    expect(captureBasemap).toHaveBeenCalled();
    expect(card.png).toBeInstanceOf(Blob);
    expect(card.gif).toBeTypeOf('function');
  });

  it('the weak spots card is a picture only', async () => {
    const card = await renderReportCard('weak', report(), text, brand, opts);
    expect(card.gif).toBeUndefined();
  });

  it('survives a very large report', () => {
    const many = Array.from(
      { length: 300000 },
      (_, i) => [6 + i * 1e-6, 52, T0 + i] as [number, number, number]
    );
    const big = report({ tracks: [{ drive_id: 1, points: many }] });
    expect(() => driveCardModel(big)).not.toThrow();
    expect(driveCardModel(big).t1).toBe(T0 + 299999);
  });

  it('fits the coverage card on cell centres', () => {
    const m = coverageCardModel(report({ cells: [cell(), cell({ id: '9:1:2' })] }));
    expect(m.located).toHaveLength(2);
  });

  it('honours hide my position: no basemap and no names', async () => {
    await renderReportCard('drive', report(), text, brand, { ...opts, hidePosition: true });
    expect(captureBasemap).not.toHaveBeenCalled();
  });

  it('draws without the basemap when asked', async () => {
    await renderReportCard('coverage', report(), text, brand, { ...opts, noMap: true });
    expect(captureBasemap).not.toHaveBeenCalled();
  });
});
