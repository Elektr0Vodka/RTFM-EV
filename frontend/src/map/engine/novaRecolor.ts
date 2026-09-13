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

// --- Phosphor tint ---------------------------------------------------------
// The Nova palette is navy (all hues ~210-220). Tinting re-hues every colour to a
// target hue while keeping each colour's own lightness (and saturation), so the
// map's contrast/structure is preserved but the whole basemap reads in the CRT
// phosphor colour. `desaturate` (used for the white phosphor) drops saturation to
// zero for a greyscale map instead.

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return '#' + to2(r) + to2(g) + to2(b);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Re-hue a hex colour to `hue` (0-360), keeping its lightness. `desaturate`
 *  produces a greyscale colour of the same lightness (for the white phosphor). */
export function tintHex(hex: string, hue: number, desaturate: boolean): string {
  const [r, g, b] = hexToRgb(hex);
  const [, s, l] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = desaturate ? hslToRgb(0, 0, l) : hslToRgb(hue, s, l);
  return rgbToHex(nr, ng, nb);
}

function tintPalette(hue: number, desaturate: boolean): typeof NOVA_PALETTE {
  const out = {} as Record<string, string>;
  for (const [k, v] of Object.entries(NOVA_PALETTE)) {
    out[k] = tintHex(v, hue, desaturate);
  }
  return out as typeof NOVA_PALETTE;
}

/** Build a recolour function that paints the Nova basemap in the given phosphor
 *  hue (or greyscale when `desaturate`). */
export function recolorNovaTinted(
  hue: number,
  desaturate: boolean
): (style: StyleSpecification) => StyleSpecification {
  const P = tintPalette(hue, desaturate);
  return (style: StyleSpecification): StyleSpecification => {
    const layers = ((style.layers as AnyLayer[]) || []).map((l) => recolorLayer(l, P));
    return { ...style, layers } as StyleSpecification;
  };
}
