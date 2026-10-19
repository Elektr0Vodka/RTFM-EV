import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { MapErrorBoundary } from '../../wardrive/screen/MapErrorBoundary';

function Broken(): never {
  throw new Error('chunk failed to load');
}

describe('wardrive map error boundary', () => {
  it('keeps the page up when the map fails and offers a retry', () => {
    const onRetry = vi.fn();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <I18nProvider>
        <p>hud still here</p>
        <MapErrorBoundary onRetry={onRetry}>
          <Broken />
        </MapErrorBoundary>
      </I18nProvider>
    );
    expect(screen.getByText('hud still here')).toBeTruthy();
    expect(screen.getByText('The map could not load.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('shows the map when nothing fails', () => {
    render(
      <I18nProvider>
        <MapErrorBoundary onRetry={() => {}}>
          <p>map</p>
        </MapErrorBoundary>
      </I18nProvider>
    );
    expect(screen.getByText('map')).toBeTruthy();
  });
});
