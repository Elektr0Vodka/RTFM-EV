// The coverage map's MapLibre glue against a fake map. MapLibre does not run
// in jsdom.
import { act, render } from '@testing-library/react';
import { createRef, useEffect } from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

interface FakeMap {
  sources: Map<string, { setData: Mock }>;
  layers: Map<string, { id: string; paint?: Record<string, unknown> }>;
  visibility: Map<string, string>;
  setPaintProperty: Mock;
  fitBounds: Mock;
  flyTo: Mock;
  zoomIn: Mock;
  resetNorthPitch: Mock;
  fire(key: string, e?: unknown): void;
  [k: string]: unknown;
}

function fakeMap(): FakeMap {
  const sources = new Map<string, { setData: Mock }>();
  const layers = new Map<string, { id: string }>();
  const visibility = new Map<string, string>();
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  return {
    sources,
    layers,
    visibility,
    addSource: vi.fn((id: string, spec?: { type?: string; url?: string }) =>
      sources.set(id, { setData: vi.fn(), updateImage: vi.fn(), spec } as never)
    ),
    getSource: (id: string) => sources.get(id),
    addLayer: vi.fn((spec: { id: string; layout?: { visibility?: string } }) => {
      layers.set(spec.id, spec);
      if (spec.layout?.visibility) visibility.set(spec.id, spec.layout.visibility);
    }),
    getLayer: (id: string) => layers.get(id),
    setLayoutProperty: vi.fn((id: string, key: string, v: string) => {
      if (key === 'visibility') visibility.set(id, v);
    }),
    setPaintProperty: vi.fn(),
    setTerrain: vi.fn(),
    setSky: vi.fn(),
    easeTo: vi.fn(),
    jumpTo: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetNorthPitch: vi.fn(),
    resetNorth: vi.fn(),
    getZoom: () => 12.5,
    getPitch: () => 0,
    getBearing: () => 0,
    getCenter: () => ({ lat: 52.5, lng: 6 }),
    getBounds: () => ({
      getWest: () => 5,
      getSouth: () => 52,
      getEast: () => 7,
      getNorth: () => 53,
    }),
    getContainer: () => ({ clientHeight: 900, querySelector: () => null }),
    queryRenderedFeatures: () => [],
    on: vi.fn((ev: string, a: unknown, b?: unknown) => {
      const fn = (b ?? a) as (e: unknown) => void;
      const key = b ? `${ev}:${String(a)}` : ev;
      (handlers[key] ??= []).push(fn);
    }),
    once: vi.fn(),
    fire(key: string, e: unknown = {}) {
      for (const fn of handlers[key] ?? []) fn(e);
    },
  };
}

let map: FakeMap;
let surface: { onBasemapReapply?: () => void } = {};
vi.mock('../../../map/MapSurface', () => ({
  MapSurface: (props: { onReady: (m: unknown) => void; onBasemapReapply?: () => void }) => {
    surface = props;
    useEffect(() => props.onReady(map), [props]);
    return <div data-testid="surface" />;
  },
}));
vi.mock('../../../map/engine/buildings3D', () => ({ setBuildings3D: () => Promise.resolve() }));
vi.mock('../../../map/engine/mapLock2D', () => ({ setMapLock2D: () => {} }));

import {
  CoverageMapGL,
  type CoverageMapGLProps,
  type CoverageMapHandle,
} from '../../../wardrive/coverage/CoverageMapGL';
import type { MapCell } from '../../../wardrive/coverage/types';
import { point } from './fixtures';

const CELL: MapCell = {
  cell: '9:1:2',
  best: -72,
  count: 4,
  drivers: 2,
  ring: [
    [5, 52],
    [5.1, 52],
    [5.1, 52.1],
    [5, 52],
  ],
};

function props(over: Partial<CoverageMapGLProps> = {}): CoverageMapGLProps {
  return {
    points: [point(), point({ lat: 52.2, hash: '01' })],
    cells: { a: [], b: [CELL], resA: 10, resB: 9 },
    mode: 'hex',
    view3d: false,
    exaggeration: 7,
    selected: null,
    pin: null,
    fit: null,
    focus: null,
    initial: null,
    onView: vi.fn(),
    onPickPoint: vi.fn(),
    onPickCell: vi.fn(),
    onEmpty: vi.fn(),
    ...over,
  };
}

const flush = () => act(async () => {});

beforeEach(() => {
  map = fakeMap();
  surface = {};
});

