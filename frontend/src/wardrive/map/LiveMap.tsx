// The wardrive screen's map: the app's MapSurface (saved basemap, theme tone,
// 3D buildings) filling the screen, without its own button stack (the screen
// has its own rail). Draws rx's map functions from the pure modules beside it:
// the view mode's layers (points, hexes with labels, 3D cells and pillars),
// rides (backlog faint), the trail, the selected reception, the own position,
// the node positions layer (advertised, estimate, drift, reach) and, in 3D,
// terrain with hillshade and the sky. The compass mode drives the camera:
// static, follow north up, or follow turned to the heading with look-ahead;
// a drag by the user hands control back.
import type { Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCvdMode } from '../../hooks/useCvdColors';
import { MapSurface } from '../../map/MapSurface';
import { setBuildings3D } from '../../map/engine/buildings3D';
import { setMapLock2D } from '../../map/engine/mapLock2D';
import { NODE_LABEL_FONT } from '../../map/layers/nodesLayer';
import type { Fix } from '../messages';
import type { DirectoryNode } from '../names';
import type { ViewEntry } from '../useReceptionView';
import { bearingFor, followsPosition, lookAheadPadding, type CompassMode } from './compassMode';
import { buildHexFeatures, labelPoints, pillarFeatures, HEX_LABEL_MIN_ZOOM } from './hexLayer';
import { hexResForZoom } from './hexgrid';
import { followView, liveGeoJson, selectionPan, trailGeoJson } from './liveLayers';
import {
  nodeFeatures,
  nodesInView,
  receptionsByNode,
  HUE_COUNT,
  type Bounds,
  type NodePosMode,
} from './nodeLayer';
import { BACKLOG_OUTLINE_ZOOM, currentRideStart } from './rides';
import { currentHour, skyFor } from './sky';
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
} from './terrain';
import { noiseFeatures } from './noiseLayer';
import { layerVisibility, pitchTransition, type ViewState } from './viewModes';
import type { NoiseReading } from '../useRadioStats';

export interface LiveMapProps {
  entries: ViewEntry[];
  selectedId: number | null;
  fix: Fix | null;
  trail: [number, number][];
  view: ViewState;
  compass: CompassMode;
  /** Degrees from north, null without a usable heading. */
  heading: number | null;
  nodePos: NodePosMode;
  nodes: DirectoryNode[];
  exaggeration: number;
  /** dB added to RSSI for colours and heights (calibration, attenuator). */
  rssiOffset?: number;
  /** The radio's noise floor where it was read, and whether to show it. */
  noiseReadings?: NoiseReading[];
  noiseOn?: boolean;
  onUserPan(): void;
  onSelect(id: number): void;
}

const NL_CENTER: [number, number] = [5.3, 52.1];
const EMPTY = { type: 'FeatureCollection' as const, features: [] };
/** One hue per node slot (nodeLayer.hueSlot): only a grouping aid. */
const NODE_HUES = Array.from({ length: HUE_COUNT }, (_, i) => `hsl(${i * 30}, 80%, 55%)`);
const SKY_REFRESH_MS = 10 * 60 * 1000;
const NO_READINGS: NoiseReading[] = [];

