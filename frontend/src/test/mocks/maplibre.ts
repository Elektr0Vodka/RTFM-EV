import { vi } from 'vitest';

// Reusable maplibre-gl stub for component tests. jsdom has no WebGL, so tests
// that render a map surface mock the module with `vi.mock('maplibre-gl', () =>
// mockMaplibreModule())` and drive behaviour through `__stub`.

export function makeMapStub() {
  const handlers: Record<string, ((e?: unknown) => void)[]> = {};
  const sources = new Map<
    string,
    { setData: ReturnType<typeof vi.fn>; setTiles: ReturnType<typeof vi.fn> }
  >();
  return {
    on: vi.fn((ev: string, ...rest: unknown[]) => {
      const cb = rest[rest.length - 1] as (e?: unknown) => void;
      (handlers[ev] ||= []).push(cb);
    }),
    once: vi.fn((ev: string, cb: () => void) => {
      (handlers[ev] ||= []).push(cb);
    }),
    off: vi.fn(),
    fire: (ev: string, e?: unknown) => (handlers[ev] || []).forEach((cb) => cb(e)),
    addControl: vi.fn(),
    removeControl: vi.fn(),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn(), setTiles: vi.fn() })),
    getSource: vi.fn((id: string) => sources.get(id)),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    getLayer: vi.fn(() => undefined),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    setStyle: vi.fn(),
    getStyle: vi.fn(() => ({ layers: [] })),
    setMaxPitch: vi.fn(),
    getPitch: vi.fn(() => 0),
    easeTo: vi.fn(),
    flyTo: vi.fn(),
    fitBounds: vi.fn(),
    setCenter: vi.fn(),
    setZoom: vi.fn(),
    getZoom: vi.fn(() => 8),
    getContainer: vi.fn(() => document.createElement('div')),
    getCanvas: vi.fn(() => document.createElement('canvas')),
    project: vi.fn(() => ({ x: 0, y: 0 })),
    resize: vi.fn(),
    remove: vi.fn(),
    dragRotate: { disable: vi.fn(), enable: vi.fn() },
    touchZoomRotate: { disableRotation: vi.fn(), enableRotation: vi.fn() },
    touchPitch: { disable: vi.fn(), enable: vi.fn() },
    keyboard: { disableRotation: vi.fn(), enableRotation: vi.fn() },
  };
}

export function mockMaplibreModule() {
  const stub = makeMapStub();
  const Popup = vi.fn(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    setDOMContent: vi.fn().mockReturnThis(),
    setHTML: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }));
  const NavigationControl = vi.fn();
  const Marker = vi.fn(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    getLngLat: vi.fn(() => ({ lng: 0, lat: 0 })),
    on: vi.fn().mockReturnThis(),
    setDraggable: vi.fn().mockReturnThis(),
  }));
  return {
    default: { Map: vi.fn(() => stub), Popup, NavigationControl, Marker },
    Map: vi.fn(() => stub),
    Popup,
    NavigationControl,
    Marker,
    __stub: stub,
  };
}
