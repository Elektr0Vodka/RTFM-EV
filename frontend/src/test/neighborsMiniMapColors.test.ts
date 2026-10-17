import { describe, expect, it } from 'vitest';

import { snrStepExpr } from '../components/NeighborsMiniMap';

describe('NeighborsMiniMap SNR colours', () => {
  it('keeps today’s red / yellow / green steps by default', () => {
    expect(snrStepExpr()).toEqual(['step', ['get', 'snr'], '#ef4444', 0, '#eab308', 6, '#22c55e']);
  });

  it('uses the given signal stops', () => {
    expect(snrStepExpr({ bad: '#010203', mid: '#040506', good: '#0a0b0c' })).toEqual([
      'step',
      ['get', 'snr'],
      '#010203',
      0,
      '#040506',
      6,
      '#0a0b0c',
    ]);
  });
});
