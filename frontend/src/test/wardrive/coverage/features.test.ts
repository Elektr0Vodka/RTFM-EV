import { describe, expect, it } from 'vitest';

import {
  cellFeatures,
  pillarFeatures,
  pinFeature,
  pointBounds,
  pointFeatures,
  ringFeature,
} from '../../../wardrive/coverage/features';
import type { MapCell } from '../../../wardrive/coverage/types';
import { tierColor } from '../../../wardrive/signal';
import { point } from './fixtures';

const CELL: MapCell = {
  cell: '9:1:2',
  best: -72,
  count: 4,
  drivers: 2,
  ring: [
    [5, 52],
    [5.1, 52],
    [5.1, 52.1],
    [5, 52],
  ],
};

describe('coverage map features', () => {
  it('colours points by their signal tier and keeps their index', () => {
    const fc = pointFeatures([point(), point({ rssi: -120, lat: 52.2 })], false);
    expect(fc.features.map((f) => f.properties)).toEqual([
      { i: 0, color: tierColor('warm', false), op: 1 },
      { i: 1, color: tierColor('faint', false), op: 1 },
    ]);
    expect(fc.features[1].geometry.coordinates).toEqual([5.1, 52.2]);
  });

  it('uses the colourblind ramp when asked', () => {
    expect(pointFeatures([point()], true).features[0].properties?.color).toBe(
      tierColor('warm', true)
    );
  });

  it('stands a pillar per point as tall as its signal', () => {
    const f = pillarFeatures([point({ rssi: -80 })], false).features[0];
    expect(f.properties).toMatchObject({ i: 0, height: 200 });
    expect(f.geometry.coordinates[0]).toHaveLength(7);
  });

  it('draws a cell from its ring, coloured by its best signal', () => {
    const f = cellFeatures([CELL], false).features[0];
    expect(f.geometry.coordinates).toEqual([CELL.ring]);
    expect(f.properties).toMatchObject({
      cell: '9:1:2',
      best: -72,
      count: 4,
      drivers: 2,
      color: tierColor('hot', false),
      height: 232,
      op: 0.55,
      i: 0,
    });
  });

  it('draws nothing for nothing', () => {
    expect(pointFeatures([], false).features).toEqual([]);
    expect(cellFeatures([], false).features).toEqual([]);
    expect(ringFeature(null).features).toEqual([]);
    expect(pointBounds([])).toBeNull();
  });

  it('rings the picked reception and pins a driver', () => {
    expect(ringFeature(point()).features[0].geometry.coordinates).toEqual([5.1, 52.1]);
    expect(pinFeature(52, 5, 'anna').features[0].properties).toEqual({ label: 'anna' });
  });

  it('bounds the points', () => {
    expect(pointBounds([point(), point({ lat: 53, lon: 6 })])).toEqual([
      [5.1, 52.1],
      [6, 53],
    ]);
  });
});
