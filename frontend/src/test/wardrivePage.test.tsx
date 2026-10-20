import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/WardriveMapPage', () => ({
  WardriveMapPage: ({ viewAs }: { viewAs?: { asUser?: number } | null }) => (
    <p>{`map panel${viewAs?.asUser ? ` as ${viewAs.asUser}` : ''}`}</p>
  ),
}));
vi.mock('../components/WardriveDriversPanel', () => ({
  WardriveDriversPanel: ({ onViewAs }: { onViewAs: (v: { asUser: number }) => void }) => (
    <button type="button" onClick={() => onViewAs({ asUser: 3 })}>
      drivers panel
    </button>
  ),
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

  it('has a Drivers tab that opens the map viewing as a driver', () => {
    const onTab = vi.fn();
    const { rerender } = render(<WardrivePage tab="drivers" onTab={onTab} />);
    expect(screen.getByRole('tab', { name: 'Drivers' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'drivers panel' }));
    expect(onTab).toHaveBeenCalledWith('map');
    rerender(<WardrivePage tab="map" onTab={onTab} />);
    expect(screen.getByText('map panel as 3')).toBeTruthy();
  });
});
