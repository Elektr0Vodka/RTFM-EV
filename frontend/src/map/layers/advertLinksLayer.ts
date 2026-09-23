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
    properties: {
      opacity: number;
      width: number;
      ambiguous: 0 | 1;
      a: string;
      b: string;
      count: number;
      last_seen: number;
    };
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
        a: e.a.pubkey,
        b: e.b.pubkey,
        count: e.count,
        last_seen: e.last_seen,
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
  setWidthScale(scale: number): void;
}

/** Confidence-driven width expression, scaled by the width control. */
export function advertWidthExpr(scale: number): unknown {
  return scale === 1 ? ['get', 'width'] : ['*', ['get', 'width'], scale];
}

export interface LinkClickInfo {
  a: string;
  b: string;
  count: number;
  lastSeen: number;
  coords: [number, number][];
}

export interface AdvertLinksLayerOptions {
  /** Source/layer id prefix; lets a second instance (traffic mode) coexist. */
  idPrefix?: string;
  color?: string;
  onClick?: (info: LinkClickInfo, lngLat: [number, number]) => void;
}

/** GL layer for server-resolved edges (advert paths or the traffic edge log).
 *  Two line sub-layers share one source so ambiguous edges can be dashed
 *  (line-dasharray is not data-driven). Width is data-driven by confidence,
 *  opacity by recency. Hidden until shown. */
export function createAdvertLinksLayer(
  map: MlMap,
  opts: AdvertLinksLayerOptions = {}
): AdvertLinksLayerController {
  const m = map as unknown as {
    getSource: (id: string) => { setData: (d: AdvertArcCollection) => void } | undefined;
    getLayer: (id: string) => unknown;
    addSource: (id: string, src: unknown) => void;
    addLayer: (layer: unknown, before?: string) => void;
    setLayoutProperty: (id: string, prop: string, value: unknown) => void;
    setPaintProperty: (id: string, prop: string, value: unknown) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on: (type: string, layer: string, cb: (e: any) => void) => void;
    getCanvas: () => HTMLCanvasElement;
  };
  const prefix = opts.idPrefix ?? 'rt-advert-links';
  const SOURCE_ID = prefix;
  const SOLID_LAYER = `${prefix}-solid`;
  const DASHED_LAYER = `${prefix}-dashed`;
  const LINE_COLOR = opts.color ?? '#58a6ff';
  let visible = false;
  let widthScale = 1;
  let listenersBound = false;

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
            'line-width': advertWidthExpr(widthScale),
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
            'line-width': advertWidthExpr(widthScale),
            'line-dasharray': [2, 2],
          },
        },
        before
      );
    }
    if (!listenersBound && opts.onClick) {
      listenersBound = true;
      for (const id of [SOLID_LAYER, DASHED_LAYER]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        m.on('click', id, (e: any) => {
          const f = e.features?.[0];
          const p = f?.properties;
          if (!p || !opts.onClick) return;
          opts.onClick(
            {
              a: String(p.a),
              b: String(p.b),
              count: Number(p.count),
              lastSeen: Number(p.last_seen),
              coords: (f.geometry?.coordinates ?? []) as [number, number][],
            },
            [e.lngLat.lng, e.lngLat.lat]
          );
        });
        m.on('mouseenter', id, () => {
          m.getCanvas().style.cursor = 'pointer';
        });
        m.on('mouseleave', id, () => {
          m.getCanvas().style.cursor = '';
        });
      }
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
    setWidthScale(scale: number): void {
      widthScale = scale;
      for (const id of [SOLID_LAYER, DASHED_LAYER]) {
        if (m.getLayer(id)) m.setPaintProperty(id, 'line-width', advertWidthExpr(widthScale));
      }
    },
  };
}
