import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BarChart, hasRxErrorData, rxErrorBins } from '../components/MyNodeView';
import type { AirtimeSample } from '../types';

const samples: AirtimeSample[] = [
  { timestamp: 1_700_000_000, tx_pct: 1, rx_pct: 2, rx_errors: 3 },
  { timestamp: 1_700_000_060, tx_pct: 1, rx_pct: 2, rx_errors: null },
  { timestamp: 1_700_000_120, tx_pct: 1, rx_pct: 2, rx_errors: 5 },
];

describe('My Node receive-error chart data', () => {
  it('maps airtime bins to bar-chart bins with unknown counters drawn as 0', () => {
    const bins = rxErrorBins(samples);
    expect(bins.map((b) => b.packets)).toEqual([3, 0, 5]);
    expect(bins[0].time).toBe(1_700_000_000_000);
  });

  it('reports whether any bin carried the counter', () => {
    expect(hasRxErrorData(samples)).toBe(true);
    expect(hasRxErrorData([{ timestamp: 1, tx_pct: 0, rx_pct: 0, rx_errors: null }])).toBe(false);
    expect(hasRxErrorData([{ timestamp: 1, tx_pct: 0, rx_pct: 0 }])).toBe(false);
  });

  it('renders one bar per bin', () => {
    const { container } = render(
      <BarChart
        bins={rxErrorBins(samples)}
        valueKey="packets"
        id="rx-errors"
        windowSeconds={3600}
      />
    );
    // Data bars carry the gradient fill; hover zones are transparent.
    const bars = container.querySelectorAll('rect[fill^="url(#rx-errors"]');
    expect(bars.length).toBe(3);
  });
});
