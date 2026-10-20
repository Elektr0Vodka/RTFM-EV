// The sky over the 3D view, by time of day (rx's palette). At a high pitch much
// of the screen is above the horizon, and with no sky MapLibre draws nothing
// there, which reads as a broken map. The clock picks the colour; over a dark
// basemap a brightness cap keeps a midday sky from glaring. These literal
// colours feed MapLibre paint properties, not the UI, so they are not theme
// tokens.

export interface SkyStop {
  h: number;
  sky: string;
  horizon: string;
  fog: string;
}

export const SKY_STOPS: SkyStop[] = [
  { h: 0, sky: '#05070f', horizon: '#0a1020', fog: '#0a1020' },
  { h: 5.5, sky: '#141d38', horizon: '#3b3350', fog: '#2a2740' },
  { h: 7, sky: '#3f6ea8', horizon: '#e8a06a', fog: '#c9a58a' },
  { h: 10, sky: '#4a86c8', horizon: '#bcd6ea', fog: '#c5d8e8' },
  { h: 14, sky: '#4287d0', horizon: '#c3daf0', fog: '#cbdcec' },
  { h: 18, sky: '#4a7fb5', horizon: '#e6b183', fog: '#d3b295' },
  { h: 20, sky: '#2a3a63', horizon: '#c2704f', fog: '#7a5a5a' },
  { h: 21.5, sky: '#101a33', horizon: '#3a3352', fog: '#241f38' },
  { h: 24, sky: '#05070f', horizon: '#0a1020', fog: '#0a1020' },
];

/** Brightness ceiling over a dark basemap (Rec. 709 luma of 0..255). */
export const DARK_MAX_LUMA = 90;

const toRgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const toHex = (c: number[]) =>
  '#' +
  c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('');
const mix = (a: string, b: string, t: number) => {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};
const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Scales all channels by one factor, so a capped day sky stays blue. */
function cap(hex: string, max: number): string {
  const c = toRgb(hex);
  const l = luma(c);
  return l <= max ? hex : toHex(c.map((v) => (v * max) / l));
}

export interface SkyPaint {
  'sky-color': string;
  'horizon-color': string;
  'fog-color': string;
  'sky-horizon-blend': number;
  'horizon-fog-blend': number;
  'fog-ground-blend': number;
}

/** The sky for an hour (13.5 = 13:30; wraps) over a light or dark basemap. */
export function skyFor(hour: number, tone: 'light' | 'dark'): SkyPaint {
  const h = (((hour % 24) + 24) % 24) as number;
  let a = SKY_STOPS[0];
  let b = SKY_STOPS[1];
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    if (h >= SKY_STOPS[i].h && h <= SKY_STOPS[i + 1].h) {
      a = SKY_STOPS[i];
      b = SKY_STOPS[i + 1];
      break;
    }
  }
  const t = b.h > a.h ? (h - a.h) / (b.h - a.h) : 0;
  const c = (x: string) => (tone === 'dark' ? cap(x, DARK_MAX_LUMA) : x);
  return {
    'sky-color': c(mix(a.sky, b.sky, t)),
    'horizon-color': c(mix(a.horizon, b.horizon, t)),
    'fog-color': c(mix(a.fog, b.fog, t)),
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.1,
  };
}

export const currentHour = (now = new Date()): number => now.getHours() + now.getMinutes() / 60;
