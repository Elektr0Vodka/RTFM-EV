import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { VIEW_STATES } from '../../wardrive/map/viewModes';
import { RightRail } from '../../wardrive/screen/RightRail';

function renderRail(over: Partial<Parameters<typeof RightRail>[0]> = {}) {
  const props = {
    view: VIEW_STATES[0],
    onView: vi.fn(),
    compass: 'north' as const,
    onCompass: vi.fn(),
    sound: 'rx' as const,
    onSound: vi.fn(),
    nodePos: 'off' as const,
    onNodePos: vi.fn(),
    autoDiscover: 'off' as const,
    autoDiscoverDisabled: false,
    onAutoDiscover: vi.fn(),
    ...over,
  };
  render(
    <I18nProvider>
      <RightRail {...props} />
    </I18nProvider>
  );
  return props;
}

describe('wardrive right rail', () => {
  it('names each button with its state and passes the taps on', () => {
    const props = renderRail();
    const view = screen.getByRole('button', { name: 'View: 2D, points' });
    const compass = screen.getByRole('button', { name: 'Compass: follow, north up' });
    const sound = screen.getByRole('button', { name: 'Sound' });
    const nodes = screen.getByRole('button', { name: 'Node positions: off' });
    expect(compass.getAttribute('aria-pressed')).toBe('true');
    expect(sound.getAttribute('aria-pressed')).toBe('true');
    expect(nodes.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(view);
    fireEvent.click(compass);
    fireEvent.click(sound);
    fireEvent.click(nodes);
    expect(props.onView).toHaveBeenCalled();
    expect(props.onCompass).toHaveBeenCalled();
    expect(props.onSound).toHaveBeenCalled();
    expect(props.onNodePos).toHaveBeenCalled();
  });

  it('labels every view, compass and node position state', () => {
    const labels = [
      'View: 2D, points',
      'View: 2D, hex and points',
      'View: 3D, hex',
      'View: 3D, points',
      'View: 3D, hex and points',
    ];
    VIEW_STATES.forEach((view, i) => {
      const { unmount } = render(
        <I18nProvider>
          <RightRail
            view={view}
            onView={() => {}}
            compass={(['static', 'north', 'heading'] as const)[i % 3]}
            onCompass={() => {}}
            sound="off"
            onSound={() => {}}
            nodePos={(['off', 'positions', 'reach'] as const)[i % 3]}
            onNodePos={() => {}}
            autoDiscover="off"
            autoDiscoverDisabled={false}
            onAutoDiscover={() => {}}
          />
        </I18nProvider>
      );
      expect(screen.getByRole('button', { name: labels[i] })).toBeTruthy();
      unmount();
    });
    renderRail({ compass: 'static', nodePos: 'reach' });
    expect(screen.getByRole('button', { name: 'Compass: off' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Node positions: positions and reach' })
    ).toBeTruthy();
  });

  it('puts Auto-discover second, says its state, and is off without a radio', () => {
    const props = renderRail({ autoDiscoverDisabled: true });
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names[1]).toBe('Auto-discover: off');
    const button = screen.getByRole('button', { name: 'Auto-discover: off' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(props.onAutoDiscover).not.toHaveBeenCalled();
  });

  it('names Auto-discover on, and on with target pings', () => {
    renderRail({ autoDiscover: 'target' });
    const b = screen.getByRole('button', { name: 'Auto-discover and target pings: on' });
    expect(b.getAttribute('aria-pressed')).toBe('true');
  });
});
