import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', async () => {
  const { mockMaplibreModule } = await import('../mocks/maplibre');
  return mockMaplibreModule();
});

import * as maplibre from 'maplibre-gl';
import { BasemapLoadError, captureBasemap } from '../../share/basemapCapture';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapMock = maplibre.Map as unknown as ReturnType<typeof vi.fn>;
const stub = (maplibre as any).__stub as {
  fire: (ev: string) => void;
  fitBounds: ReturnType<typeof vi.fn>;
  jumpTo: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getZoom: ReturnType<typeof vi.fn>;
  getCenter?: ReturnType<typeof vi.fn>;
};

const drawImage = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('remoteterm-map-layer', 'light');
  stub.getCenter = vi.fn(() => ({ lat: 52.25, lng: 5.25 }));
  stub.getZoom.mockReturnValue(9);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('captureBasemap', () => {
  it('creates the off-screen map with the saved basemap and no interaction', async () => {
    const p = captureBasemap(
      [
        { lat: 52, lon: 5 },
        { lat: 52.5, lon: 5.5 },
      ],
      { w: 690, h: 630 },
      40
    );
    const opts = mapMock.mock.calls[0][0] as Record<string, any>;
    expect(opts.interactive).toBe(false);
    expect(opts.attributionControl).toBe(false);
    expect(opts.canvasContextAttributes).toEqual(
      expect.objectContaining({ preserveDrawingBuffer: true })
    );
    stub.fire('load');
    stub.fire('idle');
    const cap = await p;
    expect(stub.fitBounds).toHaveBeenCalled();
    expect(cap.credit).toContain('OpenStreetMap');
    expect(cap.credit).not.toContain('<');
    expect(cap.image.width).toBe(690);
    expect(cap.image.height).toBe(630);
    expect(drawImage).toHaveBeenCalled();
  });

  it('centres a single point instead of fitting bounds', async () => {
    const p = captureBasemap([{ lat: 52, lon: 5 }], { w: 100, h: 100 }, 10);
    stub.fire('load');
    stub.fire('idle');
    await p;
    expect(stub.jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [5, 52], zoom: 11 })
    );
  });

  it('returns a projector that still works after the map is removed', async () => {
    const p = captureBasemap([{ lat: 52, lon: 5 }], { w: 200, h: 100 }, 10);
    stub.fire('load');
    stub.fire('idle');
    const cap = await p;
    expect(stub.remove).toHaveBeenCalled();
    const c = cap.project({ lat: 52.25, lon: 5.25 });
    expect(c.x).toBeCloseTo(100);
    expect(c.y).toBeCloseTo(50);
  });

  it('rejects with BasemapLoadError when the map never becomes idle', async () => {
    vi.useFakeTimers();
    const p = captureBasemap([{ lat: 52, lon: 5 }], { w: 100, h: 100 }, 10, 500);
    const assertion = expect(p).rejects.toBeInstanceOf(BasemapLoadError);
    vi.advanceTimersByTime(501);
    await assertion;
    expect(stub.remove).toHaveBeenCalled();
  });

  it('rejects with BasemapLoadError on a map error before idle', async () => {
    const p = captureBasemap([{ lat: 52, lon: 5 }], { w: 100, h: 100 }, 10);
    stub.fire('error');
    await expect(p).rejects.toBeInstanceOf(BasemapLoadError);
  });

  it('rejects with BasemapLoadError and cleans up when the map cannot be created', async () => {
    const before = document.body.children.length;
    mapMock.mockImplementationOnce(function () {
      throw new Error('Failed to initialize WebGL');
    });
    await expect(
      captureBasemap([{ lat: 52, lon: 5 }], { w: 100, h: 100 }, 10)
    ).rejects.toBeInstanceOf(BasemapLoadError);
    expect(document.body.children.length).toBe(before);
  });

  it('ignores a single failed tile and still captures', async () => {
    const p = captureBasemap([{ lat: 52, lon: 5 }], { w: 100, h: 100 }, 10);
    (stub as unknown as { fire: (ev: string, e?: unknown) => void }).fire('error', {
      sourceId: 'openmaptiles',
      tile: {},
      error: new Error('404'),
    });
    stub.fire('load');
    stub.fire('idle');
    await expect(p).resolves.toMatchObject({ credit: expect.any(String) });
  });

  it('removes its container whether it succeeds or fails', async () => {
    const before = document.body.children.length;
    const ok = captureBasemap([{ lat: 52, lon: 5 }], { w: 100, h: 100 }, 10);
    expect(document.body.children.length).toBe(before + 1);
    stub.fire('load');
    stub.fire('idle');
    await ok;
    await flush();
    expect(document.body.children.length).toBe(before);
    const bad = captureBasemap([{ lat: 52, lon: 5 }], { w: 100, h: 100 }, 10);
    stub.fire('error');
    await expect(bad).rejects.toBeInstanceOf(BasemapLoadError);
    expect(document.body.children.length).toBe(before);
  });
});