describe('coverage map glue', () => {
  it('adds its layers and pushes the data on ready', async () => {
    render(<CoverageMapGL {...props()} />);
    await flush();
    for (const id of ['cov-hex-a', 'cov-hex-b', 'cov-hex-a-3d', 'cov-points', 'cov-pillars']) {
      expect(map.layers.has(id)).toBe(true);
    }
    const pushed = map.sources.get('cov-hex-b')!.setData.mock.calls.slice(-1)[0]![0];
    expect(pushed.features).toHaveLength(1);
    expect(
      map.sources.get('cov-points')!.setData.mock.calls.slice(-1)[0]![0].features
    ).toHaveLength(2);
  });

  it('shows the layers of the mode', async () => {
    const r = render(<CoverageMapGL {...props({ mode: 'hex' })} />);
    await flush();
    expect(map.visibility.get('cov-points')).toBe('none');
    expect(map.visibility.get('cov-hex-a')).toBe('visible');
    expect(map.visibility.get('cov-hex-a-3d')).toBe('none');
    r.rerender(<CoverageMapGL {...props({ mode: 'points' })} />);
    await flush();
    expect(map.visibility.get('cov-points')).toBe('visible');
    expect(map.visibility.get('cov-hex-a')).toBe('none');
    r.rerender(<CoverageMapGL {...props({ mode: 'auto', view3d: true })} />);
    await flush();
    expect(map.visibility.get('cov-hex-a')).toBe('none');
    expect(map.visibility.get('cov-hex-a-3d')).toBe('visible');
    expect(map.visibility.get('cov-pillars')).toBe('visible');
    expect(map.visibility.get('cov-points')).toBe('none');
  });

  it('fades the points by zoom in Auto', async () => {
    render(<CoverageMapGL {...props({ mode: 'auto' })} />);
    await flush();
    const call = map.setPaintProperty.mock.calls.find(
      (c) => c[0] === 'cov-points' && c[1] === 'circle-opacity'
    );
    expect((call?.[2] as unknown[])[0]).toBe('interpolate');
  });

  it('reports a tapped point by its index and a tapped cell by its slot', async () => {
    const p = props();
    render(<CoverageMapGL {...p} />);
    await flush();
    map.fire('click:cov-points', { features: [{ properties: { i: 1 } }] });
    expect(p.onPickPoint).toHaveBeenCalledWith(1);
    map.fire('click:cov-hex-b', { features: [{ properties: { i: 0 } }] });
    expect(p.onPickCell).toHaveBeenCalledWith(CELL);
  });

  it('reports the view after a move', async () => {
    const p = props();
    render(<CoverageMapGL {...p} />);
    await flush();
    map.fire('moveend');
    expect(p.onView).toHaveBeenLastCalledWith({
      bbox: [52, 5, 53, 7],
      z: 12.5,
      lat: 52.5,
      lon: 6,
      pitch: 0,
      bearing: 0,
    });
  });

  it('fits and flies on a new nonce', async () => {
    const r = render(<CoverageMapGL {...props()} />);
    await flush();
    r.rerender(
      <CoverageMapGL
        {...props({
          fit: {
            bounds: [
              [5, 52],
              [6, 53],
            ],
            nonce: 1,
          },
        })}
      />
    );
    await flush();
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    r.rerender(<CoverageMapGL {...props({ focus: { lat: 52, lon: 5, nonce: 2 } })} />);
    await flush();
    expect(map.flyTo).toHaveBeenCalledTimes(1);
  });

  it('drives the camera from the rail through its handle', async () => {
    const ref = createRef<CoverageMapHandle>();
    render(<CoverageMapGL {...props()} ref={ref} />);
    await flush();
    ref.current!.zoomIn();
    ref.current!.north();
    expect(map.zoomIn).toHaveBeenCalled();
    expect(map.resetNorth).toHaveBeenCalled();
  });

  it('adds everything again after a basemap switch', async () => {
    render(<CoverageMapGL {...props()} />);
    await flush();
    map.sources.clear();
    map.layers.clear();
    act(() => surface.onBasemapReapply?.());
    await flush();
    expect(map.layers.has('cov-points')).toBe(true);
    expect(map.sources.get('cov-points')!.setData).toHaveBeenCalled();
  });

  it('draws the node positions and the reach, and reports a tapped node', async () => {
    const node = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [5, 52] },
          properties: { id: 'ab', label: 'Mast', color: '#fff', op: 1 },
        },
      ],
    };
    const empty = { type: 'FeatureCollection' as const, features: [] };
    const reach = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [5, 52],
              [5.1, 52.1],
            ],
          },
          properties: { id: 'ab', color: '#fff', op: 0.5, w: 2 },
        },
      ],
    };
    const p = props({
      overlays: {
        nodes: { advertised: node, estimates: empty, drift: empty, circles: empty, hubs: empty },
        reach,
        locate: null,
      },
      onPickNode: vi.fn(),
    });
    render(<CoverageMapGL {...p} />);
    await flush();
    expect(map.sources.get('cov-node-adv')!.setData.mock.calls.slice(-1)[0][0]).toBe(node);
    expect(map.sources.get('cov-reach')!.setData.mock.calls.slice(-1)[0][0]).toBe(reach);
    expect(map.visibility.get('cov-reach')).toBe('visible');
    map.fire('click:cov-node-adv', { features: [{ properties: { id: 'ab' } }] });
    expect(p.onPickNode).toHaveBeenCalledWith('ab');
  });

  it('shows only Locate in its focus view, with the heat image', async () => {
    const empty = { type: 'FeatureCollection' as const, features: [] };
    const heat = {
      url: 'data:image/png;base64,AAAA',
      coordinates: [
        [5, 53],
        [6, 53],
        [6, 52],
        [5, 52],
      ] as [number, number][],
    };
    const r = render(
      <CoverageMapGL
        {...props({
          mode: 'points',
          overlays: {
            nodes: null,
            reach: null,
            locate: { inliers: empty, outliers: empty, centroid: empty, strongest: empty, heat },
          },
        })}
      />
    );
    await flush();
    expect(map.visibility.get('cov-points')).toBe('none');
    expect(map.visibility.get('cov-hex-a')).toBe('none');
    expect(map.visibility.get('cov-locate-in')).toBe('visible');
    expect(map.visibility.get('cov-heat')).toBe('visible');
    expect((map.sources.get('cov-heat') as unknown as { spec: { url: string } }).spec.url).toBe(
      heat.url
    );
    r.rerender(<CoverageMapGL {...props({ mode: 'points' })} />);
    await flush();
    expect(map.visibility.get('cov-locate-in')).toBe('none');
    expect(map.visibility.get('cov-heat')).toBe('none');
    expect(map.visibility.get('cov-points')).toBe('visible');
  });
});