// Layer order: hexes under points, node layers over them, own position on top.
const LAYERS = {
  hex: 'wd-hex',
  hex3d: 'wd-hex-3d',
  hexLabels: 'wd-hex-labels',
  pillars: 'wd-pillars',
  trail: 'wd-trail',
  rays: 'wd-node-rays',
  circle: 'wd-node-circle',
  drift: 'wd-node-drift',
  advertised: 'wd-node-advertised',
  estimate: 'wd-node-estimate',
  noise: 'wd-noise',
  points: 'wd-live-points',
  selected: 'wd-live-selected',
  me: 'wd-me',
  hillshade: 'wd-hillshade',
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMap = any;

function setVisible(m: AnyMap, id: string, on: boolean) {
  if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

export function LiveMap({
  entries,
  selectedId,
  fix,
  trail,
  view,
  compass,
  heading,
  nodePos,
  nodes,
  exaggeration,
  rssiOffset = 0,
  noiseReadings = NO_READINGS,
  noiseOn = false,
  onUserPan,
  onSelect,
}: LiveMapProps) {
  const mapRef = useRef<MlMap | null>(null);
  const toneRef = useRef<'light' | 'dark'>('dark');
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(8);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [demReady, setDemReady] = useState(false);
  // Bumped after a basemap switch: the layers were added again and need
  // their visibility, terrain and sky again.
  const [styleGen, setStyleGen] = useState(0);
  const cvdMode = useCvdMode();
  const cvd = cvdMode !== 'off';

  const rideStart = useMemo(() => currentRideStart(entries.map((e) => e.at)), [entries]);
  const live = useMemo(
    () => liveGeoJson(entries, selectedId, cvd, rideStart, rssiOffset),
    [entries, selectedId, cvd, rideStart, rssiOffset]
  );
  const line = useMemo(() => trailGeoJson(trail), [trail]);
  const me = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: fix
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [fix.lon, fix.lat] },
              properties: {},
            },
          ]
        : [],
    }),
    [fix]
  );
  const vis = layerVisibility(view);
  const hexOn = vis.hex || vis.hex3d;
  const res = hexResForZoom(zoom);
  const hexInputs = useMemo(
    () =>
      entries.map((e) => ({
        id: e.id,
        at: e.at,
        rssi: e.rssi,
        lat: e.lat,
        lon: e.lon,
        senderId: e.sender.id,
        senderKind: e.sender.kind,
      })),
    [entries]
  );
  const hex = useMemo(
    () => (hexOn ? buildHexFeatures(hexInputs, res, cvd, rssiOffset) : EMPTY),
    [hexOn, hexInputs, res, cvd, rssiOffset]
  );
  const labels = useMemo(() => (vis.hexLabels ? labelPoints(hex) : EMPTY), [vis.hexLabels, hex]);
  const pillars = useMemo(
    () => (vis.points3d ? pillarFeatures(hexInputs, cvd, rssiOffset) : EMPTY),
    [vis.points3d, hexInputs, cvd, rssiOffset]
  );
  const nodeData = useMemo(() => {
    if (nodePos === 'off' || !bounds) return null;
    const inView = nodesInView(nodes, bounds, nodePos === 'reach');
    return nodeFeatures(inView, receptionsByNode(entries, inView), NODE_HUES);
  }, [nodePos, nodes, bounds, entries]);

  const noise = useMemo(
    () => (noiseOn ? noiseFeatures(noiseReadings, cvd) : EMPTY),
    [noiseOn, noiseReadings, cvd]
  );

  const gestureRef = useRef(false);
  const pendingPitchRef = useRef<number | null>(null);
  const dataRef = useRef({ live, line, me, hex, labels, pillars, nodeData, noise });
  dataRef.current = { live, line, me, hex, labels, pillars, nodeData, noise };
  const handlersRef = useRef({ onUserPan, onSelect });
  handlersRef.current = { onUserPan, onSelect };

  // What each source last got: a source is uploaded again only when its data
  // object changed (a fix moves the own position, not 20000 reach lines).
  const pushedRef = useRef(new Map<string, unknown>());
  const pushData = useCallback((map: MlMap) => {
    const m = map as AnyMap;
    const d = dataRef.current;
    const next: [string, unknown][] = [
      ['wd-trail', d.line],
      ['wd-live-points', d.live.points],
      ['wd-live-selected', d.live.selected],
      ['wd-me', d.me],
      ['wd-hex', d.hex],
      ['wd-hex-labels', d.labels],
      ['wd-pillars', d.pillars],
      ['wd-node-advertised', d.nodeData?.advertised ?? EMPTY],
      ['wd-node-estimate', d.nodeData?.estimates ?? EMPTY],
      ['wd-node-drift', d.nodeData?.drift ?? EMPTY],
      ['wd-node-circle', d.nodeData?.circles ?? EMPTY],
      ['wd-node-rays', d.nodeData?.rays ?? EMPTY],
      ['wd-noise', d.noise],
    ];
    for (const [id, data] of next) {
      if (pushedRef.current.get(id) === data) continue;
      const source = m.getSource(id);
      if (!source) continue;
      source.setData(data);
      pushedRef.current.set(id, data);
    }
  }, []);

  const ensureLayers = useCallback(
    (map: MlMap) => {
      const m = map as AnyMap;
      const geo = (id: string) => {
        if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: EMPTY });
      };
      const add = (spec: Record<string, unknown>) => {
        if (!m.getLayer(spec.id)) m.addLayer(spec);
      };
      if (!m.getSource(DEM_SHADE_SOURCE_ID)) {
        m.addSource(DEM_SHADE_SOURCE_ID, {
          type: 'raster-dem',
          tiles: [DEM_TILES],
          tileSize: 256,
          encoding: DEM_ENCODING,
          maxzoom: DEM_MAX_ZOOM,
          attribution: DEM_ATTRIBUTION,
        });
      }
      if (!m.getSource(DEM_SOURCE_ID)) {
        m.addSource(DEM_SOURCE_ID, {
          type: 'raster-dem',
          tiles: [DEM_TILES],
          tileSize: 256,
          encoding: DEM_ENCODING,
          maxzoom: DEM_MAX_ZOOM,
        });
      }
      add({
        id: LAYERS.hillshade,
        type: 'hillshade',
        source: DEM_SHADE_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.7 },
      });
      for (const id of [
        'wd-hex',
        'wd-hex-labels',
        'wd-pillars',
        'wd-trail',
        'wd-node-rays',
        'wd-node-circle',
        'wd-node-drift',
        'wd-node-advertised',
        'wd-node-estimate',
        'wd-noise',
        'wd-live-points',
        'wd-live-selected',
        'wd-me',
      ]) {
        geo(id);
      }
      add({
        id: LAYERS.hex,
        type: 'fill',
        source: 'wd-hex',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.35 },
      });
      add({
        id: LAYERS.hex3d,
        type: 'fill-extrusion',
        source: 'wd-hex',
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-opacity': 0.75,
        },
      });
      add({
        id: LAYERS.hexLabels,
        type: 'symbol',
        source: 'wd-hex-labels',
        minzoom: HEX_LABEL_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': NODE_LABEL_FONT,
          'text-size': 10,
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.2 },
      });
      add({
        id: LAYERS.pillars,
        type: 'fill-extrusion',
        source: 'wd-pillars',
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-opacity': 0.9,
        },
      });
      add({
        id: LAYERS.trail,
        type: 'line',
        source: 'wd-trail',
        paint: { 'line-color': '#8b5cf6', 'line-width': 3, 'line-opacity': 0.8 },
      });
      add({
        id: LAYERS.rays,
        type: 'line',
        source: 'wd-node-rays',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.55 },
      });
      add({
        id: LAYERS.circle,
        type: 'line',
        source: 'wd-node-circle',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [2, 2] },
      });
      add({
        id: LAYERS.drift,
        type: 'line',
        source: 'wd-node-drift',
        paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [1, 1.5] },
      });
      add({
        id: LAYERS.advertised,
        type: 'circle',
        source: 'wd-node-advertised',
        paint: {
          'circle-radius': 7,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      add({
        id: LAYERS.estimate,
        type: 'circle',
        source: 'wd-node-estimate',
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': ['get', 'color'],
        },
      });
      // Noise floor readings: rings, so they are not taken for receptions.
      add({
        id: LAYERS.noise,
        type: 'circle',
        source: 'wd-noise',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': 0.85,
        },
      });
      // Backlog (earlier rides) shows as faint outlines from zoom 12 and not
      // at all below it (its hexes still count). Zoom must be the outer
      // expression in paint properties.
      const backlog = ['get', 'backlog'];
      add({
        id: LAYERS.points,
        type: 'circle',
        source: 'wd-live-points',
        paint: {
          'circle-radius': ['case', backlog, 5, 6],
          'circle-color': ['get', 'color'],
          'circle-opacity': [
            'step',
            ['zoom'],
            ['case', backlog, 0, ['case', ['get', 'kept'], 0.95, 0.45]],
            BACKLOG_OUTLINE_ZOOM,
            ['case', backlog, 0, ['case', ['get', 'kept'], 0.95, 0.45]],
          ],
          'circle-stroke-width': ['case', backlog, 1.5, 1],
          'circle-stroke-color': ['case', backlog, ['get', 'color'], '#000000'],
          'circle-stroke-opacity': [
            'step',
            ['zoom'],
            ['case', backlog, 0, 1],
            BACKLOG_OUTLINE_ZOOM,
            ['case', backlog, 0.6, 1],
          ],
        },
      });
      add({
        id: LAYERS.selected,
        type: 'circle',
        source: 'wd-live-selected',
        paint: {
          'circle-radius': 11,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 3,
          'circle-stroke-color': ['get', 'color'],
        },
      });
      add({
        id: LAYERS.me,
        type: 'circle',
        source: 'wd-me',
        paint: {
          'circle-radius': 8,
          'circle-color': '#2563eb',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });
      // A style load brings empty sources: everything goes up again.
      pushedRef.current.clear();
      pushData(map);
    },
    [pushData]
  );

  const readView = useCallback((map: MlMap) => {
    setZoom(map.getZoom());
    const b = map.getBounds();
    setBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
  }, []);

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      ensureLayers(map);
      map.on('dragstart', (e: { originalEvent?: unknown }) => {
        // Only a drag by the user, not a camera move of our own.
        if (e.originalEvent) handlersRef.current.onUserPan();
      });
      const pick = (e: MapLayerMouseEvent) => {
        const id = Number(e.features?.[0]?.properties?.id);
        if (Number.isFinite(id)) handlersRef.current.onSelect(id);
      };
      map.on('click', LAYERS.points, pick);
      map.on('click', LAYERS.pillars, pick);
      // While the driver pinches, drags or turns the map, following waits:
      // a camera move of ours would cancel the gesture.
      for (const [start, end] of [
        ['dragstart', 'dragend'],
        ['zoomstart', 'zoomend'],
        ['rotatestart', 'rotateend'],
        ['pitchstart', 'pitchend'],
      ] as const) {
        map.on(start, (e: { originalEvent?: unknown }) => {
          if (e.originalEvent) gestureRef.current = true;
        });
        map.on(end, () => {
          gestureRef.current = false;
        });
      }
      map.on('moveend', () => readView(map));
      // The hillshade's DEM loads tiles as soon as 3D shows it; the terrain
      // mesh waits for them (its own source loads nothing until then).
      map.on('data', (e) => {
        const ev = e as { sourceId?: string; isSourceLoaded?: boolean; sourceDataType?: string };
        if (
          ev.sourceId === DEM_SHADE_SOURCE_ID &&
          ev.isSourceLoaded &&
          ev.sourceDataType !== 'metadata'
        ) {
          setDemReady(true);
        }
      });
      // A listener replaces MapLibre's own console line per error: keep the
      // rest, drop the elevation tiles that fail offline.
      map.on('error', (e: { sourceId?: string; tile?: unknown; error?: unknown }) => {
        if (!isDemTileError(e)) console.error(e.error);
      });
      readView(map);
      setReady(true);
    },
    [ensureLayers, readView]
  );

  useEffect(() => {
    if (ready && mapRef.current) pushData(mapRef.current);
  }, [ready, live, line, me, hex, labels, pillars, nodeData, noise, pushData]);

  useEffect(() => {
    const m = mapRef.current as AnyMap;
    if (ready && m) setVisible(m, LAYERS.noise, noiseOn);
  }, [ready, styleGen, noiseOn]);

  // The view mode's layers.
  useEffect(() => {
    const m = mapRef.current as AnyMap;
    if (!ready || !m) return;
    setVisible(m, LAYERS.hex, vis.hex);
    setVisible(m, LAYERS.hex3d, vis.hex3d);
    setVisible(m, LAYERS.hexLabels, vis.hexLabels);
    setVisible(m, LAYERS.points, vis.points);
    setVisible(m, LAYERS.selected, vis.selected);
    setVisible(m, LAYERS.pillars, vis.points3d);
    const nodesOn = nodePos !== 'off';
    setVisible(m, LAYERS.advertised, nodesOn);
    setVisible(m, LAYERS.estimate, nodesOn);
    setVisible(m, LAYERS.drift, nodesOn);
    setVisible(m, LAYERS.circle, nodesOn);
    setVisible(m, LAYERS.rays, nodePos === 'reach');
  }, [
    ready,
    styleGen,
    vis.hex,
    vis.hex3d,
    vis.hexLabels,
    vis.points,
    vis.points3d,
    vis.selected,
    nodePos,
  ]);

  // 2D or 3D: lock, buildings, pitch (only when crossing between them).
  const was3D = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pitch = pitchTransition(was3D.current, view.mode3D);
    was3D.current = view.mode3D;
    setMapLock2D(map, !view.mode3D);
    if (pitch !== null) pendingPitchRef.current = pitch;
    void setBuildings3D(map, view.mode3D, toneRef.current).then(() => {
      if (pitch !== null) map.easeTo({ pitch, duration: 500 });
    });
  }, [ready, view.mode3D]);

  // Terrain, hillshade and sky in 3D.
  useEffect(() => {
    const m = mapRef.current as AnyMap;
    if (!ready || !m) return;
    // These throw "Style is not done loading" during a basemap switch; the
    // reapply after it (styleGen) runs this again. (isStyleLoaded is no guard:
    // it is false whenever any tile is still loading.)
    const tryMap = (fn: () => void) => {
      try {
        fn();
      } catch {
        // Style still loading.
      }
    };
    const plan = terrainPlan({ mode3D: view.mode3D, ready: demReady, exaggeration });
    tryMap(() => {
      setVisible(m, LAYERS.hillshade, plan.hillshade);
      if (m.getLayer(LAYERS.hillshade)) {
        m.setPaintProperty(
          LAYERS.hillshade,
          'hillshade-exaggeration',
          hillshadeFor(plan.exaggeration)
        );
      }
    });
    tryMap(() =>
      m.setTerrain(plan.mesh ? { source: DEM_SOURCE_ID, exaggeration: plan.exaggeration } : null)
    );
    if (!view.mode3D) return;
    const paint = () => tryMap(() => m.setSky(skyFor(currentHour(), toneRef.current)));
    paint();
    const timer = setInterval(paint, SKY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [ready, styleGen, view.mode3D, demReady, exaggeration]);

  // A reception picked in the live log: show where it was heard.
  const selectedRef = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const next = selectionPan(selectedRef.current, selectedId, entries);
    selectedRef.current = next.last;
    if (next.pan) map.easeTo({ center: next.pan, duration: 500 });
  }, [ready, selectedId, entries]);

  // Follow: centred on the fix, turned to the heading in heading mode with the
  // position two thirds down; north up otherwise.
  // The bearing in 2-degree steps: compass jitter does not move the camera,
  // and outside heading mode a reading changes nothing at all.
  const bearing = Math.round(bearingFor(compass, heading) / 2) * 2;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !followsPosition(compass) || !fix || gestureRef.current) return;
    // A 2D/3D change still on its way: this ease takes the pitch along, or
    // it would stop the tilt where it is.
    const pending = pendingPitchRef.current;
    if (pending !== null && Math.abs(map.getPitch() - pending) < 1) pendingPitchRef.current = null;
    map.easeTo({
      center: [fix.lon, fix.lat],
      ...followView(map.getZoom()),
      bearing,
      padding: lookAheadPadding(map.getContainer().clientHeight, compass),
      ...(pendingPitchRef.current !== null ? { pitch: pendingPitchRef.current } : {}),
      duration: 500,
    });
  }, [ready, compass, fix, bearing]);

  return (
    <MapSurface
      fabs={{}}
      className="h-full w-full"
      initialCenter={fix ? [fix.lon, fix.lat] : NL_CENTER}
      initialZoom={fix ? 15 : 8}
      onReady={handleReady}
      onBasemapReapply={() => {
        const map = mapRef.current;
        if (!map) return;
        ensureLayers(map);
        if (view.mode3D) void setBuildings3D(map, true, toneRef.current);
        // New DEM sources: their tiles must load again before the mesh.
        setDemReady(false);
        setStyleGen((n) => n + 1);
      }}
      onBasemapTone={(tone) => {
        toneRef.current = tone;
      }}
    />
  );
}
