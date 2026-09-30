import type { Map as MlMap } from 'maplibre-gl';
import type { Contact } from '../../types';
import type { GuessedLocation } from '../guessedLocations';
import {
  LABEL_MIN_ZOOM,
  NODE_LABEL_FONT,
  nodeLabel,
  nodeLabelLayout,
  type NodeLabelMode,
} from './nodesLayer';

// Guessed-location layer: an estimated position for a node with no advertised
// or manual location, computed in guessedLocations.ts. Drawn as a HOLLOW
// circle with a "~" glyph so it never reads as a real, located node (which is
// always a filled circle, see nodesLayer.ts) -- these coordinates are a guess
// and must never be mistaken for a reported position. Shown at every zoom
// level like real node markers (meshcore-open hides them below zoom 12), and
// off by default. A name/tag label follows the map's node-label mode and
// zoom, like real node labels (see nodesLayer.ts).

const SOURCE_ID = 'rt-guessed-locations';
const CIRCLE_LAYER_ID = 'rt-guessed-locations';
const GLYPH_LAYER_ID = 'rt-guessed-locations-glyph';
export const GUESSED_LOCATIONS_LABEL_LAYER_ID = 'rt-guessed-locations-label';
const LAYER_IDS = [CIRCLE_LAYER_ID, GLYPH_LAYER_ID, GUESSED_LOCATIONS_LABEL_LAYER_ID];
// Real node labels; the guessed label layer goes below it so real names win a
// label collision (MapLibre places the topmost symbol layer first).
const NODE_LABELS_LAYER_ID = 'rt-node-labels';

// Muted for a low-confidence (single-anchor) guess; role-neutral so it reads
// as "uncertain" regardless of node type, matching meshcore-open's low-
// confidence border colour choice.
const LOW_CONFIDENCE_COLOR = '#94a3b8';
const HIGH_CONFIDENCE_COLOR = '#f59e0b';

export interface GuessedLocationProps {
  public_key: string;
  name: string;
  label: string;
  high_confidence: boolean;
}

export function buildGuessedLocationFeatures(
  guesses: GuessedLocation[],
  contacts: Contact[],
  labelMode: NodeLabelMode = 'off'
) {
  const byKey = new Map(contacts.map((c) => [c.public_key.toLowerCase(), c]));
  return {
    type: 'FeatureCollection' as const,
    features: guesses.map((g) => {
      const c = byKey.get(g.public_key.toLowerCase());
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [g.lon, g.lat] },
        properties: {
          public_key: g.public_key,
          name: c?.name ?? g.public_key.slice(0, 12),
          label: c ? nodeLabel(c, labelMode) : '',
          high_confidence: g.highConfidence,
        } satisfies GuessedLocationProps,
      };
    }),
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
  let labelMode: NodeLabelMode = 'off';
  let lastGuesses: GuessedLocation[] = [];
  let lastContacts: Contact[] = [];
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
    // Name/tag label, styled like the real node labels. Empty labels (mode
    // 'off') render nothing. No role sort key: guesses carry no `sortKey`.
    const labelLayout = { ...nodeLabelLayout(), visibility };
    delete labelLayout['symbol-sort-key'];
    m.addLayer(
      {
        id: GUESSED_LOCATIONS_LABEL_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        minzoom: LABEL_MIN_ZOOM,
        layout: labelLayout,
        paint: {
          'text-color': '#f8fafc',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.5,
        },
      },
      m.getLayer(NODE_LABELS_LAYER_ID) ? NODE_LABELS_LAYER_ID : undefined
    );
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

  function setData(guesses: GuessedLocation[], contacts: Contact[]) {
    lastGuesses = guesses;
    lastContacts = contacts;
    lastData = buildGuessedLocationFeatures(guesses, contacts, labelMode);
    m.getSource(SOURCE_ID)?.setData(lastData);
  }

  function setLabelMode(mode: NodeLabelMode) {
    labelMode = mode;
    setData(lastGuesses, lastContacts);
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

  return { ensure, reattach, setData, setLabelMode, setVisible };
}
