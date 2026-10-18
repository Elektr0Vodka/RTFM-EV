import { describe, expect, it } from 'vitest';
import { buildTraceModel } from '../../share/cards/traceRoute';
import type { TraceMapNode } from '../../utils/traceMapUtils';

function node(
  index: number,
  role: TraceMapNode['role'],
  key: string | null,
  loc: [number, number] | null,
  snr: number | null = null
): TraceMapNode {
  return {
    index,
    role,
    publicKey: key,
    name: key,
    snr,
    lat: loc ? loc[0] : null,
    lon: loc ? loc[1] : null,
  };
}

const me = (i: number, snr: number | null = null) => node(i, 'local', 'me', [52, 5], snr);

describe('buildTraceModel', () => {
  it('counts hops without my radio at either end', () => {
    const m = buildTraceModel(
      [
        me(0),
        node(1, 'repeater', 'A', [52.1, 5], 9.5),
        node(2, 'repeater', 'B', [52.2, 5], 2),
        me(3, -1),
      ],
      ['Me', 'A', 'B', 'Me']
    );
    expect(m.hops).toBe(2);
    expect(m.stops).toHaveLength(4);
  });

  it('names the middle hop of an out-and-back trace as the turnaround', () => {
    const m = buildTraceModel(
      [
        me(0),
        node(1, 'repeater', 'A', null),
        node(2, 'repeater', 'B', null),
        node(3, 'repeater', 'A', null),
        me(4),
      ],
      ['Me', 'Alpha', 'Bravo', 'Alpha', 'Me']
    );
    expect(m.turnaroundName).toBe('Bravo');
  });

  it('names the last hop of a one-way trace as the turnaround', () => {
    const m = buildTraceModel(
      [me(0), node(1, 'repeater', 'A', null), node(2, 'repeater', 'B', null), me(3)],
      ['Me', 'Alpha', 'Bravo', 'Me']
    );
    expect(m.turnaroundName).toBe('Bravo');
  });

  it('takes the weakest SNR over the received hops', () => {
    const m = buildTraceModel(
      [
        me(0),
        node(1, 'repeater', 'A', null, 9.5),
        node(2, 'repeater', 'B', null, -11),
        me(3, -12.5),
      ],
      ['Me', 'A', 'B', 'Me']
    );
    expect(m.weakestSnr).toBe(-12.5);
  });

  it('sums only legs with both ends located, including the leg back to me', () => {
    const m = buildTraceModel(
      [me(0), node(1, 'repeater', 'A', [52.1, 5]), node(2, 'custom', null, null), me(3)],
      ['Me', 'A', 'ab', 'Me']
    );
    // Only Me -> A is a located leg (about 11.1 km); A -> ab and ab -> Me are unknown.
    expect(m.pathKm).toBeGreaterThan(10.5);
    expect(m.pathKm).toBeLessThan(11.7);
  });

  it('has no positions and no length when only custom hops ran without my position', () => {
    const m = buildTraceModel(
      [node(0, 'local', 'me', null), node(1, 'custom', null, null), node(2, 'local', 'me', null)],
      ['Me', 'ab', 'Me']
    );
    expect(m.located).toEqual([]);
    expect(m.pathKm).toBeNull();
    expect(m.hops).toBe(1);
  });

  it('treats 0,0 as no position', () => {
    const m = buildTraceModel(
      [
        node(0, 'local', 'me', [0, 0]),
        node(1, 'repeater', 'A', [52, 5]),
        node(2, 'local', 'me', [0, 0]),
      ],
      ['Me', 'A', 'Me']
    );
    expect(m.located).toEqual([{ lat: 52, lon: 5 }]);
    expect(m.pathKm).toBeNull();
  });
});
