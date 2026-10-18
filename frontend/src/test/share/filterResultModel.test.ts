import { describe, expect, it } from 'vitest';
import {
  buildFilterResult,
  snmpCounterBins,
  snmpCounterTotals,
} from '../../share/cards/filterResult';
import type { SnmpHistoryEntry } from '../../types';

const row = (timestamp: number, values: Record<string, number | null>): SnmpHistoryEntry => ({
  timestamp,
  values,
});

describe('snmpCounterTotals', () => {
  it('sums increases and counts the value after a reset', () => {
    const totals = snmpCounterTotals(
      [
        row(0, { drops: 10 }),
        row(60, { drops: 15 }),
        row(120, { drops: 3 }), // reboot: counter restarted, 3 new drops
        row(180, { drops: 7 }),
      ],
      ['drops']
    );
    expect(totals.drops).toBe(5 + 3 + 4);
  });

  it('leaves out a counter the node never reported', () => {
    const totals = snmpCounterTotals(
      [row(0, { a: 1, b: null }), row(60, { a: 2, b: null })],
      ['a', 'b']
    );
    expect(totals.a).toBe(1);
    expect(totals.b).toBeNull();
  });

  it('skips polls where the value is missing', () => {
    const totals = snmpCounterTotals(
      [row(0, { a: 1 }), row(60, { a: null }), row(120, { a: 4 })],
      ['a']
    );
    expect(totals.a).toBe(3);
  });
});

describe('snmpCounterBins', () => {
  it('spreads the increases over equal time bins and keeps the total', () => {
    const history = [
      row(0, { a: 0, b: 0 }),
      row(100, { a: 2, b: 1 }),
      row(200, { a: 2, b: 5 }),
      row(300, { a: 9, b: 5 }),
    ];
    const bins = snmpCounterBins(history, ['a', 'b'], 3);
    expect(bins).toEqual([3, 4, 7]);
    const totals = snmpCounterTotals(history, ['a', 'b']);
    expect(bins.reduce((s, v) => s + v, 0)).toBe((totals.a ?? 0) + (totals.b ?? 0));
  });
});

describe('buildFilterResult', () => {
  it('keeps non-zero reasons, largest first, and totals them', () => {
    const m = buildFilterResult(
      [
        { key: 'a', label: 'A', value: 2 },
        { key: 'b', label: 'B', value: 0 },
        { key: 'c', label: 'C', value: 9 },
        { key: 'd', label: 'D', value: null },
      ],
      { airtimeMs: 1200, bins: [1, 10] }
    );
    expect(m.reasons.map((r) => r.key)).toEqual(['c', 'a']);
    expect(m.total).toBe(11);
    expect(m.airtimeMs).toBe(1200);
    expect(m.bins).toEqual([1, 10]);
  });
});
