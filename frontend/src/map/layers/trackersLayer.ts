import type { Map as MlMap } from 'maplibre-gl';
import type { TrackerObject, TrackerPosition } from '../../types';
import { NODE_LABEL_FONT } from './nodesLayer';

// Trackers: ATAK users (TAK-MESHCORE positions) and MeshCore SAR fast-GPS
// beacons, plus map objects ATAK users shared. Each tracker's newest fix is a
// dot in its ATAK team colour (SAR beacons in their own colour); with trails on
// its older fixes are small dots joined by a dashed line. Objects are squares.

// ATAK's team colours, by the team name the plugin sends.
const TEAM_COLORS: Record<string, string> = {
  white: '#ffffff',
  yellow: '#ffff00',
  orange: '#ff8000',
  magenta: '#ff00ff',
  red: '#ff0000',
  maroon: '#800000',
  purple: '#800080',
  'dark blue': '#00008b',
  blue: '#0000ff',
  cyan: '#00ffff',
  teal: '#008080',
  green: '#00ff00',
  'dark green': '#006400',
  brown: '#a52a2a',
};
export const TRACKER_DEFAULT_FILL = '#0ea5e9';
export const TRACKER_SAR_FILL = '#e11d48';
export const TRACKER_OBJECT_FILL = '#a855f7';

const POINT_SOURCE_ID = 'rt-trackers';
const TRAIL_SOURCE_ID = 'rt-trackers-trails';
const OBJECT_SOURCE_ID = 'rt-tracker-objects';

const TRAIL_LAYER_ID = 'rt-trackers-trails';
const TRAIL_DOT_LAYER_ID = 'rt-trackers-trail-dots';
const OBJECT_LAYER_ID = 'rt-tracker-objects';
const OBJECT_LABEL_LAYER_ID = 'rt-tracker-objects-label';
const POINT_LAYER_ID = 'rt-trackers';
const POINT_LABEL_LAYER_ID = 'rt-trackers-label';
const LAYER_IDS = [
  TRAIL_LAYER_ID,
  TRAIL_DOT_LAYER_ID,
  OBJECT_LAYER_ID,
  OBJECT_LABEL_LAYER_ID,
  POINT_LAYER_ID,
  POINT_LABEL_LAYER_ID,
];

/** One tracker: its source plus callsign (ATAK) or key prefix (SAR). */
export function trackerId(p: TrackerPosition): string {
  return `${p.source}:${p.identity}`;
}

export function trackerColor(p: TrackerPosition): string {
  if (p.source === 'sar_fast_gps') return TRACKER_SAR_FILL;
  return (p.team && TEAM_COLORS[p.team.trim().toLowerCase()]) || TRACKER_DEFAULT_FILL;
}

export function countTrackers(positions: TrackerPosition[]): number {
  return new Set(positions.map(trackerId)).size;
}

/** Fixes newest first as given; `latest` marks each tracker's newest. */
export function buildTrackerFeatures(positions: TrackerPosition[]) {
  const seen = new Set<string>();
  return {
    type: 'FeatureCollection' as const,
    features: positions.map((p) => {
      const key = trackerId(p);
      const latest = !seen.has(key);
      seen.add(key);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: {
          key,
          fix_id: p.id ?? p.received_at,
          title: p.display_name || p.identity,
          color: trackerColor(p),
          latest,
        },
      };
    }),
  };
}

/** One line per tracker with two or more fixes, oldest to newest. */
export function buildTrackerTrailFeatures(positions: TrackerPosition[]) {
  const byTracker = new Map<string, { color: string; points: [number, number][] }>();
  for (const p of positions) {
    const key = trackerId(p);
    const entry = byTracker.get(key) ?? { color: trackerColor(p), points: [] };
    entry.points.push([p.lon, p.lat]);
    byTracker.set(key, entry);
  }
  return {
    type: 'FeatureCollection' as const,
    features: [...byTracker.entries()]
      .filter(([, entry]) => entry.points.length >= 2)
      .map(([key, entry]) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: [...entry.points].reverse() },
        properties: { key, color: entry.color },
      })),
  };
}

export function buildTrackerObjectFeatures(objects: TrackerObject[]) {
  return {
    type: 'FeatureCollection' as const,
    features: objects.map((o) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [o.lon, o.lat] },
      properties: { uid: o.uid, title: o.callsign || o.uid },
    })),
  };
}

