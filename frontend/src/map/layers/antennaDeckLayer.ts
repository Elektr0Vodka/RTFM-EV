import type { Map as MlMap } from 'maplibre-gl';
import type { AntennaRegisterSiteSummary } from '../../types';
import type { PatternPolygon } from '../antennaPatterns';
import { acquireDeckSlot, type DeckSlot } from './sharedDeckOverlay';
import { loadDeck } from './tracesDeck';
import type { AntennaBand } from './antennaRegisterLayer';

// deck.gl part of the antenna register layer (slot "antennas", under neon nodes
// and packets):
//   * masts, 3D buildings on only: a stick from the ground to the site's highest
//     antenna (registered height above ground level) with a dot at the top. The
//     stick is depth-tested, so the part inside a building is hidden and the
//     dot shows above a rooftop antenna's roof; the dot itself is always drawn.
//   * radiation patterns: estimated wedges/circles from antennaPatterns.ts, at
//     ground level in 2D and at antenna height in 3D, drawn as one even layer
//     (see buildAntennaDeckLayers), plus the open popup's site emphasised. Not
//     pickable; the GL dots underneath keep handling clicks.

const BAND_RGB: Record<AntennaBand, [number, number, number]> = {
  '868': [220, 38, 38],
  '433': [249, 115, 22],
};

export interface AntennaDeckState {
  band: AntennaBand;
  /** Sites to draw as masts; empty when 3D buildings are off. */
  masts: AntennaRegisterSiteSummary[];
  patterns: PatternPolygon[];
  /** Patterns of the site whose popup is open, drawn emphasised on top. */
  selected: PatternPolygon[];
}

export const EMPTY_ANTENNA_DECK_STATE: AntennaDeckState = {
  band: '868',
  masts: [],
  patterns: [],
  selected: [],
};

type LayerCtor = new (p: Record<string, unknown>) => unknown;

/**
 * Build the deck.gl layers. Pure apart from the injected deck module.
 *
 * Order and depth handling:
 *   1. mast sticks (depth-tested and written, so buildings hide the part inside)
 *   2. pattern fill, depth-tested ('less') AND written: where wedges at the same
 *      height overlap, the first one wins and the rest fail the test, so the
 *      fill shows as one even layer (the union) instead of stacking to solid
 *      colour in a city with thousands of wedges; buildings in front hide it
 *   3. the selected site's wedge outlines, always drawn (outlines of every
 *      wedge would be a hairball in a city with thousands of them)
 *   4. mast tops, always drawn
 */
export function buildAntennaDeckLayers(
  deck: typeof import('deck.gl'),
  state: AntennaDeckState
): unknown[] {
  const layers: unknown[] = [];
  const [r, g, b] = BAND_RGB[state.band];
  const masts = state.masts.filter((s) => (s.max_height_m ?? 0) > 0);
  const top = (s: AntennaRegisterSiteSummary): [number, number, number] => [
    s.lon,
    s.lat,
    s.max_height_m ?? 0,
  ];
  if (masts.length) {
    const LineLayer = deck.LineLayer as unknown as LayerCtor;
    layers.push(
      new LineLayer({
        id: 'antenna-mast-stick',
        data: masts,
        getSourcePosition: (s: AntennaRegisterSiteSummary) => [s.lon, s.lat, 0],
        getTargetPosition: top,
        getColor: [r, g, b, 200],
        widthUnits: 'pixels',
        getWidth: 2,
        pickable: false,
        parameters: { depthCompare: 'less-equal' },
      })
    );
  }
  const SolidPolygonLayer = deck.SolidPolygonLayer as unknown as LayerCtor;
  const PathLayer = deck.PathLayer as unknown as LayerCtor;
  if (state.patterns.length) {
    layers.push(
      new SolidPolygonLayer({
        id: 'antenna-pattern-fill',
        data: state.patterns,
        getPolygon: (d: PatternPolygon) => d.ring,
        getFillColor: [r, g, b, 30],
        filled: true,
        extruded: false,
        pickable: false,
        parameters: { depthCompare: 'less', depthWriteEnabled: true },
      })
    );
  }
  if (state.selected.length) {
    layers.push(
      new PathLayer({
        id: 'antenna-pattern-selected-edge',
        data: state.selected,
        getPath: (d: PatternPolygon) => d.ring,
        getColor: [255, 255, 255, 230],
        widthUnits: 'pixels',
        getWidth: 2,
        pickable: false,
        parameters: { depthCompare: 'always', depthWriteEnabled: false },
      })
    );
  }
  if (masts.length) {
    const ScatterplotLayer = deck.ScatterplotLayer as unknown as LayerCtor;
    layers.push(
      new ScatterplotLayer({
        id: 'antenna-mast-top',
        data: masts,
        getPosition: top,
        getRadius: 3.5,
        radiusUnits: 'pixels',
        getFillColor: [r, g, b, 235],
        stroked: true,
        getLineColor: [20, 20, 20, 220],
        lineWidthMinPixels: 1,
        billboard: true,
        pickable: false,
        parameters: { depthCompare: 'always', depthWriteEnabled: false },
      })
    );
  }
  return layers;
}

export interface AntennaDeckOverlay {
  set(state: AntennaDeckState): void;
  destroy(): void;
}

export function createAntennaDeckOverlay(map: MlMap): AntennaDeckOverlay {
  let slot: DeckSlot | null = null;
  let state: AntennaDeckState = EMPTY_ANTENNA_DECK_STATE;
  let destroyed = false;
  let loading: Promise<void> | null = null;

  const empty = (s: AntennaDeckState) =>
    s.masts.length === 0 && s.patterns.length === 0 && s.selected.length === 0;

  const ensure = (): void => {
    if (slot || destroyed || loading) return;
    loading = loadDeck()
      .then((deck) => {
        if (destroyed) return;
        slot = acquireDeckSlot(map, 'antennas', deck, () => buildAntennaDeckLayers(deck, state));
      })
      .catch(() => {
        loading = null;
      });
  };

  return {
    set(next: AntennaDeckState): void {
      state = next;
      // deck.gl is only loaded once there is something to draw.
      if (slot) slot.refresh();
      else if (!empty(state)) ensure();
    },
    destroy(): void {
      destroyed = true;
      slot?.release();
      slot = null;
    },
  };
}
