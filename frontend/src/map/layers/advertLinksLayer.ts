import type { Map as MlMap } from 'maplibre-gl';
import type { AdvertLinkEdge } from '../../types';
import { livenessOpacity } from './linksLayer';

// Confidence -> line width (px). Wider hop hash = more uniquely resolvable.
const WIDTH_BY_HOP: Record<number, number> = { 1: 1.0, 2: 2.0, 3: 3.5 };

export function widthForHop(hopWidth: number): number {
  return WIDTH_BY_HOP[hopWidth] ?? WIDTH_BY_HOP[1];
}

export interface AdvertArcCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { opacity: number; width: number; ambiguous: 0 | 1 };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }[];
}

export function buildAdvertArcs(edges: AdvertLinkEdge[], now: number): AdvertArcCollection {
  const features: AdvertArcCollection['features'] = [];
  for (const e of edges) {
    features.push({
      type: 'Feature',
      properties: {
        opacity: livenessOpacity(e.last_seen * 1000, now),
        width: widthForHop(e.hop_width),
        ambiguous: e.ambiguous ? 1 : 0,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [e.a.lon, e.a.lat],
          [e.b.lon, e.b.lat],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export interface AdvertLinksLayerController {
  ensure(): void;
  reattach(): void;
  show(): void;
  hide(): void;
  setData(edges: AdvertLinkEdge[]): void;
}

const SOURCE_ID = 'rt-advert-links';
const SOLID_LAYER = 'rt-advert-links-solid';
const DASHED_LAYER = 'rt-advert-links-dashed';
const LINE_COLOR = '#58a6ff';

/** GL layer for advert-truth edges. Two line sub-layers share one source so
 *  ambiguous edges can be dashed (line-dasharray is not data-driven). Width is
 *  data-driven by confidence, opacity by recency. Hidden until shown. */
export function createAdvertLinksLayer(map: MlMap): AdvertLinksLayerController {
  const m = map as unknown as {
    getSource: (id: string) => { setData: (d: AdvertArcCollection) => void } | undefined;
    getLayer: (id: string) => unknown;
    addSource: (id: string, src: unknown) => void;
    addLayer: (layer: unknown, before?: string) => void;
    setLayoutProperty: (id: string, prop: string, value: unknown) => void;
  };
  let visible = false;

  function ensureLayers(): void {
    if (!m.getSource(SOURCE_ID)) {
      m.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    const before = m.getLayer('rt-nodes') ? 'rt-nodes' : undefined;
    const vis = visible ? 'visible' : 'none';
    if (!m.getLayer(SOLID_LAYER)) {
      m.addLayer(
        {
          id: SOLID_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', ['get', 'ambiguous'], 0],
          layout: { visibility: vis, 'line-cap': 'round' },
          paint: {
            'line-color': LINE_COLOR,
            'line-opacity': ['get', 'opacity'],
            'line-width': ['get', 'width'],
          },
        },
        before
      );
    }
    if (!m.getLayer(DASHED_LAYER)) {
      m.addLayer(
        {
          id: DASHED_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', ['get', 'ambiguous'], 1],
          layout: { visibility: vis, 'line-cap': 'round' },
          paint: {
            'line-color': LINE_COLOR,
            'line-opacity': ['get', 'opacity'],
            'line-width': ['get', 'width'],
            'line-dasharray': [2, 2],
          },
        },
        before
      );
    }
  }

  function setVisibility(v: 'visible' | 'none'): void {
    for (const id of [SOLID_LAYER, DASHED_LAYER]) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v);
    }
  }

  return {
    ensure(): void {
      ensureLayers();
    },
    reattach(): void {
      ensureLayers();
      if (visible) setVisibility('visible');
    },
    show(): void {
      ensureLayers();
      visible = true;
      setVisibility('visible');
    },
    hide(): void {
      visible = false;
      setVisibility('none');
    },
    setData(edges: AdvertLinkEdge[]): void {
      const src = m.getSource(SOURCE_ID);
      if (src) src.setData(buildAdvertArcs(edges, Date.now()));
    },
  };
}
