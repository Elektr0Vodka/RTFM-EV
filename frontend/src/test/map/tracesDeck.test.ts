import { describe, it, expect } from 'vitest';
import { arcRows } from '../../map/layers/tracesDeck';

describe('arcRows', () => {
  it('builds source/target rows from consecutive hop points', () => {
    const rows = arcRows(
      [
        { lon: 5, lat: 52 },
        { lon: 6, lat: 53 },
        { lon: 7, lat: 54 },
      ],
      [255, 0, 0]
    );
    expect(rows).toEqual([
      { s: [5, 52, 0], t: [6, 53, 0], color: [255, 0, 0] },
      { s: [6, 53, 0], t: [7, 54, 0], color: [255, 0, 0] },
    ]);
  });

  it('returns [] for a single point', () => {
    expect(arcRows([{ lon: 5, lat: 52 }], [0, 0, 0])).toEqual([]);
  });

  it('returns [] for no points', () => {
    expect(arcRows([], [0, 0, 0])).toEqual([]);
  });
});
