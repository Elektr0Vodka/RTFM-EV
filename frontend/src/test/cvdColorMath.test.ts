import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  deltaE2000,
  deltaE2000Lab,
  hexToHslTriplet,
  hslTripletToHex,
  simulateCvd,
} from '../utils/cvd/colorMath';

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

describe('cvd colour math', () => {
  it('collapses pure red and green for a deutan', () => {
    expect(
      deltaE2000(simulateCvd('#ff0000', 'deutan'), simulateCvd('#00ff00', 'deutan'))
    ).toBeLessThan(25);
    // Sanity: without simulation they are far apart.
    expect(deltaE2000('#ff0000', '#00ff00')).toBeGreaterThan(60);
  });

  it.each(['protan', 'deutan', 'tritan'] as const)(
    'leaves grey nearly unchanged for %s',
    (type) => {
      expect(deltaE2000(simulateCvd('#808080', type), '#808080')).toBeLessThan(2);
    }
  );

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#ffffff', '#777777')).toBeCloseTo(4.48, 2);
  });

  // Sharma, Wu and Dalal (2005) CIEDE2000 test data, pairs 1, 7, 17 and 25.
  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ] as const)('matches the CIEDE2000 reference data %#', (lab1, lab2, expected) => {
    expect(deltaE2000Lab([...lab1], [...lab2])).toBeCloseTo(expected, 4);
  });

  it('converts hex to the HSL triplet form of the CSS tokens and back', () => {
    expect(hexToHslTriplet('#22c55e')).toBe('142 71% 45%');
    const back = channels(hslTripletToHex('142 71% 45%'));
    channels('#22c55e').forEach((c, i) => expect(Math.abs(c - back[i])).toBeLessThanOrEqual(2));
  });
});
