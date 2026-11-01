import { describe, expect, it } from 'vitest';

import type { Fix } from '../../wardrive/messages';
import { Trail } from '../../wardrive/trail';

// 0.000027 degrees of latitude is about 3 m; 0.000054 about 6 m.
const fix = (lat: number): Fix => ({ lat, lon: 5, accM: 5, at: 0 });

describe('wardrive trail', () => {
  it('adds a point only after 5 m of movement', () => {
    const t = new Trail();
    expect(t.push(fix(52))).toBe(true);
    expect(t.push(fix(52.000027))).toBe(false);
    expect(t.push(fix(52.000054))).toBe(true);
    expect(t.points()).toEqual([
      [5, 52],
      [5, 52.000054],
    ]);
  });

  it('clears', () => {
    const t = new Trail();
    t.push(fix(52));
    t.clear();
    expect(t.points()).toEqual([]);
  });
});
