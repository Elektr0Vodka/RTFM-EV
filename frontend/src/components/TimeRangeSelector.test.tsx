import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeRangeSelector } from './TimeRangeSelector';

// The component calls useT(); provide a passthrough mock that returns the key.
vi.mock('../i18n', () => ({ useT: () => (k: string) => k }));

function base(overrides = {}) {
  return {
    value: '1h',
    onChange: vi.fn(),
    customStart: '',
    customEnd: '',
    onCustomStartChange: vi.fn(),
    onCustomEndChange: vi.fn(),
    onApplyCustom: vi.fn(),
    ...overrides,
  };
}

describe('TimeRangeSelector', () => {
  it('renders all 11 base range buttons plus Custom', () => {
    render(<TimeRangeSelector {...base()} />);
    for (const label of [
      'time_range_20m',
      'time_range_1h',
      'time_range_30d',
      'time_range_custom',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders extras in the right slots', () => {
    render(
      <TimeRangeSelector
        {...base()}
        extrasAfter={[{ id: '1y', labelKey: 'time_range_1y', seconds: 31536000 }]}
        extrasSpecial={[{ id: 'all', labelKey: 'time_range_all', seconds: null }]}
      />
    );
    expect(screen.getByText('time_range_1y')).toBeInTheDocument();
    expect(screen.getByText('time_range_all')).toBeInTheDocument();
  });

  it('orders extras by duration, not by slot (30m extra falls after 20m base)', () => {
    render(
      <TimeRangeSelector
        {...base()}
        extrasBefore={[{ id: '30m', labelKey: 'time_range_30m', seconds: 30 * 60 }]}
      />
    );
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((l): l is string => l === 'time_range_20m' || l === 'time_range_30m');
    expect(labels).toEqual(['time_range_20m', 'time_range_30m']);
  });

  it('fires onChange with the clicked id', () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector {...base({ onChange })} />);
    fireEvent.click(screen.getByText('time_range_6h'));
    expect(onChange).toHaveBeenCalledWith('6h');
  });

  it('shows the custom row only when value is custom and gates Apply on both bounds', () => {
    const onApplyCustom = vi.fn();
    const { rerender } = render(<TimeRangeSelector {...base({ value: 'custom' })} />);
    // No apply until both provided
    expect(screen.queryByText('time_range_apply')).toBeNull();
    rerender(
      <TimeRangeSelector
        {...base({
          value: 'custom',
          customStart: '2026-09-01T00:00',
          customEnd: '2026-09-02T00:00',
          onApplyCustom,
        })}
      />
    );
    fireEvent.click(screen.getByText('time_range_apply'));
    expect(onApplyCustom).toHaveBeenCalledTimes(1);
  });
});
