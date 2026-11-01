import { describe, expect, it } from 'vitest';

import type { LiveEntry } from '../../wardrive/liveLog';
import { followView, liveGeoJson, selectionPan, trailGeoJson } from '../../wardrive/map/liveLayers';
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
  packetType: 'GroupText',
  heardDirect: false,
  sender: { kind: null, id: null, label: null, role: null },
  channel: null,
  text: null,
  stored: false,
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
    // The pitch belongs to the view mode and the bearing to the compass mode.
    expect(followView(8)).toEqual({ zoom: 15 });
    expect(followView(14).zoom).toBe(14);
    expect(followView(17).zoom).toBe(17);
  });

  it('marks what was heard before the current ride as backlog', () => {
    const g = liveGeoJson([entry(1, { at: 100 }), entry(2, { at: 900000 })], null, false, 900000);
    expect(g.points.features.map((f) => f.properties?.backlog)).toEqual([true, false]);
    const none = liveGeoJson([entry(1, { at: 100 })], null, false, null);
    expect(none.points.features[0].properties?.backlog).toBe(false);
  });

  it('pans to a newly selected reception, and again after the selection was cleared', () => {
    const entries = [entry(1, { lat: 52.5, lon: 6.5 }), entry(2, { lat: null, lon: null })];
    expect(selectionPan(null, 1, entries)).toEqual({ pan: [6.5, 52.5], last: 1 });
    expect(selectionPan(1, 1, entries)).toEqual({ pan: null, last: 1 });
    expect(selectionPan(1, null, entries)).toEqual({ pan: null, last: null });
    expect(selectionPan(null, 1, entries).pan).toEqual([6.5, 52.5]);
    expect(selectionPan(null, 2, entries)).toEqual({ pan: null, last: 2 });
  });
});
