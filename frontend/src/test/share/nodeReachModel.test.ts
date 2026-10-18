import { describe, expect, it } from 'vitest';
import { buildNodeReachModel, type ReachNeighbor } from '../../share/cards/nodeReach';
import { CONTACT_TYPE_REPEATER, type Contact } from '../../types';

const n = (
  key: string,
  loc: [number, number] | null,
  snr: number | null,
  firstSeen: number | null = null
): ReachNeighbor => ({
  public_key: key,
  name: key.toUpperCase(),
  first_seen: firstSeen,
  lat: loc?.[0] ?? null,
  lon: loc?.[1] ?? null,
  best_snr: snr,
});

const repeater = { public_key: 'r1', type: CONTACT_TYPE_REPEATER } as Contact;

describe('buildNodeReachModel', () => {
  it('counts every neighbour but places only those with a position', () => {
    const m = buildNodeReachModel(
      [n('a', [52.1, 5], 4), n('b', null, -2), n('c', [0, 0], 1)],
      { lat: 52, lon: 5 },
      []
    );
    expect(m.count).toBe(3);
    expect(m.nodes.filter((x) => x.point)).toHaveLength(1);
  });

  it('gives the furthest located neighbour from my position', () => {
    const m = buildNodeReachModel(
      [n('a', [52.1, 5], 4), n('b', [52.5, 5], 1)],
      { lat: 52, lon: 5 },
      []
    );
    expect(m.furthestKm).toBeGreaterThan(55);
    expect(m.furthestKm).toBeLessThan(56.2);
  });

  it('has no furthest distance without my position', () => {
    const m = buildNodeReachModel([n('a', [52.1, 5], 4)], { lat: 0, lon: 0 }, []);
    expect(m.center).toBeNull();
    expect(m.furthestKm).toBeNull();
  });

  it('takes the median of the known SNRs', () => {
    const m = buildNodeReachModel(
      [n('a', null, 4), n('b', null, -2), n('c', null, 10), n('d', null, null)],
      null,
      []
    );
    expect(m.medianSnr).toBe(4);
  });

  it('counts repeaters from the contacts', () => {
    const m = buildNodeReachModel([n('r1', null, 4), n('x', null, 1)], null, [repeater]);
    expect(m.repeaters).toBe(1);
  });

  it('orders neighbours by when they were first heard', () => {
    const m = buildNodeReachModel(
      [n('late', null, 1, 300), n('unknown', null, 1, null), n('early', null, 1, 100)],
      null,
      []
    );
    expect(m.nodes.map((x) => x.name)).toEqual(['EARLY', 'LATE', 'UNKNOWN']);
  });

  it('marks the 50-neighbour cap', () => {
    const many = Array.from({ length: 50 }, (_, i) => n(`k${i}`, null, 1));
    expect(buildNodeReachModel(many, null, []).capped).toBe(true);
    expect(buildNodeReachModel(many.slice(1), null, []).capped).toBe(false);
  });
});
