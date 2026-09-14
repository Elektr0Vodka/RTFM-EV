import { describe, it, expect } from 'vitest';
import { computeWrongLocationKeys } from '../../map/wrongLocation';
import type { AdvertLinkEdge } from '../../types';

function edge(
  a: { pubkey: string; lat: number; lon: number },
  b: { pubkey: string; lat: number; lon: number }
): AdvertLinkEdge {
  return {
    a: { ...a, kind: 'contact' },
    b: { ...b, kind: 'contact' },
    hop_width: 3,
    count: 1,
    last_seen: 0,
    ambiguous: false,
  };
}

describe('computeWrongLocationKeys', () => {
  // A and B are ~11 km apart (plausible RF neighbours). C is on the other side
  // of the planet, so its nearest neighbour is far beyond 300 km.
  const A = { pubkey: 'aa', lat: 52.0, lon: 5.0 };
  const B = { pubkey: 'bb', lat: 52.1, lon: 5.0 };
  const C = { pubkey: 'cc', lat: 0.0, lon: 100.0 };

  it('flags a node whose nearest neighbour is beyond the threshold', () => {
    const wrong = computeWrongLocationKeys([edge(A, B), edge(A, C), edge(B, C)]);
    expect(wrong.has('cc')).toBe(true);
  });

  it('does not flag a node with a neighbour within the threshold', () => {
    const wrong = computeWrongLocationKeys([edge(A, B), edge(A, C), edge(B, C)]);
    expect(wrong.has('aa')).toBe(false);
    expect(wrong.has('bb')).toBe(false);
  });

  it('does not flag a node that has no edge (fail-open)', () => {
    const wrong = computeWrongLocationKeys([edge(A, B)]);
    expect(wrong.has('zz')).toBe(false);
  });

  it('lowercases pubkeys in the result', () => {
    const wrong = computeWrongLocationKeys([
      edge({ pubkey: 'AA', lat: 52.0, lon: 5.0 }, { pubkey: 'CC', lat: 0.0, lon: 100.0 }),
    ]);
    expect(wrong.has('aa')).toBe(true);
    expect(wrong.has('cc')).toBe(true);
  });
});