export interface TrackersLayerOptions {
  onTrackerClick?: (key: string, fixId: number) => void;
  onObjectClick?: (uid: string) => void;
}

export function createTrackersLayer(map: MlMap, opts: TrackersLayerOptions = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  let listenersBound = false;
  let visible = false;
  let lastPoints = buildTrackerFeatures([]);
  let lastTrails = buildTrackerTrailFeatures([]);
  let lastObjects = buildTrackerObjectFeatures([]);

  function labelLayer(id: string, source: string, filter?: unknown[]) {
    m.addLayer({
      id,
      type: 'symbol',
      source,
      ...(filter ? { filter } : {}),
      layout: {
        visibility: visible ? 'visible' : 'none',
        'text-field': ['get', 'title'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-optional': true,
        // Single font: a multi-font stack 404s on the glyph servers.
        'text-font': NODE_LABEL_FONT,
      },
      paint: {
        'text-color': '#f8fafc',
        'text-halo-color': '#0f172a',
        'text-halo-width': 1.2,
      },
    });
  }

  function addSourceAndLayer() {
    if (m.getSource(POINT_SOURCE_ID)) return;
    const visibility = visible ? 'visible' : 'none';
    m.addSource(TRAIL_SOURCE_ID, { type: 'geojson', data: lastTrails });
    m.addSource(OBJECT_SOURCE_ID, { type: 'geojson', data: lastObjects });
    m.addSource(POINT_SOURCE_ID, { type: 'geojson', data: lastPoints });
    m.addLayer({
      id: TRAIL_LAYER_ID,
      type: 'line',
      source: TRAIL_SOURCE_ID,
      layout: { visibility, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [1, 2] },
    });
    m.addLayer({
      id: TRAIL_DOT_LAYER_ID,
      type: 'circle',
      source: POINT_SOURCE_ID,
      filter: ['!', ['get', 'latest']],
      layout: { visibility },
      paint: {
        'circle-radius': 3,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 1,
      },
    });
    m.addLayer({
      id: OBJECT_LAYER_ID,
      type: 'circle',
      source: OBJECT_SOURCE_ID,
      layout: { visibility },
      paint: {
        'circle-radius': 5,
        'circle-color': TRACKER_OBJECT_FILL,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
    labelLayer(OBJECT_LABEL_LAYER_ID, OBJECT_SOURCE_ID);
    m.addLayer({
      id: POINT_LAYER_ID,
      type: 'circle',
      source: POINT_SOURCE_ID,
      filter: ['get', 'latest'],
      layout: { visibility },
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 2,
      },
    });
    labelLayer(POINT_LABEL_LAYER_ID, POINT_SOURCE_ID, ['get', 'latest']);
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bind = (layerId: string, handler: (props: any) => void) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.on('click', layerId, (e: any) => {
        const props = e.features?.[0]?.properties;
        if (props) handler(props);
      });
      m.on('mouseenter', layerId, () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', layerId, () => {
        m.getCanvas().style.cursor = '';
      });
    };
    for (const layerId of [POINT_LAYER_ID, TRAIL_DOT_LAYER_ID]) {
      bind(layerId, (props) => opts.onTrackerClick?.(String(props.key), Number(props.fix_id)));
    }
    bind(OBJECT_LAYER_ID, (props) => opts.onObjectClick?.(String(props.uid)));
  }

  function setData(positions: TrackerPosition[], objects: TrackerObject[]) {
    lastPoints = buildTrackerFeatures(positions);
    lastTrails = buildTrackerTrailFeatures(positions);
    lastObjects = buildTrackerObjectFeatures(objects);
    m.getSource(POINT_SOURCE_ID)?.setData(lastPoints);
    m.getSource(TRAIL_SOURCE_ID)?.setData(lastTrails);
    m.getSource(OBJECT_SOURCE_ID)?.setData(lastObjects);
  }

  function setVisible(on: boolean) {
    visible = on;
    for (const id of LAYER_IDS) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  }

  function ensure() {
    addSourceAndLayer();
    bindListeners();
  }
  function reattach() {
    // A basemap setStyle drops custom sources/layers; re-add them with the last data.
    addSourceAndLayer();
  }

  return { ensure, reattach, setData, setVisible };
}
