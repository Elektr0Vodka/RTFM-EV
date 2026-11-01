import { describe, expect, it } from 'vitest';

import {
  COMPASS_STALE_MS,
  arrowFor,
  arrowTarget,
  bearingDeg,
  courseHeading,
  estimateFor,
  headingFor,
  nextHeadingSource,
  relativeAngle,
} from '../../wardrive/arrow';
import type { Sender } from '../../wardrive/decode/reception';
import type { Fix } from '../../wardrive/messages';
import { NodeDirectory, distanceKm, type DirectoryNode } from '../../wardrive/names';

const NOW = Date.UTC(2026, 9, 20, 10, 0, 0);
const key = (prefix: string) => (prefix + '0'.repeat(64)).slice(0, 64);
const sender = (kind: Sender['kind'], id: string | null): Sender => ({
  kind,
  id,
  label: null,
  role: null,
});
function node(publicKey: string, over: Partial<DirectoryNode> = {}): DirectoryNode {
  return { publicKey, name: null, role: null, lat: null, lon: null, seen: null, ...over };
}
const fix = (over: Partial<Fix> = {}): Fix => ({ lat: 52, lon: 6, accM: 5, at: NOW, ...over });

describe('bearing and angle', () => {
  it('points north and east', () => {
    expect(bearingDeg({ lat: 52, lon: 5 }, { lat: 53, lon: 5 })).toBeCloseTo(0, 3);
    expect(bearingDeg({ lat: 52, lon: 5 }, { lat: 52, lon: 5.1 })).toBeCloseTo(90, 0);
    expect(bearingDeg({ lat: 52, lon: 5 }, { lat: 51, lon: 5 })).toBeCloseTo(180, 3);
  });

  it('turns a bearing into an angle from the heading', () => {
    expect(relativeAngle(10, 350)).toBe(20);
    expect(relativeAngle(350, 10)).toBe(-20);
    expect(relativeAngle(190, 10)).toBe(180);
  });
});

describe('heading', () => {
  it('switches to the GPS course from 2 m/s and back to the compass below 1 m/s', () => {
    expect(nextHeadingSource('compass', 2.5)).toBe('course');
    expect(nextHeadingSource('course', 1.5)).toBe('course');
    expect(nextHeadingSource('compass', 1.5)).toBe('compass');
    expect(nextHeadingSource('course', 0.5)).toBe('compass');
    expect(nextHeadingSource('compass', null)).toBe('compass');
    expect(nextHeadingSource('course', null)).toBe('course');
  });

  it('reads the heading from its source', () => {
    expect(headingFor('compass', 90, { deg: 45, at: NOW - 2500 }, NOW)).toBeNull();
    expect(headingFor('compass', 90, { deg: 45, at: NOW - COMPASS_STALE_MS }, NOW)).toBe(45);
    expect(headingFor('compass', 90, null, NOW)).toBeNull();
    expect(headingFor('course', 90, null, NOW)).toBe(90);
    expect(headingFor('course', null, null, NOW)).toBeNull();
  });

  it('holds the course when slow or when the fix has none', () => {
    expect(courseHeading(120, 80, 1)).toBe(80);
    expect(courseHeading(null, 80, 5)).toBe(80);
    expect(courseHeading(120, 80, 5)).toBe(120);
    expect(courseHeading(120, null, null)).toBeNull();
  });
});

describe('estimateFor', () => {
  const centre = { lat: 52, lon: 6 };
  const around = [
    { lat: 52.001, lon: 6, rssi: -90 },
    { lat: 51.999, lon: 6, rssi: -90 },
    { lat: 52, lon: 6.0016, rssi: -90 },
    { lat: 52, lon: 5.9984, rssi: -90 },
  ];

  it('needs at least 3 places', () => {
    expect(estimateFor(around.slice(0, 2))).toBeNull();
  });

  it('lands near the middle of where it was heard', () => {
    const est = estimateFor(around);
    expect(est).not.toBeNull();
    expect(distanceKm(centre, est!)).toBeLessThan(0.05);
  });

  it('ignores a far outlier', () => {
    const est = estimateFor([...around, { lat: 52.9, lon: 6, rssi: -50 }]);
    expect(distanceKm(centre, est!)).toBeLessThan(0.05);
  });

  it('counts points within 10 m of each other once', () => {
    const twoCells = [
      { lat: 52.001, lon: 6, rssi: -90 },
      { lat: 52.002, lon: 6, rssi: -100 },
      { lat: 52.000005 + 0.002, lon: 6, rssi: -110 },
    ];
    expect(estimateFor(twoCells)).toBeNull();
    expect(estimateFor([...twoCells, { lat: 52.003, lon: 6, rssi: -90 }])).not.toBeNull();
  });
});

describe('arrowTarget', () => {
  it('has none for a channel sender or a collision', () => {
    const dir = new NodeDirectory([]);
    expect(arrowTarget(sender('channel_name', 'Mike'), null, dir, [])).toBeNull();
    expect(
      arrowTarget(sender('relay', 'a1b2'), { rule: 'collision', count: 2 }, dir, [])
    ).toBeNull();
  });

  it('points at a placed node', () => {
    const toren = node(key('a1b2'), { lat: 52.1, lon: 6.1 });
    const dir = new NodeDirectory([toren]);
    expect(arrowTarget(sender('relay', 'a1b2'), { rule: 'node', node: toren }, dir, [])).toEqual({
      lat: 52.1,
      lon: 6.1,
      kind: 'advertised',
    });
  });

  it('points at the one positioned node with an advert key', () => {
    const dir = new NodeDirectory([node(key('cc'), { lat: 52.2, lon: 6.2 })]);
    expect(arrowTarget(sender('advert_pubkey', key('cc')), null, dir, [])).toMatchObject({
      kind: 'advertised',
      lat: 52.2,
    });
  });

  it('falls back to an estimate from where the sender was heard', () => {
    const dir = new NodeDirectory([]);
    const heard = [
      { lat: 52.001, lon: 6, rssi: -90 },
      { lat: 51.999, lon: 6, rssi: -90 },
      { lat: 52, lon: 6.0016, rssi: -90 },
      { lat: null, lon: null, rssi: -90 },
    ];
    expect(
      arrowTarget(sender('path_hash', '64'), { rule: 'estimate', prefixKnown: false }, dir, heard)
    ).toMatchObject({ kind: 'estimate' });
  });
});

describe('arrowFor', () => {
  const east = { lat: 52, lon: 6.1, kind: 'advertised' as const };

  it('needs a target, a fresh fix and a heading', () => {
    expect(arrowFor(null, fix(), 0, NOW)).toBeNull();
    expect(arrowFor(east, fix({ at: NOW - 11000 }), 0, NOW)).toBeNull();
    expect(arrowFor(east, fix(), null, NOW)).toBeNull();
    expect(arrowFor(east, fix(), Number.NaN, NOW)).toBeNull();
  });

  it('turns the bearing by the heading', () => {
    const a = arrowFor(east, fix(), 0, NOW);
    expect(a?.kind).toBe('advertised');
    expect(a?.angle).toBeCloseTo(90, 0);
  });
});
