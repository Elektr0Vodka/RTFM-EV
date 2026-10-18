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

import { buildTraceModel, type TraceModel } from '../../share/cards/traceRoute';
import { renderTraceCard } from '../../share/cards/traceRouteRender';
import type { CardText } from '../../share/cardChrome';
import type { TraceMapNode } from '../../utils/traceMapUtils';
import { recordingCtx, type RecordingCtx } from './recordingCtx';

const text: CardText = { kicker: 'Trace route, 21:14', title: 'Trace to Bravo', figures: [] };
const brand = { name: 'RTFM-EV', icon: null };
const opts = { hidePosition: false, noMap: false, flags: {}, cvd: 'off' as const };

function model(dLat: number, dLon: number, located = true): TraceModel {
  const at = (i: number): [number, number] | null =>
    located ? [52 + i * dLat, 5 + i * dLon] : null;
  const n = (
    index: number,
    role: TraceMapNode['role'],
    key: string,
    snr: number | null
  ): TraceMapNode => {
    const loc = role === 'local' ? at(0) : at(index);
    return {
      index,
      role,
      publicKey: key,
      name: key,
      snr,
      lat: loc?.[0] ?? null,
      lon: loc?.[1] ?? null,
    };
  };
  return buildTraceModel(
    [
      n(0, 'local', 'me', null),
      n(1, 'repeater', 'A', 9.5),
      n(2, 'repeater', 'B', -11),
      n(3, 'local', 'me', -12.5),
    ],
    ['Me', 'Alpha', 'Bravo', 'Me']
  );
}

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
      x: (p.lon - 5) * 300 + 100,
      y: 500 - (p.lat - 52) * 300,
    }),
    credit: 'Tiles © Esri',
    tone: 'dark',
  });
});
afterEach(() => vi.restoreAllMocks());

describe('renderTraceCard', () => {
  it('labels each hop with its name and the SNR received there', async () => {
    await renderTraceCard(model(0.1, 0.1), text, brand, opts);
    const texts = ctx.texts();
    expect(texts).toContain('Alpha +9.5 dB');
    expect(texts.join(' ')).toContain('Esri');
  });

  it('draws a diagram with no names when the position is hidden', async () => {
    await renderTraceCard(model(0.1, 0), text, brand, { ...opts, hidePosition: true });
    const north = ctx.calls('lineTo').map((c) => c.args);
    const namesNorth = ctx.texts();
    freshCtx();
    await renderTraceCard(model(0.02, 0.3), text, brand, { ...opts, hidePosition: true });
    const east = ctx.calls('lineTo').map((c) => c.args);
    expect(captureBasemap).not.toHaveBeenCalled();
    expect(north.length).toBeGreaterThan(0);
    expect(east).toEqual(north);
    expect(namesNorth).not.toContain('Alpha +9.5 dB');
    expect(namesNorth).toContain('+9.5 dB');
  });

  it('renders a figures-only card without asking for a map when nothing is located', async () => {
    await renderTraceCard(model(0, 0, false), text, brand, opts);
    expect(captureBasemap).not.toHaveBeenCalled();
    expect(ctx.calls('lineTo')).toHaveLength(0);
    expect(ctx.texts()).toContain('Trace to Bravo');
  });

  it('asks for no map when only my radio has a position', async () => {
    const m = buildTraceModel(
      [
        { index: 0, role: 'local', publicKey: 'me', name: 'me', snr: null, lat: 52, lon: 5 },
        { index: 1, role: 'custom', publicKey: null, name: null, snr: 3, lat: null, lon: null },
        { index: 2, role: 'local', publicKey: 'me', name: 'me', snr: 2, lat: 52, lon: 5 },
      ],
      ['Me', 'AB', 'Me']
    );
    await renderTraceCard(m, text, brand, opts);
    expect(captureBasemap).not.toHaveBeenCalled();
  });

  it('animates', async () => {
    const res = await renderTraceCard(model(0.1, 0.1), text, brand, opts);
    expect(res.gif).toBeTypeOf('function');
  });
});
