import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { MapControls } from '../../map/controls/MapControls';

const renderControls = (props = {}) =>
  render(
    <I18nProvider>
      <MapControls
        fabs={{ layers: true, legend: true }}
        basemaps={[
          { id: 'nova', label: 'map_layer_nova' },
          { id: 'ofm-positron', label: 'map_layer_ofm_positron' },
        ]}
        selectedBasemapId="nova"
        onSelectBasemap={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );

describe('MapControls', () => {
  it('renders only the enabled FABs', () => {
    renderControls({ fabs: { layers: true } });
    expect(screen.getByRole('button', { name: /layers/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /legend/i })).not.toBeInTheDocument();
  });
  it('opens the basemap picker and reports a selection', () => {
    const onSelectBasemap = vi.fn();
    renderControls({ onSelectBasemap });
    fireEvent.click(screen.getByRole('button', { name: /layers/i }));
    fireEvent.click(screen.getByText('OpenFreeMap Positron'));
    expect(onSelectBasemap).toHaveBeenCalledWith('ofm-positron');
  });
});
