// Pure animation math for the live packet map. Framework-agnostic and unit
// tested. Techniques adapted from the DMC-Observers live map (freshness-opacity
// fade, arc-riding pulse, glow strobe), reimplemented for a single observer.

export const PULSE_MS = 1500;
export const GLOW_MS = 400;
export const LINK_FRESH_MS = 60_000;
export const LINK_DIM_MS = 900_000;
export const LINK_FLOOR = 0.15;

export const SPEEDS = [0.5, 1, 2, 4, 8] as const;
export const BUFFER_MAX_MS = 12_000;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Opacity freshness cue: full until `freshMs` old, linear fade to `floor` by
 *  `dimMs`, never below the floor. Negative ages (clock skew) read as full. */
export function livenessOpacity(
  ageMs: number,
  freshMs: number = LINK_FRESH_MS,
  dimMs: number = LINK_DIM_MS,
  floor: number = LINK_FLOOR
): number {
  if (ageMs <= freshMs) return 1;
  if (ageMs >= dimMs) return floor;
  const f = (ageMs - freshMs) / (dimMs - freshMs);
  return 1 - f * (1 - floor);
}

/** Pulse progress 0..1 over `durMs`, clamped. */
export function pulseProgress(startMs: number, nowMs: number, durMs: number = PULSE_MS): number {
  return clamp01((nowMs - startMs) / durMs);
}

/** Interpolate lon/lat linearly while bowing the height on the same semicircle
 *  profile deck.gl's ArcLayer uses, so a dot rides the arc instead of cutting
 *  the chord beneath it. `bow` overrides the default chord-proportional height. */
export function pulsePosition(
  a: [number, number],
  b: [number, number],
  t: number,
  bow: number = 0
): [number, number, number] {
  const lon = a[0] + (b[0] - a[0]) * t;
  const lat = a[1] + (b[1] - a[1]) * t;
  const h = 2 * Math.sqrt(Math.max(0, t * (1 - t)));
  const chord = bow || haversineMeters(a, b) * 0.15;
  return [lon, lat, h * chord];
}

/** Glow strobe intensity 1..0 over `durMs`; 1 at or before receive, 0 after. */
export function glowIntensity(ageMs: number, durMs: number = GLOW_MS): number {
  if (ageMs < 0) return 1;
  if (ageMs >= durMs) return 0;
  return 1 - ageMs / durMs;
}

/** SNR colour ramp: amber (low) -> blue (mid) -> green (high). Unknown SNR maps
 *  to a neutral grey. Returns an [r,g,b] triple for deck.gl. */
export function snrColor(snr: number | null | undefined): [number, number, number] {
  if (snr == null || Number.isNaN(snr)) return [150, 150, 150];
  const stops: Array<[number, [number, number, number]]> = [
    [-20, [245, 158, 11]],
    [0, [59, 130, 246]],
    [10, [34, 197, 94]],
  ];
  if (snr <= stops[0][0]) return stops[0][1];
  if (snr >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i + 1 < stops.length; i++) {
    const [x0, c0] = stops[i];
    const [x1, c1] = stops[i + 1];
    if (snr >= x0 && snr <= x1) {
      const f = (snr - x0) / (x1 - x0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return [150, 150, 150];
}

/** Parse a #rrggbb (or #rgb) hex colour into an [r,g,b] triple for deck.gl. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || '').replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const la1 = a[1] * toRad;
  const la2 = b[1] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
