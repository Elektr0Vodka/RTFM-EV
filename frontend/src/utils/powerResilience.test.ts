import { describe, expect, it } from 'vitest';
import { computeResilience, type ResilienceNode } from './powerResilience';

const nodes: ResilienceNode[] = [
  { key: 'a', power: 'Battery' },
  { key: 'b', power: 'SolarBattery' },
  { key: 'c', power: 'Solar' },
  { key: 'd', power: 'Mains' },
  { key: 'e', power: 'Battery' },
  { key: 'f', power: 'Unknown' },
];

describe('computeResilience', () => {
  it('counts survivors and dark nodes', () => {
    const r = computeResilience(nodes, []);
    expect(r.survivors).toBe(4);
    expect(r.dark).toBe(2);
    // No links: every survivor is its own island.
    expect(r.islandSizes).toEqual([1, 1, 1, 1]);
    expect(r.islandOf.has('d')).toBe(false);
    expect(r.islandOf.has('f')).toBe(false);
  });

  it('splits the mesh where a mains node drops out', () => {
    // a - b - d(mains) - c - e : losing d cuts the chain in two.
    const r = computeResilience(nodes, [
      { a: 'a', b: 'b' },
      { a: 'b', b: 'd' },
      { a: 'd', b: 'c' },
      { a: 'c', b: 'e' },
    ]);
    expect(r.links).toBe(4);
    expect(r.survivingLinks).toBe(2);
    expect(r.islandSizes).toEqual([2, 2]);
    expect(r.islandOf.get('a')).toBe(r.islandOf.get('b'));
    expect(r.islandOf.get('c')).toBe(r.islandOf.get('e'));
    expect(r.islandOf.get('a')).not.toBe(r.islandOf.get('c'));
  });

  it('ignores duplicate, reversed, self and unknown-endpoint links', () => {
    const r = computeResilience(nodes, [
      { a: 'a', b: 'b' },
      { a: 'b', b: 'a' },
      { a: 'a', b: 'a' },
      { a: 'a', b: 'zz' },
    ]);
    expect(r.links).toBe(1);
    expect(r.survivingLinks).toBe(1);
    expect(r.islandSizes[0]).toBe(2);
  });

  it('numbers the largest island 1', () => {
    const r = computeResilience(nodes, [
      { a: 'c', b: 'e' },
      { a: 'e', b: 'b' },
    ]);
    expect(r.islandSizes).toEqual([3, 1]);
    expect(r.islandOf.get('c')).toBe(1);
    expect(r.islandOf.get('a')).toBe(2);
  });
});
