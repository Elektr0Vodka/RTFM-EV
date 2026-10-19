import { describe, expect, it } from 'vitest';

import type { LiveEntry } from '../../wardrive/liveLog';
import { followView, liveGeoJson, trailGeoJson } from '../../wardrive/map/liveLayers';
import { tierColor } from '../../wardrive/signal';

const entry = (id: number, over: Partial<LiveEntry> = {}): LiveEntry => ({
  id,
  at: id,
  rssi: -85,
  snr: 4,
  payloadType: 5,
  typeName: 'GroupText',
  direct: false,
  hops: 1,
  lat: 52,
  lon: 5,
  kept: true,
  ...over,
});

describe('wardrive live layers', () => {
  it('places receptions with a position, coloured by tier', () => {
    const g = liveGeoJson([entry(1), entry(2, { lat: null, lon: null })], null, false);
    expect(g.points.features).toHaveLength(1);
    expect(g.points.features[0].geometry.coordinates).toEqual([5, 52]);
    expect(g.points.features[0].properties).toMatchObject({
      id: 1,
      kept: true,
      color: tierColor('warm', false),
    });
    expect(g.selected.features).toHaveLength(0);
  });

  it('uses the colourblind ramp in colourblind mode', () => {
    const g = liveGeoJson([entry(1)], null, true);
    expect(g.points.features[0].properties?.color).toBe(tierColor('warm', true));
  });

  it('marks the selected reception', () => {
    const g = liveGeoJson([entry(1), entry(2)], 2, false);
    expect(g.selected.features).toHaveLength(1);
    expect(g.selected.features[0].properties?.id).toBe(2);
  });

  it('draws the trail as one line', () => {
    const g = trailGeoJson([
      [5, 52],
      [5, 52.001],
    ]);
    expect(g.features).toHaveLength(1);
    expect(g.features[0].geometry.type).toBe('LineString');
  });

  it('follow zooms in from country zoom and keeps a zoom the driver chose', () => {
    expect(followView(8, false)).toEqual({ zoom: 15, pitch: 0, bearing: 0 });
    expect(followView(14, false).zoom).toBe(14);
    expect(followView(17, false).zoom).toBe(17);
  });

  it('follow keeps the 3D pitch so it does not cut the tilt short', () => {
    expect(followView(15, true).pitch).toBe(60);
    expect(followView(15, false).pitch).toBe(0);
  });
});
