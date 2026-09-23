import type { Map as MlMap } from 'maplibre-gl';
import type { GuessedLocation } from '../guessedLocations';
import { NODE_LABEL_FONT } from './nodesLayer';

// Guessed-location layer: an estimated position for a node with no advertised
// or manual location, computed in guessedLocations.ts. Drawn as a HOLLOW
// circle with a "~" glyph so it never reads as a real, located node (which is
// always a filled circle, see nodesLayer.ts) -- these coordinates are a guess
// and must never be mistaken for a reported position. Only shown at zoom 12+
// (native `minzoom`, per meshcore-open's own `_guessedZoomThreshold`), and off
// by default.

export const GUESSED_LOCATIONS_MIN_ZOOM = 12;

const SOURCE_ID = 'rt-guessed-locations';
const CIRCLE_LAYER_ID = 'rt-guessed-locations';
const GLYPH_LAYER_ID = 'rt-guessed-locations-glyph';
const LAYER_IDS = [CIRCLE_LAYER_ID, GLYPH_LAYER_ID];

// Muted for a low-confidence (single-anchor) guess; role-neutral so it reads
// as "uncertain" regardless of node type, matching meshcore-open's low-
// confidence border colour choice.
const LOW_CONFIDENCE_COLOR = '#94a3b8';
const HIGH_CONFIDENCE_COLOR = '#f59e0b';

export interface GuessedLocationProps {
  public_key: string;
  name: string;
  high_confidence: boolean;
}

export function buildGuessedLocationFeatures(
  guesses: GuessedLocation[],
  names: Map<string, string>
) {
  return {
    type: 'FeatureCollection' as const,
    features: guesses.map((g) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [g.lon, g.lat] },
      properties: {
        public_key: g.public_key,
        name: names.get(g.public_key.toLowerCase()) ?? g.public_key.slice(0, 12),
        high_confidence: g.highConfidence,
      } satisfies GuessedLocationProps,
    })),
  };
}

export interface GuessedLocationsLayerOptions {
  onClick?: (publicKey: string) => void;
}

export function createGuessedLocationsLayer(map: MlMap, opts: GuessedLocationsLayerOptions = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  let listenersBound = false;
  let visible = false;
  let lastData: ReturnType<typeof buildGuessedLocationFeatures> = {
    type: 'FeatureCollection',
    features: [],
  };

  function addSourceAndLayer() {
    if (m.getSource(SOURCE_ID)) return;
    const visibility = visible ? 'visible' : 'none';
    m.addSource(SOURCE_ID, { type: 'geojson', data: lastData });
    m.addLayer({
      id: CIRCLE_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      minzoom: GUESSED_LOCATIONS_MIN_ZOOM,
      layout: { visibility },
      paint: {
        // Hollow: transparent fill, coloured ring only.
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': 10,
        'circle-stroke-width': ['case', ['get', 'high_confidence'], 2.5, 2],
        'circle-stroke-color': [
          'case',
          ['get', 'high_confidence'],
          HIGH_CONFIDENCE_COLOR,
          LOW_CONFIDENCE_COLOR,
        ],
      },
    });
    m.addLayer({
      id: GLYPH_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: GUESSED_LOCATIONS_MIN_ZOOM,
      layout: {
        visibility,
        'text-field': '~',
        'text-size': 14,
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        // Single font: a multi-font stack 404s on the glyph servers (see
        // NODE_LABEL_FONT in nodesLayer.ts).
        'text-font': NODE_LABEL_FONT,
      },
      paint: {
        'text-color': [
          'case',
          ['get', 'high_confidence'],
          HIGH_CONFIDENCE_COLOR,
          LOW_CONFIDENCE_COLOR,
        ],
        'text-halo-color': '#0f172a',
        'text-halo-width': 1,
      },
    });
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.on('click', CIRCLE_LAYER_ID, (e: any) => {
      const props = e.features?.[0]?.properties;
      if (props?.public_key && opts.onClick) opts.onClick(String(props.public_key));
    });
    m.on('mouseenter', CIRCLE_LAYER_ID, () => {
      m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', CIRCLE_LAYER_ID, () => {
      m.getCanvas().style.cursor = '';
    });
  }

  function setData(guesses: GuessedLocation[], names: Map<string, string>) {
    lastData = buildGuessedLocationFeatures(guesses, names);
    m.getSource(SOURCE_ID)?.setData(lastData);
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
