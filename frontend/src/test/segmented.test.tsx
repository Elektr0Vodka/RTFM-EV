import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedPills, type SegmentedOption } from '../components/ui/segmented';

const options: SegmentedOption[] = [
  { value: 'all', label: 'All', count: 5, unread: 'none' },
  { value: 'companions', label: 'Companions', count: 3, unread: 'mention' },
  { value: 'repeaters', label: 'Repeaters', count: 2, unread: 'unread' },
];

describe('SegmentedPills', () => {
  it('renders a radiogroup with one checked pill and shows counts', () => {
    render(<SegmentedPills ariaLabel="Filter" options={options} value="all" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Filter' })).toBeTruthy();
    const all = screen.getByRole('radio', { name: /All/ });
    expect(all.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('calls onChange when a pill is clicked', () => {
    const onChange = vi.fn();
    render(<SegmentedPills ariaLabel="Filter" options={options} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Repeaters/ }));
    expect(onChange).toHaveBeenCalledWith('repeaters');
  });

  it('shows an unread dot only on pills with unread or mention state', () => {
    render(<SegmentedPills ariaLabel="Filter" options={options} value="all" onChange={() => {}} />);
    expect(screen.getAllByTestId('pill-unread-dot')).toHaveLength(2);
  });

  it('moves selection with ArrowRight', () => {
    const onChange = vi.fn();
    render(<SegmentedPills ariaLabel="Filter" options={options} value="all" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /All/ }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('companions');
  });
});
