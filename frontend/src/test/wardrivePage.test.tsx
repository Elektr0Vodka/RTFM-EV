import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/WardriveMapPage', () => ({
  WardriveMapPage: () => <p>map panel</p>,
}));
vi.mock('../components/WardriveReportsPage', () => ({
  WardriveReportsPage: () => <p>reports panel</p>,
}));

import { WardrivePage } from '../components/WardrivePage';

describe('Tools: Wardrive', () => {
  it('is one page with a Map and a Reports tab', () => {
    const onTab = vi.fn();
    const { rerender } = render(<WardrivePage tab="map" onTab={onTab} />);
    expect(screen.getByRole('heading', { name: 'Wardrive' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Map' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('map panel')).toBeTruthy();
    expect(screen.queryByText('reports panel')).toBeNull();
    const reports = screen.getByRole('tab', { name: 'Reports' });
    fireEvent.mouseDown(reports);
    fireEvent.click(reports);
    expect(onTab).toHaveBeenCalledWith('reports');
    rerender(<WardrivePage tab="reports" onTab={onTab} />);
    expect(screen.getByText('reports panel')).toBeTruthy();
    expect(screen.queryByText('map panel')).toBeNull();
  });

  it('opens the Map tab for anything it does not know', () => {
    render(<WardrivePage tab="nonsense" onTab={vi.fn()} />);
    expect(screen.getByText('map panel')).toBeTruthy();
  });
});
