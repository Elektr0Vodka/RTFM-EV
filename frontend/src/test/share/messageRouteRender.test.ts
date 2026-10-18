import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureBasemap = vi.fn();
vi.mock('../../share/basemapCapture', () => ({
  captureBasemap: (...args: unknown[]) => captureBasemap(...args),
  BasemapLoadError: class extends Error {},
}));

const addFrame = vi.fn();
vi.mock('../../share/gifEncoder', () => ({
  buildPalette: () => new Uint8Array(3),
  GifWriter: class {
    addFrame(...args: unknown[]) {
      addFrame(...args);
    }
    finish() {
      return new Uint8Array([0x47, 0x49, 0x46]);
    }
  },
}));

import {
  ANIM,
  drawMessageRouteFrame,
  frameProgressList,
  renderMessageRouteCard,
  type MessageRouteView,
} from '../../share/cards/messageRouteRender';
import type { MessageRouteModel, RouteLine } from '../../share/cards/messageRoute';
import type { CardText } from '../../share/cardChrome';
import type { CardBrand } from '../../share/brand';
import { fitProjector } from '../../share/geo';
import { recordingCtx, type RecordingCtx } from './recordingCtx';

const text: CardText = {
  kicker: '#public, 21:14',
  title: "How Jan's message reached me",
  figures: [],
};
const brand: CardBrand = { name: 'RTFM-EV', icon: null };

function route(i: number, located = true): RouteLine {
  const p = (lat: number) => (located ? { lat, lon: 5 + i * 0.01 } : null);
  return {
    stops: [
      { kind: 'sender', name: 'Jan', point: p(52) },
      { kind: 'hop', name: `Hop${i}`, point: p(52.2) },
      { kind: 'receiver', name: 'Me', point: p(52.4) },
    ],
    receivedAt: i,
    hopCount: 1,
    colorIndex: i,
  };
}

function modelWithRoutes(n: number, located = true): MessageRouteModel {
  const routes = Array.from({ length: n }, (_, i) => route(i, located));
  const pts = located ? routes.flatMap((r) => r.stops.map((s) => s.point!)) : [];
  return {
    outgoing: false,
    routes,
    located: pts,
    routeCount: n,
    hopsMin: 1,
    hopsMax: 1,
    straightKm: located ? 44 : null,
    bestSnr: null,
  };
}

const emptyModel = modelWithRoutes(1, false);

function view(model: MessageRouteModel, over: Partial<MessageRouteView> = {}): MessageRouteView {
  return {
    project: fitProjector(model.located, { x: 0, y: 0, w: 690, h: 630 }, 48),
    mapImage: null,
    tone: 'dark',
    hideNames: false,
    cvd: 'off',
    ...over,
  };
}

let ctx: RecordingCtx;

