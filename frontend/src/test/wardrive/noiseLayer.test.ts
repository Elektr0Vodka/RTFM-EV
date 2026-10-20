import { describe, expect, it } from 'vitest';

import { noiseColor, noiseFeatures, noiseLevel } from '../../wardrive/map/noiseLayer';

describe('noise layer', () => {
  it('bands the noise floor, quieter is better', () => {
    expect(noiseLevel(-121)).toBe('quiet');
    expect(noiseLevel(-112)).toBe('fair');
    expect(noiseLevel(-101)).toBe('noisy');
    expect(noiseLevel(-90)).toBe('loud');
  });

  it('gives each band its own colour, in both palettes', () => {
    const levels = ['quiet', 'fair', 'noisy', 'loud'] as const;
    for (const cvd of [false, true]) {
      const colours = levels.map((l) => noiseColor(l, cvd));
      expect(new Set(colours).size).toBe(4);
    }
    expect(noiseColor('quiet', false)).not.toBe(noiseColor('quiet', true));
  });

  it('makes one point per reading with its level and colour', () => {
    const fc = noiseFeatures(
      [
        { lat: 52, lon: 5, noise: -118, at: 1 },
        { lat: 52.1, lon: 5.1, noise: -92, at: 2 },
        { lat: Number.NaN, lon: 5, noise: -100, at: 3 },
      ],
      false
    );
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5, 52] },
      properties: { noise: -118, level: 'quiet', color: noiseColor('quiet', false) },
    });
    expect(fc.features[1].properties.level).toBe('loud');
  });
});
