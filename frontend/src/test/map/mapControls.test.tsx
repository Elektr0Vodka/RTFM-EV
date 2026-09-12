import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../map/controls/breakpoints', async (orig) => ({
  ...(await orig<typeof import('../../map/controls/breakpoints')>()),
  useIsCompactMap: vi.fn(() => false),
}));

import { I18nProvider } from '../../i18n/I18nProvider';
import { MapControls } from '../../map/controls/MapControls';
import { useIsCompactMap } from '../../map/controls/breakpoints';

const mockCompact = useIsCompactMap as unknown as ReturnType<typeof vi.fn>;

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
    </I18nProvider>
  );

beforeEach(() => {
  mockCompact.mockReturnValue(false);
});

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

  it('gives every FAB a title tooltip', () => {
    renderControls();
    expect(screen.getByRole('button', { name: /layers/i })).toHaveAttribute('title', 'Layers');
    expect(screen.getByRole('button', { name: /legend/i })).toHaveAttribute('title', 'Legend');
  });

  it('shows link mode radios, and confidence only in advert mode', () => {
    const onLinkMode = vi.fn();
    renderControls({
      fabs: { links: true },
      linksOn: true,
      linkMode: 'liveness',
      onLinkMode,
      linkConfidence: 2,
    });
    // Open the Links panel via its FAB (aria-label = "Links").
    fireEvent.click(screen.getByRole('button', { name: 'Links' }));
    expect(screen.getByRole('radio', { name: 'Liveness' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Advert paths' }));
    expect(onLinkMode).toHaveBeenCalledWith('advert');
    // Confidence group is hidden while mode is liveness.
    expect(screen.queryByRole('radio', { name: /1b\+/ })).not.toBeInTheDocument();
  });

  it('renders the confidence radios when link mode is advert', () => {
    renderControls({
      fabs: { links: true },
      linksOn: true,
      linkMode: 'advert',
      linkConfidence: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Links' }));
    expect(screen.getByRole('radio', { name: /1b\+/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /3b/ })).toBeInTheDocument();
  });

  it('pins the legend to a floating card and can close it', () => {
    renderControls();
    fireEvent.click(screen.getByRole('button', { name: /legend/i }));
    // The anchored legend panel offers a pin control.
    fireEvent.click(screen.getByRole('button', { name: /keep legend on screen/i }));
    // Pinned card is shown with a close (unpin) control.
    const close = screen.getByRole('button', { name: /close pinned legend/i });
    expect(close).toBeInTheDocument();
    fireEvent.click(close);
    expect(screen.queryByRole('button', { name: /close pinned legend/i })).not.toBeInTheDocument();
  });

  it('opens a bottom sheet instead of an anchored panel on compact viewports', () => {
    mockCompact.mockReturnValue(true);
    renderControls();
    fireEvent.click(screen.getByRole('button', { name: /layers/i }));
    // shadcn Sheet renders a Radix dialog.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The basemap options render inside it.
    expect(screen.getByText('OpenFreeMap Positron')).toBeInTheDocument();
  });

  it('reports a per-role node colour change from the node-size panel', () => {
    const onRoleColorChange = vi.fn();
    renderControls({ fabs: { nodeSize: true }, onRoleColorChange });
    fireEvent.click(screen.getByRole('button', { name: /node size/i }));
    const clientColor = screen.getByLabelText('Color for Client') as HTMLInputElement;
    fireEvent.input(clientColor, { target: { value: '#ff0000' } });
    // CONTACT_TYPE_CLIENT === 1
    expect(onRoleColorChange).toHaveBeenCalledWith(1, '#ff0000');
  });

  it('reports a reset of the node colours', () => {
    const onResetRoleColors = vi.fn();
    renderControls({ fabs: { nodeSize: true }, onRoleColorChange: vi.fn(), onResetRoleColors });
    fireEvent.click(screen.getByRole('button', { name: /node size/i }));
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onResetRoleColors).toHaveBeenCalledTimes(1);
  });

  it('omits the colour pickers when no colour handler is provided', () => {
    renderControls({ fabs: { nodeSize: true } });
    fireEvent.click(screen.getByRole('button', { name: /node size/i }));
    expect(screen.queryByLabelText('Color for Client')).not.toBeInTheDocument();
  });
});
