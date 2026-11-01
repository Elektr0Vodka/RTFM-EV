// The coverage map's MapLibre glue, on the app's MapSurface (saved basemap,
// theme tone, 3D buildings) without its own buttons: the coverage map has
// its own rail. Two cell sizes (slots a and b) blend by zoom, receptions are
// points (pillars in 3D), the picked reception has a ring, a picked driver a
// pin, drivers on the road now a ring with their name. In 3D: terrain,
// hillshade and the sky, as on the drive screen.
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';

import { useCvdMode } from '../../hooks/useCvdColors';
import { MapSurface } from '../../map/MapSurface';
import { setBuildings3D } from '../../map/engine/buildings3D';
import { setMapLock2D } from '../../map/engine/mapLock2D';
import { NODE_LABEL_FONT } from '../../map/layers/nodesLayer';
import { currentHour, skyFor } from '../map/sky';
import {
  DEM_ATTRIBUTION,
  DEM_ENCODING,
  DEM_MAX_ZOOM,
  DEM_SHADE_SOURCE_ID,
  DEM_SOURCE_ID,
  DEM_TILES,
  hillshadeFor,
  isDemTileError,
  terrainPlan,
} from '../map/terrain';
import { PITCH_3D, pitchTransition } from '../map/viewModes';
import { cellFeatures, pillarFeatures, pinFeature, pointFeatures, ringFeature } from './features';
import type { NodeLayer } from './nodePositions';
import type { LayerMode } from './state';
import type { MapCell, MapPoint } from './types';
import { barOpacityExpr, cellOpacityExpr, pointOpacityExpr, POINT_STEP_3D } from './zoomFade';

export interface CoverageView {
  /** south, west, north, east */
  bbox: [number, number, number, number];
  z: number;
  lat: number;
  lon: number;
  pitch: number;
  bearing: number;
}

export interface CoverageCells {
  a: MapCell[];
  b: MapCell[];
  resA: number | null;
  resB: number | null;
}

export interface CoverageMapHandle {
  zoomIn(): void;
  zoomOut(): void;
  north(): void;
}

export interface LocateLayer {
  inliers: FeatureCollection<Point>;
  outliers: FeatureCollection<Point>;
  centroid: FeatureCollection<Point>;
  strongest: FeatureCollection<Point>;
  heat: { url: string; coordinates: [number, number][] } | null;
}

/** What the node positions stops and Locate draw over the coverage. */
export interface CoverageOverlays {
  nodes: (NodeLayer & { hubs: FeatureCollection<Point> }) | null;
  reach: FeatureCollection<LineString> | null;
  /** Locate's focus view: everything else is hidden while it is set. */
  locate: LocateLayer | null;
}

const NO_OVERLAYS: CoverageOverlays = { nodes: null, reach: null, locate: null };

