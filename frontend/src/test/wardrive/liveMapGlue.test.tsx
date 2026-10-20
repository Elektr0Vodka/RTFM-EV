// The live map's MapLibre glue against a fake map: what reaches the map, and
// when. MapLibre itself does not run in jsdom.
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

interface FakeMap {
  sources: Map<string, { setData: Mock }>;
  layers: Map<string, unknown>;
  easeTo: Mock;
  setTerrain: Mock;
  setSky: Mock;
  setLayoutProperty: Mock;
  isStyleLoaded: Mock;
  fire(key: string, e?: unknown): void;
  [k: string]: unknown;
}

function fakeMap(): FakeMap {
  const sources = new Map<string, { setData: Mock }>();
  const layers = new Map<string, unknown>();
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  return {
    sources,
    layers,
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    getSource: (id: string) => sources.get(id),
    addLayer: vi.fn((spec: { id: string }) => layers.set(spec.id, spec)),
    getLayer: (id: string) => layers.get(id),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    setTerrain: vi.fn(),
    setSky: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    easeTo: vi.fn(),
    getZoom: () => 15,
    getPitch: () => 0,
    getBounds: () => ({
      getWest: () => 5,
      getSouth: () => 52,
      getEast: () => 7,
      getNorth: () => 53,
    }),
    getContainer: () => ({ clientHeight: 900 }),
    on: vi.fn((ev: string, a: unknown, b?: unknown) => {
      const fn = (b ?? a) as (e: unknown) => void;
      const key = b ? `${ev}:${String(a)}` : ev;
      (handlers[key] ??= []).push(fn);
    }),
    fire(key: string, e: unknown = {}) {
      for (const fn of handlers[key] ?? []) fn(e);
    },
  };
}

let map: FakeMap;
vi.mock('../../map/MapSurface', () => ({
  MapSurface: ({ onReady }: { onReady: (m: unknown) => void }) => {
    useEffect(() => onReady(map), [onReady]);
    return <div data-testid="surface" />;
  },
}));
vi.mock('../../map/engine/buildings3D', () => ({ setBuildings3D: () => Promise.resolve() }));
vi.mock('../../map/engine/mapLock2D', () => ({ setMapLock2D: () => {} }));

import { LiveMap, type LiveMapProps } from '../../wardrive/map/LiveMap';
import { VIEW_STATES } from '../../wardrive/map/viewModes';
import type { ViewEntry } from '../../wardrive/useReceptionView';

const entry = (id: number, lat = 52.5): ViewEntry =>
  ({
    id,
    at: Date.now() - 1000,
    rssi: -90,
    snr: 5,
    lat,
    lon: 6,
    kept: true,
    sender: { kind: 'relay', id: 'a1b2', label: null, role: null },
    attr: null,
  }) as unknown as ViewEntry;

const fix = (lat: number) => ({ lat, lon: 6, accM: 5, at: Date.now() });

function props(over: Partial<LiveMapProps> = {}): LiveMapProps {
  return {
    entries: [entry(1)],
    selectedId: null,
    fix: fix(52.5),
    trail: [],
    view: VIEW_STATES[1],
    compass: 'north',
    heading: null,
    nodePos: 'off',
    nodes: [],
    exaggeration: 7,
    onUserPan: vi.fn(),
    onSelect: vi.fn(),
    ...over,
  };
}

function mount(p: LiveMapProps) {
  const r = render(<LiveMap {...p} />);
  return { rerender: (q: LiveMapProps) => r.rerender(<LiveMap {...q} />) };
}

const flush = () => act(async () => {});

beforeEach(() => {
  map = fakeMap();
});

