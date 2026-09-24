import type { Map as MlMap } from 'maplibre-gl';
import type { SharedLocation } from '../../types';
import { NODE_LABEL_FONT } from './nodesLayer';

// Location shares from chat (m: markers, lat/lon pairs, MGRS). Drawn as
// teardrop pins (a shape no node uses) so they never read as node circles,
// which come in every role colour. An MGRS share names a grid square rather
// than a point, so its square is drawn as a translucent area.
export const SHARED_LOCATION_FILL = '#e11d48';
export const SHARED_LOCATION_POI_FILL = '#0d9488';
const PIN_IMAGE = 'rt-shared-pin';
const PIN_POI_IMAGE = 'rt-shared-pin-poi';

const SOURCE_ID = 'rt-shared-locations';
const AREA_SOURCE_ID = 'rt-shared-locations-area';
const PIN_LAYER_ID = 'rt-shared-locations';
const LABEL_LAYER_ID = 'rt-shared-locations-label';
const AREA_LAYER_ID = 'rt-shared-locations-area';
const LAYER_IDS = [AREA_LAYER_ID, PIN_LAYER_ID, LABEL_LAYER_ID];

// Metres per degree of latitude (mean); good enough to outline a grid square.
const METRES_PER_DEGREE = 111_320;
// Grid squares smaller than this are not worth an outline at map scale.
const MIN_AREA_PRECISION_M = 10;

export interface SharedLocationProps {
  message_id: number;
  lat: number;
  lon: number;
  title: string;
  poi: boolean;
}

/** Pin title: the marker label, else the sender (a DM's sender is its contact). */
export function sharedLocationTitle(loc: SharedLocation, ownName = ''): string {
  if (loc.label) return loc.label;
  if (loc.outgoing) return ownName;
  if (loc.sender_name) return loc.sender_name;
  return loc.type === 'PRIV' ? (loc.conversation_name ?? '') : '';
}

export function buildSharedLocationFeatures(locations: SharedLocation[], ownName = '') {
  return {
    type: 'FeatureCollection' as const,
    features: locations.map((loc) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [loc.lon, loc.lat] },
      properties: {
        message_id: loc.message_id,
        lat: loc.lat,
        lon: loc.lon,
        title: sharedLocationTitle(loc, ownName),
        poi: loc.format === 'marker' && loc.flags.toLowerCase().split(',').includes('poi'),
      } satisfies SharedLocationProps,
    })),
  };
}

/** Square outlines for MGRS shares coarser than 10 m, centred on the pin. */
export function buildSharedLocationAreas(locations: SharedLocation[]) {
  const features = locations
    .filter((loc) => loc.precision_m != null && loc.precision_m >= MIN_AREA_PRECISION_M)
    .map((loc) => {
      const half = (loc.precision_m as number) / 2;
      const dLat = half / METRES_PER_DEGREE;
      const dLon = half / (METRES_PER_DEGREE * Math.max(Math.cos((loc.lat * Math.PI) / 180), 0.01));
      const ring = [
        [loc.lon - dLon, loc.lat - dLat],
        [loc.lon + dLon, loc.lat - dLat],
        [loc.lon + dLon, loc.lat + dLat],
        [loc.lon - dLon, loc.lat + dLat],
        [loc.lon - dLon, loc.lat - dLat],
      ];
      return {
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
        properties: { message_id: loc.message_id },
      };
    });
  return { type: 'FeatureCollection' as const, features };
}

// Pin icon, 24x32 CSS px at 2x. Rasterised by hand (no canvas) so it also
// works where 2D canvas is unavailable: a round head, a tail to the tip at the
// bottom centre, a white rim and a white centre dot. 4x4 supersampling for
// smooth edges.
const PIN_W = 24;
const PIN_H = 32;
const PIN_SCALE = 2;
const HEAD = { x: 12, y: 11, r: 10 };
const TAIL: [number, number][] = [
  [3.4, 15.5],
  [20.6, 15.5],
  [12, 31.5],
];

function insideTail(x: number, y: number, inset: number): boolean {
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = TAIL[i];
    const [bx, by] = TAIL[(i + 1) % 3];
    const [cx, cy] = TAIL[(i + 2) % 3];
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey);
    // Signed distance to the edge, positive on the side of the third vertex.
    const side = Math.sign(ex * (cy - ay) - ey * (cx - ax));
    const d = (side * (ex * (y - ay) - ey * (x - ax))) / len;
    if (d < inset) return false;
  }
  return true;
}

