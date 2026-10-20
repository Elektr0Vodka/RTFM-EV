import { describe, expect, it } from 'vitest';

import { heatColor, heatImageData, imageCoordinates } from '../../../wardrive/coverage/heat';

const STOPS: [number, number, number][] = [
  [234, 179, 8],
  [249, 115, 22],
  [239, 68, 68],
];

describe('Locate heatmap image', () => {
  it('runs warm to hot along the stops', () => {
    expect(heatColor(0, STOPS)).toEqual([234, 179, 8]);
    expect(heatColor(0.5, STOPS)).toEqual([249, 115, 22]);
    expect(heatColor(1, STOPS)).toEqual([239, 68, 68]);
    expect(heatColor(0.25, STOPS)).toEqual([242, 147, 15]);
  });

  it('leaves low density clear, flips south to the bottom, ramps alpha to 210', () => {
    // 2 rows x 1 col: row 0 (south) dense, row 1 (north) empty.
    const data = heatImageData(new Float32Array([1, 0.05]), 2, 1, STOPS);
    // Image row 0 is north: the empty cell, fully clear.
    expect(data[3]).toBe(0);
    // Image row 1 is south: the peak, alpha 210.
    expect(data[7]).toBe(210);
    expect([data[4], data[5], data[6]]).toEqual([239, 68, 68]);
  });

  it('lays the image over the grid bounds, north-west first', () => {
    expect(imageCoordinates({ minLat: 52, maxLat: 53, minLon: 5, maxLon: 6 })).toEqual([
      [5, 53],
      [6, 53],
      [6, 52],
      [5, 52],
    ]);
  });
});
