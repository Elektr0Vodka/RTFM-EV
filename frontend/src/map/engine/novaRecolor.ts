import type { StyleSpecification } from 'maplibre-gl';

// Nova dark basemap: a recolour of the OpenFreeMap dark vector style into a navy
// ground, ported from DutchMeshCore-Observers web/js/lib/dmcbasemap.js. Keyless.
export const NOVA_PALETTE = {
  land: '#080f1e', // background ground
  water: '#0c1d33', // water fills
  waterway: '#13385a', // rivers/canals (lifted off water so they read)
  building: '#111d33', // building fills
  landuse: '#0b1526', // residential/landcover wash (barely above ground)
  park: '#0c1a26', // parks, a hair greener-blue than landuse
  boundary: '#284a76', // admin borders
  road_bright: '#79b8ff', // motorway / major glow
  road_mid: '#3f66a9', // minor roads
  road_dim: '#2b4a70', // paths
  rail: '#33405c', // railways
  pier: '#16233b', // piers
  label: '#c4dbff', // place / road / water labels
  halo: '#050a15', // label halo (matches the ground)
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLayer = Record<string, any>;

function recolorLayer(layer: AnyLayer, P: typeof NOVA_PALETTE): AnyLayer {
  const paint: AnyLayer = { ...(layer.paint || {}) };
  const id: string = layer.id;
  const sl: string | undefined = layer['source-layer'];
  const line = (color: string, blur?: number) => {
    paint['line-color'] = color;
    if (blur != null) paint['line-blur'] = blur;
  };

  if (layer.type === 'background') {
    paint['background-color'] = P.land;
  } else if (sl === 'water') {
    paint['fill-color'] = P.water;
  } else if (sl === 'waterway') {
    paint['line-color'] = P.waterway;
  } else if (sl === 'building') {
    paint['fill-color'] = P.building;
    paint['fill-outline-color'] = P.land;
  } else if (sl === 'landcover' || sl === 'landuse') {
    paint['fill-color'] = id.includes('park') ? P.park : P.landuse;
    delete paint['fill-pattern']; // sprite pattern would clash with the flat wash
  } else if (sl === 'boundary') {
    paint['line-color'] = P.boundary;
  } else if (sl === 'transportation') {
    if (layer.type === 'fill') paint['fill-color'] = P.pier;
    else if (/casing/.test(id)) paint['line-color'] = P.land;
    else if (/motorway_inner|major_inner/.test(id)) line(P.road_bright, 1.4);
    else if (/motorway_subtle|major_subtle/.test(id)) line(P.road_bright, 1.1);
    else if (/motorway|major/.test(id)) line(P.road_bright, 1.0);
    else if (/minor/.test(id)) line(P.road_mid, 0.4);
    else if (/path/.test(id)) paint['line-color'] = P.road_dim;
    else if (/railway/.test(id)) paint['line-color'] = P.rail;
    else if (/pier/.test(id)) paint['line-color'] = P.pier;
  } else if (layer.type === 'symbol') {
    if ('text-color' in paint) paint['text-color'] = P.label;
    if ('text-halo-color' in paint) paint['text-halo-color'] = P.halo;
  }

  return { ...layer, paint };
}

export function recolorNovaDark(style: StyleSpecification): StyleSpecification {
  const P = NOVA_PALETTE;
  const layers = ((style.layers as AnyLayer[]) || []).map((l) => recolorLayer(l, P));
  return { ...style, layers } as StyleSpecification;
}