export interface CoverageMapGLProps {
  points: MapPoint[];
  cells: CoverageCells;
  mode: LayerMode;
  view3d: boolean;
  exaggeration: number;
  selected: MapPoint | null;
  pin: { lat: number; lon: number; label: string } | null;
  live?: { lat: number; lon: number; label: string }[];
  fit: { bounds: [[number, number], [number, number]]; nonce: number } | null;
  focus: { lat: number; lon: number; nonce: number } | null;
  initial: { lat: number; lon: number; z: number; pitch: number; bearing: number } | null;
  onView(v: CoverageView): void;
  onPickPoint(i: number): void;
  onPickCell(cell: MapCell): void;
  onEmpty(): void;
  overlays?: CoverageOverlays;
  /** Opacity of each point (a reach selection dims the rest). */
  pointOpacity?: (p: MapPoint, i: number) => number;
  /** Opacity factor of every cell (a reach selection dims them all). */
  cellOpacity?: number;
  onPickNode?(id: string): void;
  ref?: Ref<CoverageMapHandle>;
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] };
const NL_CENTER: [number, number] = [5.3, 52.1];
const SKY_REFRESH_MS = 10 * 60 * 1000;
const LIVE_COLOR = '#22c55e';
const NO_LIVE: { lat: number; lon: number; label: string }[] = [];
const PICKABLE = [
  'cov-node-adv',
  'cov-node-est',
  'cov-node-hub',
  'cov-points',
  'cov-pillars',
  'cov-hex-a',
  'cov-hex-b',
  'cov-hex-a-3d',
  'cov-hex-b-3d',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMap = any;

function setVisible(m: AnyMap, id: string, on: boolean) {
  if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

export function CoverageMapGL({
  points,
  cells,
  mode,
  view3d,
  exaggeration,
  selected,
  pin,
  live = NO_LIVE,
  fit,
  focus,
  initial,
  onView,
  onPickPoint,
  onPickCell,
  onEmpty,
  overlays = NO_OVERLAYS,
  pointOpacity,
  cellOpacity = 1,
  onPickNode,
  ref,
}: CoverageMapGLProps) {
  const mapRef = useRef<MlMap | null>(null);
  const toneRef = useRef<'light' | 'dark'>('dark');
  const [ready, setReady] = useState(false);
  const [styleGen, setStyleGen] = useState(0);
  const [demReady, setDemReady] = useState(false);
  const cvd = useCvdMode() !== 'off';

  const data = useMemo(
    () => ({
      'cov-hex-a': cellFeatures(cells.a, cvd, cellOpacity),
      'cov-hex-b': cellFeatures(cells.b, cvd, cellOpacity),
      'cov-points': pointFeatures(points, cvd, pointOpacity),
      'cov-node-adv': overlays.nodes?.advertised ?? EMPTY,
      'cov-node-est': overlays.nodes?.estimates ?? EMPTY,
      'cov-node-drift': overlays.nodes?.drift ?? EMPTY,
      'cov-node-circle': overlays.nodes?.circles ?? EMPTY,
      'cov-node-hub': overlays.nodes?.hubs ?? EMPTY,
      'cov-reach': overlays.reach ?? EMPTY,
      'cov-locate-in': overlays.locate?.inliers ?? EMPTY,
      'cov-locate-out': overlays.locate?.outliers ?? EMPTY,
      'cov-locate-centroid': overlays.locate?.centroid ?? EMPTY,
      'cov-locate-strongest': overlays.locate?.strongest ?? EMPTY,
      'cov-pillars': view3d ? pillarFeatures(points, cvd) : EMPTY,
      'cov-selected': ringFeature(selected),
      'cov-pin': pin ? pinFeature(pin.lat, pin.lon, pin.label) : EMPTY,
      'cov-live': {
        type: 'FeatureCollection' as const,
        features: live.map((d) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [d.lon, d.lat] },
          properties: { label: d.label },
        })),
      },
    }),
    [
      cells.a,
      cells.b,
      cvd,
      points,
      view3d,
      selected,
      pin,
      live,
      overlays,
      pointOpacity,
      cellOpacity,
    ]
  );
  const dataRef = useRef(data);
  dataRef.current = data;
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const handlers = useRef({ onView, onPickPoint, onPickCell, onEmpty, onPickNode });
  handlers.current = { onView, onPickPoint, onPickCell, onEmpty, onPickNode };
  const heatRef = useRef(overlays.locate?.heat ?? null);
  heatRef.current = overlays.locate?.heat ?? null;

  const pushedRef = useRef(new Map<string, unknown>());
  const pushData = useCallback((map: MlMap) => {
    const m = map as AnyMap;
    for (const [id, fc] of Object.entries(dataRef.current)) {
      if (pushedRef.current.get(id) === fc) continue;
      const source = m.getSource(id);
      if (!source) continue;
      source.setData(fc);
      pushedRef.current.set(id, fc);
    }
  }, []);

  const ensureLayers = useCallback(
    (map: MlMap) => {
      const m = map as AnyMap;
      const add = (spec: Record<string, unknown>) => {
        if (!m.getLayer(spec.id)) m.addLayer(spec);
      };
      for (const id of [DEM_SHADE_SOURCE_ID, DEM_SOURCE_ID]) {
        if (!m.getSource(id)) {
          m.addSource(id, {
            type: 'raster-dem',
            tiles: [DEM_TILES],
            tileSize: 256,
            encoding: DEM_ENCODING,
            maxzoom: DEM_MAX_ZOOM,
            ...(id === DEM_SHADE_SOURCE_ID ? { attribution: DEM_ATTRIBUTION } : {}),
          });
        }
      }
      add({
        id: 'cov-hillshade',
        type: 'hillshade',
        source: DEM_SHADE_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.7 },
      });
      const heat = heatRef.current;
      if (heat && !m.getSource('cov-heat')) {
        m.addSource('cov-heat', { type: 'image', url: heat.url, coordinates: heat.coordinates });
      }
      if (m.getSource('cov-heat') && !m.getLayer('cov-heat')) {
        // Under every other layer of ours when it comes later (Locate's points stay on top).
        const below = ['cov-hex-a', 'cov-locate-out'].find((id) => m.getLayer(id));
        m.addLayer(
          { id: 'cov-heat', type: 'raster', source: 'cov-heat', paint: { 'raster-opacity': 1 } },
          below
        );
      }
      for (const id of Object.keys(dataRef.current)) {
        if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: EMPTY });
      }
      for (const slot of ['a', 'b']) {
        add({
          id: `cov-hex-${slot}`,
          type: 'fill',
          source: `cov-hex-${slot}`,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'op'],
            'fill-outline-color': ['get', 'color'],
          },
        });
        add({
          id: `cov-hex-${slot}-3d`,
          type: 'fill-extrusion',
          source: `cov-hex-${slot}`,
          layout: { visibility: 'none' },
          paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-opacity': 0.75,
          },
        });
      }
      add({
        id: 'cov-pillars',
        type: 'fill-extrusion',
        source: 'cov-pillars',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-opacity': 0.9,
        },
      });
      add({
        id: 'cov-reach',
        type: 'line',
        source: 'cov-reach',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'w'],
          'line-opacity': ['get', 'op'],
        },
      });
      add({
        id: 'cov-node-circle',
        type: 'line',
        source: 'cov-node-circle',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.5,
          'line-opacity': ['get', 'op'],
          'line-dasharray': [2, 2],
        },
      });
      add({
        id: 'cov-node-drift',
        type: 'line',
        source: 'cov-node-drift',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': ['get', 'op'],
          'line-dasharray': [1, 1.5],
        },
      });
      add({
        id: 'cov-points',
        type: 'circle',
        source: 'cov-points',
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'op'],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#000000',
          'circle-stroke-opacity': ['get', 'op'],
        },
      });
      add({
        id: 'cov-locate-out',
        type: 'circle',
        source: 'cov-locate-out',
        paint: { 'circle-radius': 4, 'circle-color': '#9ca3af', 'circle-opacity': 0.35 },
      });
      add({
        id: 'cov-locate-in',
        type: 'circle',
        source: 'cov-locate-in',
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.75,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#000000',
        },
      });
      add({
        id: 'cov-node-est',
        type: 'circle',
        source: 'cov-node-est',
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': ['get', 'op'],
        },
      });
      add({
        id: 'cov-node-hub',
        type: 'circle',
        source: 'cov-node-hub',
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'op'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      add({
        id: 'cov-node-adv',
        type: 'circle',
        source: 'cov-node-adv',
        paint: {
          'circle-radius': 7,
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'op'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': ['get', 'op'],
        },
      });
      add({
        id: 'cov-node-label',
        type: 'symbol',
        source: 'cov-node-adv',
        layout: {
          'text-field': ['get', 'label'],
          'text-font': NODE_LABEL_FONT,
          'text-size': 12,
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#111827',
          'text-halo-width': 1.5,
          'text-opacity': ['get', 'op'],
        },
      });
      add({
        id: 'cov-selected',
        type: 'circle',
        source: 'cov-selected',
        paint: {
          'circle-radius': 11,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });
      for (const id of ['cov-pin', 'cov-live']) {
        add({
          id,
          type: 'circle',
          source: id,
          paint: {
            'circle-radius': 9,
            'circle-color': '#ffffff',
            'circle-stroke-color': id === 'cov-live' ? LIVE_COLOR : '#2563eb',
            'circle-stroke-width': 4,
          },
        });
        add({
          id: `${id}-label`,
          type: 'symbol',
          source: id,
          layout: {
            'text-field': ['get', 'label'],
            'text-font': NODE_LABEL_FONT,
            'text-size': 13,
            'text-offset': [0, 1.4],
            'text-anchor': 'top',
          },
          paint: { 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 1.5 },
        });
      }
      add({
        id: 'cov-locate-centroid',
        type: 'circle',
        source: 'cov-locate-centroid',
        paint: {
          'circle-radius': 10,
          'circle-color': '#2563eb',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });
      add({
        id: 'cov-locate-strongest',
        type: 'circle',
        source: 'cov-locate-strongest',
        paint: {
          'circle-radius': 8,
          'circle-color': '#facc15',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#111827',
        },
      });
      pushedRef.current.clear();
      pushData(map);
    },
    [pushData]
  );

  const readView = useCallback((map: MlMap) => {
    const b = map.getBounds();
    const c = map.getCenter();
    handlers.current.onView({
      bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()],
      z: map.getZoom(),
      lat: c.lat,
      lon: c.lng,
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    });
  }, []);

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      ensureLayers(map);
      const m = map as AnyMap;
      m.on('click', 'cov-points', (e: MapLayerMouseEvent) => {
        const i = Number(e.features?.[0]?.properties?.i);
        if (Number.isFinite(i)) handlers.current.onPickPoint(i);
      });
      m.on('click', 'cov-pillars', (e: MapLayerMouseEvent) => {
        const i = Number(e.features?.[0]?.properties?.i);
        if (Number.isFinite(i)) handlers.current.onPickPoint(i);
      });
      for (const slot of ['a', 'b'] as const) {
        for (const id of [`cov-hex-${slot}`, `cov-hex-${slot}-3d`]) {
          m.on('click', id, (e: MapLayerMouseEvent) => {
            const i = Number(e.features?.[0]?.properties?.i);
            const cell = cellsRef.current[slot][i];
            if (cell) handlers.current.onPickCell(cell);
          });
        }
      }
      for (const id of ['cov-node-adv', 'cov-node-est', 'cov-node-hub']) {
        m.on('click', id, (e: MapLayerMouseEvent) => {
          const key = e.features?.[0]?.properties?.id;
          if (typeof key === 'string') handlers.current.onPickNode?.(key);
        });
      }
      m.on('click', (e: MapLayerMouseEvent) => {
        const layers = PICKABLE.filter((id) => m.getLayer(id));
        const hits = m.queryRenderedFeatures?.(e.point, { layers }) ?? [];
        if (hits.length === 0) handlers.current.onEmpty();
      });
      m.on('moveend', () => readView(map));
      m.on(
        'data',
        (e: { sourceId?: string; isSourceLoaded?: boolean; sourceDataType?: string }) => {
          if (
            e.sourceId === DEM_SHADE_SOURCE_ID &&
            e.isSourceLoaded &&
            e.sourceDataType !== 'metadata'
          ) {
            setDemReady(true);
          }
        }
      );
      m.on('error', (e: { sourceId?: string; tile?: unknown; error?: unknown }) => {
        if (!isDemTileError(e)) console.error(e.error);
      });
      // Compact credits open until the first drag; on a phone they cover the map.
      const fold = () =>
        m
          .getContainer()
          .querySelector?.('.maplibregl-ctrl-attrib')
          ?.classList.remove('maplibregl-compact-show');
      fold();
      m.once?.('idle', fold);
      if (initial) {
        m.jumpTo({
          center: [initial.lon, initial.lat],
          zoom: initial.z,
          pitch: initial.pitch,
          bearing: initial.bearing,
        });
      }
      readView(map);
      setReady(true);
    },
    // `initial` is read once, on the first ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureLayers, readView]
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => mapRef.current?.zoomIn(),
      zoomOut: () => mapRef.current?.zoomOut(),
      north: () => mapRef.current?.resetNorth(),
    }),
    []
  );

  useEffect(() => {
    if (ready && mapRef.current) pushData(mapRef.current);
  }, [ready, data, pushData]);

  // Which layers the mode draws, and the opacity ramps by zoom.
  useEffect(() => {
    const m = mapRef.current as AnyMap;
    if (!ready || !m) return;
    const focus = overlays.locate !== null;
    const hexOn = mode !== 'points' && !focus;
    const pointsOn = mode !== 'hex' && !focus;
    for (const id of [
      'cov-locate-in',
      'cov-locate-out',
      'cov-locate-centroid',
      'cov-locate-strongest',
    ]) {
      setVisible(m, id, focus);
    }
    setVisible(m, 'cov-heat', focus && !!overlays.locate?.heat);
    const nodesOn = !!overlays.nodes && !focus;
    for (const id of [
      'cov-node-adv',
      'cov-node-est',
      'cov-node-drift',
      'cov-node-circle',
      'cov-node-hub',
      'cov-node-label',
    ]) {
      setVisible(m, id, nodesOn);
    }
    setVisible(m, 'cov-reach', !!overlays.reach && !focus);
    setVisible(m, 'cov-selected', !focus);
    setVisible(m, 'cov-pin', !focus);
    setVisible(m, 'cov-pin-label', !focus);
    for (const slot of ['a', 'b'] as const) {
      const res = slot === 'a' ? cells.resA : cells.resB;
      setVisible(m, `cov-hex-${slot}`, hexOn && !view3d);
      setVisible(m, `cov-hex-${slot}-3d`, hexOn && view3d);
      if (res !== null && m.getLayer(`cov-hex-${slot}`)) {
        m.setPaintProperty(`cov-hex-${slot}`, 'fill-opacity', cellOpacityExpr(res, mode, view3d));
      }
      if (res !== null && m.getLayer(`cov-hex-${slot}-3d`)) {
        m.setPaintProperty(
          `cov-hex-${slot}-3d`,
          'fill-extrusion-opacity',
          barOpacityExpr(res, mode)
        );
      }
    }
    setVisible(m, 'cov-points', pointsOn && !view3d);
    setVisible(m, 'cov-pillars', pointsOn && view3d);
    if (m.getLayer('cov-points')) {
      const op = pointOpacityExpr(mode, view3d);
      m.setPaintProperty('cov-points', 'circle-opacity', op);
      m.setPaintProperty('cov-points', 'circle-stroke-opacity', op);
    }
    if (m.getLayer('cov-pillars')) {
      // In Auto the pillars stand up only from zoom 19.
      m.setPaintProperty(
        'cov-pillars',
        'fill-extrusion-opacity',
        mode === 'auto' ? ['step', ['zoom'], 0, POINT_STEP_3D, 0.9] : 0.9
      );
    }
  }, [ready, styleGen, mode, view3d, cells.resA, cells.resB, overlays]);

  // Locate's heat image: added once, then its picture replaced.
  const heat = overlays.locate?.heat ?? null;
  useEffect(() => {
    const m = mapRef.current as AnyMap;
    if (!ready || !m || !heat) return;
    const source = m.getSource('cov-heat');
    if (source) source.updateImage?.({ url: heat.url, coordinates: heat.coordinates });
    else ensureLayers(m);
    setVisible(m, 'cov-heat', true);
  }, [ready, heat, ensureLayers]);

  // 2D or 3D: lock, buildings, pitch (only when crossing between them).
  const was3D = useRef<boolean | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const before = was3D.current ?? (initial ? initial.pitch > 0 : false);
    const pitch = was3D.current === null && initial ? null : pitchTransition(before, view3d);
    was3D.current = view3d;
    setMapLock2D(map, !view3d);
    void setBuildings3D(map, view3d, toneRef.current).then(() => {
      if (pitch !== null) map.easeTo({ pitch: view3d ? PITCH_3D : 0, duration: 500 });
    });
    // `initial` only decides the first step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, view3d]);

  // Terrain, hillshade and sky in 3D.
  useEffect(() => {
    const m = mapRef.current as AnyMap;
    if (!ready || !m) return;
    const tryMap = (fn: () => void) => {
      try {
        fn();
      } catch {
        // "Style is not done loading" during a basemap switch; styleGen runs this again.
      }
    };
    const plan = terrainPlan({ mode3D: view3d, ready: demReady, exaggeration });
    tryMap(() => {
      setVisible(m, 'cov-hillshade', plan.hillshade);
      if (m.getLayer('cov-hillshade')) {
        m.setPaintProperty(
          'cov-hillshade',
          'hillshade-exaggeration',
          hillshadeFor(plan.exaggeration)
        );
      }
    });
    tryMap(() =>
      m.setTerrain(plan.mesh ? { source: DEM_SOURCE_ID, exaggeration: plan.exaggeration } : null)
    );
    if (!view3d) return;
    const paint = () => tryMap(() => m.setSky(skyFor(currentHour(), toneRef.current)));
    paint();
    const timer = setInterval(paint, SKY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [ready, styleGen, view3d, demReady, exaggeration]);

  useEffect(() => {
    if (ready && fit && mapRef.current) {
      mapRef.current.fitBounds(fit.bounds, { padding: 48, maxZoom: 15, duration: 600 });
    }
    // A new nonce fits again; the bounds alone do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fit?.nonce]);

  useEffect(() => {
    if (ready && focus && mapRef.current) {
      mapRef.current.flyTo({ center: [focus.lon, focus.lat], zoom: 15, duration: 800 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focus?.nonce]);

  return (
    <MapSurface
      fabs={{}}
      className="h-full w-full"
      initialCenter={initial ? [initial.lon, initial.lat] : NL_CENTER}
      initialZoom={initial ? initial.z : 7}
      onReady={handleReady}
      onBasemapReapply={() => {
        const map = mapRef.current;
        if (!map) return;
        ensureLayers(map);
        if (view3d) void setBuildings3D(map, true, toneRef.current);
        setDemReady(false);
        setStyleGen((n) => n + 1);
      }}
      onBasemapTone={(tone) => {
        toneRef.current = tone;
      }}
    />
  );
}