describe('live map glue', () => {
  it('uploads only the sources whose data changed', async () => {
    const p = props();
    const { rerender } = mount(p);
    await flush();
    for (const s of map.sources.values()) s.setData.mockClear();
    rerender({ ...p, fix: fix(52.501) });
    await flush();
    expect(map.sources.get('wd-me')!.setData).toHaveBeenCalled();
    expect(map.sources.get('wd-hex')!.setData).not.toHaveBeenCalled();
    expect(map.sources.get('wd-live-points')!.setData).not.toHaveBeenCalled();
  });

  it('does not move the camera on a compass reading while north up', async () => {
    const p = props({ compass: 'north', heading: 10 });
    const { rerender } = mount(p);
    await flush();
    const calls = map.easeTo.mock.calls.length;
    rerender({ ...p, heading: 20 });
    rerender({ ...p, heading: 30 });
    await flush();
    expect(map.easeTo.mock.calls.length).toBe(calls);
  });

  it('turns the map to the heading in heading mode', async () => {
    mount(props({ compass: 'heading', heading: 90 }));
    await flush();
    const last = map.easeTo.mock.calls[map.easeTo.mock.calls.length - 1][0];
    expect(last.bearing).toBe(90);
    expect(last.padding.top).toBe(300);
  });

  it('leaves a pinch or drag alone while it runs', async () => {
    const p = props();
    const { rerender } = mount(p);
    await flush();
    map.fire('zoomstart', { originalEvent: {} });
    const calls = map.easeTo.mock.calls.length;
    rerender({ ...p, fix: fix(52.502) });
    await flush();
    expect(map.easeTo.mock.calls.length).toBe(calls);
    map.fire('zoomend', { originalEvent: {} });
    rerender({ ...p, fix: fix(52.503) });
    await flush();
    expect(map.easeTo.mock.calls.length).toBe(calls + 1);
  });

  it('keeps easing to the 3D pitch while following', async () => {
    const p = props({ view: VIEW_STATES[0] });
    const { rerender } = mount(p);
    await flush();
    rerender({ ...p, view: VIEW_STATES[4] });
    await flush();
    rerender({ ...p, view: VIEW_STATES[4], fix: fix(52.504) });
    await flush();
    // The map has not reached 60 yet (getPitch says 0): the follow ease carries it.
    expect(map.easeTo.mock.calls[map.easeTo.mock.calls.length - 1][0].pitch).toBe(60);
  });

  it('raises the terrain once the hillshade has its elevation tiles', async () => {
    mount(props({ view: VIEW_STATES[2] }));
    await flush();
    expect(map.setTerrain).toHaveBeenLastCalledWith(null);
    map.fire('data', {
      sourceId: 'wd-dem-shade',
      isSourceLoaded: true,
      sourceDataType: 'metadata',
    });
    await flush();
    expect(map.setTerrain).toHaveBeenLastCalledWith(null);
    map.fire('data', { sourceId: 'wd-dem-shade', isSourceLoaded: true, tile: {} });
    await flush();
    expect(map.setTerrain).toHaveBeenLastCalledWith({ source: 'wd-dem', exaggeration: 7 });
  });

  it('survives terrain and sky calls while a style is loading', async () => {
    // MapLibre throws "Style is not done loading" from these during a setStyle.
    const loading = () => {
      throw new Error('Style is not done loading');
    };
    map.setTerrain.mockImplementation(loading);
    map.setSky.mockImplementation(loading);
    map.setPaintProperty = vi.fn(loading);
    // A busy map (tiles loading) must not hold the terrain back.
    map.isStyleLoaded.mockReturnValue(false);
    mount(props({ view: VIEW_STATES[2] }));
    await flush();
    expect(screen.getByTestId('surface')).toBeTruthy();
    expect(map.setTerrain).toHaveBeenCalled();
  });

  it('picks a reception by tapping its pillar and keeps the ring in 3D', async () => {
    const p = props({ view: VIEW_STATES[3] });
    mount(p);
    await flush();
    map.fire('click:wd-pillars', { features: [{ properties: { id: 1 } }] });
    expect(p.onSelect).toHaveBeenCalledWith(1);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('wd-live-selected', 'visibility', 'visible');
  });

  it('shows the noise floor readings only when switched on', async () => {
    const readings = [{ lat: 52.5, lon: 6, noise: -110, at: Date.now() }];
    const p = props({ noiseReadings: readings, noiseOn: false });
    const { rerender } = mount(p);
    await flush();
    expect(map.layers.has('wd-noise')).toBe(true);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('wd-noise', 'visibility', 'none');
    rerender({ ...p, noiseOn: true });
    await flush();
    expect(map.setLayoutProperty).toHaveBeenLastCalledWith('wd-noise', 'visibility', 'visible');
    const calls = map.sources.get('wd-noise')!.setData.mock.calls;
    const data = calls[calls.length - 1][0];
    expect(data.features).toHaveLength(1);
  });

  it('drops the look-ahead padding once heading mode is left', async () => {
    const p = props({ compass: 'heading', heading: 90 });
    const { rerender } = mount(p);
    await flush();
    const last = () => map.easeTo.mock.calls[map.easeTo.mock.calls.length - 1][0];
    expect(last().padding.top).toBe(300);
    rerender({ ...p, compass: 'static', entries: [entry(1), entry(2, 52.6)], selectedId: 2 });
    await flush();
    expect(last().center).toEqual([6, 52.6]);
    expect(last().padding).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it('does not pick a backlog point below the zoom it shows at', async () => {
    const p = props();
    mount(p);
    await flush();
    map.getZoom = () => 10;
    map.fire('click:wd-live-points', { features: [{ properties: { id: 1, backlog: true } }] });
    expect(p.onSelect).not.toHaveBeenCalled();
    map.fire('click:wd-live-points', {
      features: [
        { properties: { id: 1, backlog: true } },
        { properties: { id: 2, backlog: false } },
      ],
    });
    expect(p.onSelect).toHaveBeenCalledWith(2);
    map.getZoom = () => 13;
    map.fire('click:wd-live-points', { features: [{ properties: { id: 1, backlog: true } }] });
    expect(p.onSelect).toHaveBeenLastCalledWith(1);
  });

  it('follows with the position in the map left between the top bar and the HUD', async () => {
    mount(props({ compass: 'north', insets: { top: 120, bottom: 480 } }));
    await flush();
    const last = map.easeTo.mock.calls[map.easeTo.mock.calls.length - 1][0];
    expect(last.padding).toEqual({ top: 120, bottom: 480, left: 0, right: 0 });
  });

  it('starts with the map credits folded', async () => {
    const attrib = { classList: { remove: vi.fn() } };
    map.getContainer = () => ({
      clientHeight: 900,
      querySelector: (sel: string) => (sel === '.maplibregl-ctrl-attrib' ? attrib : null),
    });
    mount(props());
    await flush();
    expect(attrib.classList.remove).toHaveBeenCalledWith('maplibregl-compact-show');
  });
});
