import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { mergeSignalSeries } from '../components/repeater/neighborSignalUtils';
import { NeighborSnrSparkline } from '../components/repeater/NeighborSnrSparkline';

describe('mergeSignalSeries', () => {
  it('merges by observed_at and sorts ascending', () => {
    const merged = mergeSignalSeries(
      [
        { observed_at: 20, snr: 2 },
        { observed_at: 10, snr: 1 },
      ],
      [{ observed_at: 10, snr: 5 }]
    );
    expect(merged).toEqual([
      { observed_at: 10, repeater_snr: 1, self_snr: 5 },
      { observed_at: 20, repeater_snr: 2 },
    ]);
  });

  it('handles empty inputs', () => {
    expect(mergeSignalSeries([], [])).toEqual([]);
  });
});

describe('NeighborSnrSparkline', () => {
  it('renders a polyline with >= 2 samples', () => {
    const { container } = render(
      <NeighborSnrSparkline
        samples={[
          { observed_at: 1, snr: 1 },
          { observed_at: 2, snr: 5 },
        ]}
      />
    );
    expect(container.querySelector('polyline')).not.toBeNull();
  });

  it('renders nothing with < 2 samples', () => {
    const { container } = render(<NeighborSnrSparkline samples={[{ observed_at: 1, snr: 1 }]} />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});
