// The radio's noise floor where it was read (useRadioStats, every 10 s or
// 50 m), as rings on the live map. A quieter floor means weaker signals can
// still be heard there, so quiet is the good end of the scale.
import type { NoiseReading } from '../useRadioStats';

export type NoiseLevel = 'quiet' | 'fair' | 'noisy' | 'loud';

/** Upper bounds (dBm) of the bands. A LoRa radio's floor sits around -120
 * dBm in a quiet place; -100 and above is a noisy place. */
const QUIET_MAX = -115;
const FAIR_MAX = -105;
const NOISY_MAX = -95;

export function noiseLevel(noise: number): NoiseLevel {
  if (noise <= QUIET_MAX) return 'quiet';
  if (noise <= FAIR_MAX) return 'fair';
  if (noise <= NOISY_MAX) return 'noisy';
  return 'loud';
}

const NORMAL: Record<NoiseLevel, string> = {
  quiet: '#16a34a',
  fair: '#eab308',
  noisy: '#f97316',
  loud: '#dc2626',
};
// Okabe-Ito, told apart without red-green.
const CVD: Record<NoiseLevel, string> = {
  quiet: '#0072b2',
  fair: '#56b4e9',
  noisy: '#e69f00',
  loud: '#d55e00',
};

export function noiseColor(level: NoiseLevel, cvd: boolean): string {
  return (cvd ? CVD : NORMAL)[level];
}

export function noiseFeatures(readings: NoiseReading[], cvd: boolean) {
  const features = [];
  for (const r of readings) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isFinite(r.noise)) continue;
    const level = noiseLevel(r.noise);
    features.push({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [r.lon, r.lat] },
      properties: { noise: r.noise, level, color: noiseColor(level, cvd) },
    });
  }
  return { type: 'FeatureCollection' as const, features };
}