beforeEach(() => {
  vi.clearAllMocks();
  ctx = recordingCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D
  );
  (ctx as unknown as { getImageData: () => ImageData }).getImageData = () =>
    ({ data: new Uint8ClampedArray(4) }) as ImageData;
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
    cb(new Blob(['png'], { type: 'image/png' }));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('frameProgressList', () => {
  it('starts with the finished picture, then plays from empty to full', () => {
    const list = frameProgressList();
    expect(list[0]).toBe(1);
    expect(list[1]).toBe(0);
    expect(list[list.length - 1]).toBe(1);
    expect(list.length).toBe(2 + Math.round((ANIM.playMs / 1000) * ANIM.fps));
  });
});

describe('drawMessageRouteFrame', () => {
  it('renders figures-only card when nothing is located', () => {
    drawMessageRouteFrame(ctx, emptyModel, view(emptyModel, { project: null }), text, brand, 1);
    expect(ctx.calls('drawImage')).toHaveLength(0);
    expect(ctx.calls('lineTo')).toHaveLength(0);
    expect(ctx.texts()).toContain(text.title);
  });

  it('at progress 0 no route segment is drawn', () => {
    const m = modelWithRoutes(2);
    drawMessageRouteFrame(ctx, m, view(m), text, brand, 0);
    expect(ctx.calls('lineTo')).toHaveLength(0);
  });

  it('at progress 1 every route is drawn', () => {
    const m = modelWithRoutes(2);
    drawMessageRouteFrame(ctx, m, view(m), text, brand, 1);
    expect(ctx.calls('lineTo').length).toBeGreaterThanOrEqual(4);
  });

  it('draws node names unless they are hidden', () => {
    const m = modelWithRoutes(1);
    drawMessageRouteFrame(ctx, m, view(m), text, brand, 1);
    expect(ctx.texts()).toContain('Hop0');
    const hidden = recordingCtx();
    drawMessageRouteFrame(hidden, m, view(m, { hideNames: true }), text, brand, 1);
    expect(hidden.texts()).not.toContain('Hop0');
    expect(hidden.texts()).not.toContain('Me');
  });

  it('marks and names the first located hop when the sender has no position', () => {
    const m: MessageRouteModel = {
      ...modelWithRoutes(1),
      routes: [
        {
          stops: [
            { kind: 'sender', name: 'Jan', point: null },
            { kind: 'hop', name: 'FirstHop', point: { lat: 52, lon: 5 } },
            { kind: 'hop', name: 'SecondHop', point: { lat: 52.3, lon: 5 } },
            { kind: 'receiver', name: 'Me', point: null },
          ],
          receivedAt: 0,
          hopCount: 2,
          colorIndex: 0,
        },
      ],
      located: [
        { lat: 52, lon: 5 },
        { lat: 52.3, lon: 5 },
      ],
    };
    drawMessageRouteFrame(ctx, m, view(m), text, brand, 1);
    expect(ctx.calls('arc')).toHaveLength(2);
    expect(ctx.texts()).toContain('FirstHop');
    expect(ctx.texts()).toContain('SecondHop');
  });

  it('skips a label that would overlap one already drawn', () => {
    const m = modelWithRoutes(1);
    // Stops a few pixels apart (52, 52.2, 52.4 → y 300, 304, 308): one label fits.
    const project = (p: { lat: number; lon: number }) => ({ x: 300, y: 300 + (p.lat - 52) * 20 });
    drawMessageRouteFrame(ctx, m, view(m, { project }), text, brand, 1);
    const names = ctx.texts().filter((s) => ['Jan', 'Hop0', 'Me'].includes(s));
    expect(names).toHaveLength(1);
  });

  it('draws the base map image when there is one', () => {
    const m = modelWithRoutes(1);
    const img = {} as HTMLCanvasElement;
    drawMessageRouteFrame(ctx, m, view(m, { mapImage: img }), text, brand, 1);
    expect(ctx.calls('drawImage')[0].args[0]).toBe(img);
  });
});

describe('renderMessageRouteCard', () => {
  const opts = { hidePosition: false, noMap: false, flags: {}, cvd: 'off' as const };

  it('uses the captured map and its credit', async () => {
    const m = modelWithRoutes(1);
    captureBasemap.mockResolvedValue({
      image: {} as HTMLCanvasElement,
      project: () => ({ x: 1, y: 1 }),
      credit: 'Tiles © Esri',
      tone: 'light',
    });
    const res = await renderMessageRouteCard(m, text, brand, opts);
    expect(captureBasemap).toHaveBeenCalledTimes(1);
    expect(res.png.type).toBe('image/png');
    expect(ctx.texts().join(' ')).toContain('Esri');
  });

  it('draws no node names and no credit when the position is hidden', async () => {
    const m = modelWithRoutes(1);
    await renderMessageRouteCard(m, { ...text, credit: 'should go' }, brand, {
      ...opts,
      hidePosition: true,
    });
    expect(captureBasemap).not.toHaveBeenCalled();
    expect(ctx.texts()).not.toContain('Hop0');
    expect(ctx.texts().join(' ')).not.toContain('should go');
  });

  it('draws a diagram, not real geometry, when the position is hidden', async () => {
    const shaped = (dLat: number, dLon: number): MessageRouteModel => {
      const pts = [0, 1, 2].map((i) => ({ lat: 52 + i * dLat, lon: 5 + i * dLon }));
      return {
        ...modelWithRoutes(1),
        routes: [
          {
            stops: [
              { kind: 'sender', name: 'Jan', point: pts[0] },
              { kind: 'hop', name: 'Hop0', point: pts[1] },
              { kind: 'receiver', name: 'Me', point: pts[2] },
            ],
            receivedAt: 0,
            hopCount: 1,
            colorIndex: 0,
          },
        ],
        located: pts,
      };
    };
    const lines = async (m: MessageRouteModel) => {
      ctx = recordingCtx();
      (ctx as unknown as { getImageData: () => ImageData }).getImageData = () =>
        ({ data: new Uint8ClampedArray(4) }) as ImageData;
      await renderMessageRouteCard(m, text, brand, { ...opts, hidePosition: true });
      return ctx.calls('lineTo').map((c) => c.args);
    };
    const north = await lines(shaped(0.3, 0));
    const eastBent = await lines(shaped(0.05, 0.4));
    expect(north.length).toBeGreaterThan(0);
    expect(eastBent).toEqual(north);
  });

  it('skips the map when asked to make it without one', async () => {
    const m = modelWithRoutes(1);
    await renderMessageRouteCard(m, text, brand, { ...opts, noMap: true });
    expect(captureBasemap).not.toHaveBeenCalled();
    expect(ctx.texts()).toContain('Hop0');
  });

  it('renders figures-only card without asking for a map when nothing is located', async () => {
    await renderMessageRouteCard(emptyModel, text, brand, opts);
    expect(captureBasemap).not.toHaveBeenCalled();
  });

  it('frame count is independent of route count', async () => {
    captureBasemap.mockResolvedValue({
      image: {} as HTMLCanvasElement,
      project: () => ({ x: 1, y: 1 }),
      credit: '',
      tone: 'dark',
    });
    const one = await renderMessageRouteCard(modelWithRoutes(1), text, brand, opts);
    await one.gif();
    const a = addFrame.mock.calls.length;
    addFrame.mockClear();
    const many = await renderMessageRouteCard(modelWithRoutes(25), text, brand, opts);
    const gif = await many.gif();
    expect(addFrame.mock.calls.length).toBe(a);
    expect(a).toBe(frameProgressList().length);
    expect(gif.type).toBe('image/gif');
  });

  it('stops encoding when the GIF is aborted', async () => {
    const res = await renderMessageRouteCard(modelWithRoutes(1), text, brand, {
      ...opts,
      noMap: true,
    });
    const ctrl = new AbortController();
    addFrame.mockImplementation(() => {
      if (addFrame.mock.calls.length === 3) ctrl.abort();
    });
    await expect(res.gif(ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(addFrame.mock.calls.length).toBe(3);
    addFrame.mockReset();
  });

  it('holds the last frame and shows the first one before playing', async () => {
    const res = await renderMessageRouteCard(modelWithRoutes(1), text, brand, {
      ...opts,
      noMap: true,
    });
    await res.gif();
    const delays = addFrame.mock.calls.map((c) => c[1] as number);
    expect(delays[0]).toBe(ANIM.firstMs / 10);
    expect(delays[delays.length - 1]).toBe(ANIM.holdMs / 10);
    expect(delays[1]).toBe(Math.round(100 / ANIM.fps));
  });
});
