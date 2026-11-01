import { describe, expect, it } from 'vitest';

import {
  buildHexFeatures,
  heightFor,
  hexLabel,
  labelPoints,
  pillarFeatures,
  type HexInput,
} from '../../wardrive/map/hexLayer';
import { currentRideStart, isBacklog, showBacklogPoints } from '../../wardrive/map/rides';
import { rssiTier, tierColor } from '../../wardrive/signal';

const at = (over: Partial<HexInput> = {}): HexInput => ({
  at: 0,
  rssi: -90,
  lat: 52.5168,
  lon: 6.083,
  senderId: 'a1b2c3',
  senderKind: 'relay',
  ...over,
});

describe('rides', () => {
  it('starts the current ride after a gap of more than ten minutes', () => {
    expect(currentRideStart([0, 100, 700100, 700200])).toBe(700100);
    expect(currentRideStart([600000, 0])).toBe(0);
    expect(currentRideStart([])).toBeNull();
  });

  it('marks what came before the current ride as backlog', () => {
    expect(isBacklog(50, 700100)).toBe(true);
    expect(isBacklog(700100, 700100)).toBe(false);
    expect(isBacklog(50, null)).toBe(false);
  });

  it('draws backlog points from zoom 12', () => {
    expect(showBacklogPoints(11.9)).toBe(false);
    expect(showBacklogPoints(12)).toBe(true);
  });
});

describe('live hex layer', () => {
  it('gives a cell its strongest signal, colour and height', () => {
    const fc = buildHexFeatures([at({ rssi: -90 }), at({ rssi: -80, at: 1 })], 9, false);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry.coordinates[0]).toHaveLength(7);
    expect(f.properties).toMatchObject({
      rssi: -80,
      color: tierColor(rssiTier(-80), false),
      height: 200,
    });
  });

  it('skips receptions without a position', () => {
    expect(buildHexFeatures([at({ lat: null, lon: null })], 9, false).features).toEqual([]);
  });

  it('labels a cell with the newest prefixes', () => {
    expect(
      hexLabel([
        { id: 'a1b2c3', at: 1 },
        { id: 'd4e5f6aa', at: 2 },
        { id: 'a1b2ff', at: 3 },
        { id: '11223344', at: 4 },
        { id: '55667788', at: 5 },
      ])
    ).toBe('5566 1122 a1b2 +1');
    expect(hexLabel([])).toBe('');
  });

  it('never labels with a 1-byte hash or a channel name', () => {
    const fc = buildHexFeatures(
      [
        at({ senderId: '64', senderKind: 'path_hash' }),
        at({ senderId: '4a', senderKind: 'direct_hash' }),
        at({ senderId: 'Mike', senderKind: 'channel_name' }),
      ],
      9,
      false
    );
    expect(fc.features[0].properties?.label).toBe('');
    expect(labelPoints(fc).features).toEqual([]);
  });

  it('places labels at cell centres', () => {
    const points = labelPoints(buildHexFeatures([at()], 9, false));
    expect(points.features).toHaveLength(1);
    expect(points.features[0].properties?.label).toBe('a1b2');
  });

  it('gives no height without a signal', () => {
    expect(heightFor(null)).toBe(0);
    expect(heightFor(-140)).toBe(0);
    expect(heightFor(-120)).toBe(40);
  });

  it('stands a pillar on each reception', () => {
    const fc = pillarFeatures([at({ rssi: -80 }), at({ rssi: -100, lat: 52.6 })], false);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].properties?.height).toBe(200);
  });

  it('builds thirty thousand receptions quickly', () => {
    const many = Array.from({ length: 30000 }, (_, i) =>
      at({ at: i, lat: 52 + (i % 300) * 0.001, lon: 6 + Math.floor(i / 300) * 0.001 })
    );
    const t0 = performance.now();
    const fc = buildHexFeatures(many, 11, false);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(fc.features.length).toBeGreaterThan(1000);
  });
});