function pinCoverage(x: number, y: number, inset: number): boolean {
  return (
    Math.hypot(x - HEAD.x, y - HEAD.y) <= HEAD.r - inset || (y > HEAD.y && insideTail(x, y, inset))
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** RGBA pixels for a pin in `fill`. Exported for unit testing. */
export function buildPinImage(fill: string) {
  const width = PIN_W * PIN_SCALE;
  const height = PIN_H * PIN_SCALE;
  const data = new Uint8Array(width * height * 4);
  const [fr, fg, fb] = hexToRgb(fill);
  const SS = 4;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let shape = 0;
      let white = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / PIN_SCALE;
          const y = (py + (sy + 0.5) / SS) / PIN_SCALE;
          if (!pinCoverage(x, y, 0)) continue;
          shape++;
          const rim = !pinCoverage(x, y, 1.6);
          const dot = Math.hypot(x - HEAD.x, y - HEAD.y) <= 3.6;
          if (rim || dot) white++;
        }
      }
      if (shape === 0) continue;
      const i = (py * width + px) * 4;
      const w = white / shape;
      data[i] = Math.round(fr + (255 - fr) * w);
      data[i + 1] = Math.round(fg + (255 - fg) * w);
      data[i + 2] = Math.round(fb + (255 - fb) * w);
      data[i + 3] = Math.round((shape / (SS * SS)) * 255);
    }
  }
  return { width, height, data };
}

export interface SharedLocationsLayerOptions {
  onClick?: (messageId: number) => void;
}

export function createSharedLocationsLayer(map: MlMap, opts: SharedLocationsLayerOptions = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  let listenersBound = false;
  let visible = false;
  let lastPoints: ReturnType<typeof buildSharedLocationFeatures> = {
    type: 'FeatureCollection',
    features: [],
  };
  let lastAreas: ReturnType<typeof buildSharedLocationAreas> = {
    type: 'FeatureCollection',
    features: [],
  };

  function addImages() {
    if (!m.hasImage(PIN_IMAGE)) {
      m.addImage(PIN_IMAGE, buildPinImage(SHARED_LOCATION_FILL), { pixelRatio: PIN_SCALE });
    }
    if (!m.hasImage(PIN_POI_IMAGE)) {
      m.addImage(PIN_POI_IMAGE, buildPinImage(SHARED_LOCATION_POI_FILL), {
        pixelRatio: PIN_SCALE,
      });
    }
  }

  function addSourceAndLayer() {
    // A basemap setStyle drops images too; re-add them before the layers.
    addImages();
    if (m.getSource(SOURCE_ID)) return;
    const visibility = visible ? 'visible' : 'none';
    m.addSource(AREA_SOURCE_ID, { type: 'geojson', data: lastAreas });
    m.addSource(SOURCE_ID, { type: 'geojson', data: lastPoints });
    m.addLayer({
      id: AREA_LAYER_ID,
      type: 'fill',
      source: AREA_SOURCE_ID,
      layout: { visibility },
      paint: {
        'fill-color': SHARED_LOCATION_FILL,
        'fill-opacity': 0.15,
        'fill-outline-color': SHARED_LOCATION_FILL,
      },
    });
    m.addLayer({
      id: PIN_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        visibility,
        'icon-image': ['case', ['get', 'poi'], PIN_POI_IMAGE, PIN_IMAGE],
        // The pin's tip marks the spot.
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    m.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        visibility,
        'text-field': ['get', 'title'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.3],
        'text-optional': true,
        // Single font: a multi-font stack 404s on the glyph servers (see
        // NODE_LABEL_FONT in nodesLayer.ts).
        'text-font': NODE_LABEL_FONT,
      },
      paint: {
        'text-color': '#f8fafc',
        'text-halo-color': '#0f172a',
        'text-halo-width': 1.2,
      },
    });
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.on('click', PIN_LAYER_ID, (e: any) => {
      const props = e.features?.[0]?.properties;
      if (props && opts.onClick) opts.onClick(Number(props.message_id));
    });
    m.on('mouseenter', PIN_LAYER_ID, () => {
      m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', PIN_LAYER_ID, () => {
      m.getCanvas().style.cursor = '';
    });
  }

  function setData(locations: SharedLocation[], ownName = '') {
    lastPoints = buildSharedLocationFeatures(locations, ownName);
    lastAreas = buildSharedLocationAreas(locations);
    m.getSource(SOURCE_ID)?.setData(lastPoints);
    m.getSource(AREA_SOURCE_ID)?.setData(lastAreas);
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
