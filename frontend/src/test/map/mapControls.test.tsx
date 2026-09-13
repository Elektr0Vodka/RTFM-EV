import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../map/controls/breakpoints', async (orig) => ({
  ...(await orig<typeof import('../../map/controls/breakpoints')>()),
  useIsCompactMap: vi.fn(() => false),
  useIsMobile: vi.fn(() => false),
}));

import { I18nProvider } from '../../i18n/I18nProvider';
import { MapControls } from '../../map/controls/MapControls';
import { useIsCompactMap, useIsMobile } from '../../map/controls/breakpoints';

const mockCompact = useIsCompactMap as unknown as ReturnType<typeof vi.fn>;
const mockMobile = useIsMobile as unknown as ReturnType<typeof vi.fn>;

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
  mockMobile.mockReturnValue(false);
});

describe('MapControls', () => {
  it('renders a group FAB only when it has enabled members', () => {
    renderControls({ fabs: { layers: true } });
    expect(screen.getByRole('button', { name: 'Display' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overlays' })).not.toBeInTheDocument();
  });

  it('groups panel FABs into categories and hides the individual ones', () => {
    renderControls({
      fabs: { layers: true, legend: true, search: true, nodeSize: true, links: true },
    });
    expect(screen.getByRole('button', { name: 'Display' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overlays' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    // Individual panel FABs are folded into groups.
    expect(screen.queryByRole('button', { name: 'Legend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Node size' })).not.toBeInTheDocument();
  });

  it('does not render group FABs when only Search is enabled', () => {
    renderControls({ fabs: { search: true } });
    expect(screen.queryByRole('button', { name: 'Display' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overlays' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('opens the basemap picker from the Display group and reports a selection', () => {
    const onSelectBasemap = vi.fn();
    renderControls({ onSelectBasemap });
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    fireEvent.click(screen.getByText('OpenFreeMap Positron'));
    expect(onSelectBasemap).toHaveBeenCalledWith('ofm-positron');
  });

  it('stacks member sections inside the Display group panel', () => {
    renderControls({ fabs: { layers: true, nodeSize: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    expect(screen.getByText('OpenFreeMap Positron')).toBeInTheDocument();
    expect(screen.getByLabelText('Node size')).toBeInTheDocument();
  });

  it('gives every FAB a title tooltip', () => {
    renderControls();
    expect(screen.getByRole('button', { name: 'Display' })).toHaveAttribute('title', 'Display');
  });

  it('shifts the FAB stack right when mobile and the sidebar is open', () => {
    mockMobile.mockReturnValue(true);
    renderControls({ fabs: { search: true }, sidebarOpen: true });
    const stack = screen.getByTestId('map-fab-stack');
    expect(stack.className).toContain('left-[288px]');
    expect(stack.className).not.toContain('left-3');
  });

  it('does not shift the FAB stack on tablet/desktop even if the sidebar is open', () => {
    // Compact (tablet/touch) but not mobile: persistent sidebar, no overlay drawer.
    mockCompact.mockReturnValue(true);
    mockMobile.mockReturnValue(false);
    renderControls({ fabs: { search: true }, sidebarOpen: true });
    const stack = screen.getByTestId('map-fab-stack');
    expect(stack.className).toContain('left-3');
    expect(stack.className).not.toContain('left-[288px]');
  });

  it('does not shift the FAB stack when mobile but the sidebar is closed', () => {
    mockMobile.mockReturnValue(true);
    renderControls({ fabs: { search: true }, sidebarOpen: false });
    const stack = screen.getByTestId('map-fab-stack');
    expect(stack.className).toContain('left-3');
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
    // Links is now a section inside the Overlays group panel.
    fireEvent.click(screen.getByRole('button', { name: 'Overlays' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Overlays' }));
    expect(screen.getByRole('radio', { name: /1b\+/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /3b/ })).toBeInTheDocument();
  });

  it('pins the legend from the Display group and can close it', () => {
    renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    // The Legend section offers a pin control.
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
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    // shadcn Sheet renders a Radix dialog.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The basemap options render inside it.
    expect(screen.getByText('OpenFreeMap Positron')).toBeInTheDocument();
  });

  it('reports a per-role node colour change from the node-size panel', () => {
    const onRoleColorChange = vi.fn();
    renderControls({ fabs: { nodeSize: true }, onRoleColorChange });
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    const clientColor = screen.getByLabelText('Color for Client') as HTMLInputElement;
    fireEvent.input(clientColor, { target: { value: '#ff0000' } });
    // CONTACT_TYPE_CLIENT === 1
    expect(onRoleColorChange).toHaveBeenCalledWith(1, '#ff0000');
  });

  it('reports a reset of the node colours', () => {
    const onResetRoleColors = vi.fn();
    renderControls({ fabs: { nodeSize: true }, onRoleColorChange: vi.fn(), onResetRoleColors });
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onResetRoleColors).toHaveBeenCalledTimes(1);
  });

  it('omits the colour pickers when no colour handler is provided', () => {
    renderControls({ fabs: { nodeSize: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    expect(screen.queryByLabelText('Color for Client')).not.toBeInTheDocument();
  });
});
