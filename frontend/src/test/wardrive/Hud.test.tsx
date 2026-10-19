import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import type { LiveEntry } from '../../wardrive/liveLog';
import { Hud } from '../../wardrive/screen/Hud';
import { tierColor } from '../../wardrive/signal';

const NOW = 1_800_000_000_000;

const entry = (over: Partial<LiveEntry> = {}): LiveEntry => ({
  id: 1,
  at: NOW - 12000,
  rssi: -85,
  snr: 4.5,
  payloadType: 5,
  typeName: 'GroupText',
  direct: false,
  hops: 2,
  lat: 52,
  lon: 5,
  kept: true,
  ...over,
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function renderHud(over: Partial<ComponentProps<typeof Hud>> = {}) {
  const props: ComponentProps<typeof Hud> = {
    shown: null,
    nowMs: NOW,
    speedMps: null,
    unit: 'metric',
    pending: 0,
    running: false,
    canStart: true,
    counts: { heard: 0, stored: 0, noPosition: 0 },
    onStart: vi.fn(),
    onStop: vi.fn(),
    ...over,
  };
  const view = render(
    <I18nProvider>
      <Hud {...props} />
    </I18nProvider>
  );
  return { ...view, props };
}

describe('wardrive HUD', () => {
  it('has a clean empty state', () => {
    const { container } = renderHud();
    expect(screen.getByText('No reception yet')).toBeTruthy();
    expect(screen.getByTestId('wardrive-hud-rssi').textContent).toBe('-');
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('shows the reception with its signal colour, SNR and age', () => {
    renderHud({ shown: entry() });
    const rssi = screen.getByTestId('wardrive-hud-rssi');
    expect(rssi.textContent).toBe('-85');
    // The digits stay in the theme's text colour (readable on light themes);
    // the tier colour is a swatch next to them.
    expect(rssi.style.color).toBe('');
    expect(screen.getByTestId('wardrive-hud-tier').style.backgroundColor).toBe(
      hexToRgb(tierColor('warm', false))
    );
    expect(screen.getByText('SNR 4.5 dB')).toBeTruthy();
    expect(screen.getByText('12 s')).toBeTruthy();
  });

  it('shows the speed in the chosen unit', () => {
    renderHud({ speedMps: 10, unit: 'metric' });
    expect(screen.getByText('36 km/h')).toBeTruthy();
  });

  it('flags a backlog from 25 and alarms from 250', () => {
    const { rerender } = renderHud({ pending: 24 });
    expect(screen.queryByTestId('wardrive-hud-backlog')).toBeNull();
    const props = { pending: 25 };
    rerender(
      <I18nProvider>
        <Hud
          shown={null}
          nowMs={NOW}
          speedMps={null}
          unit="metric"
          running={false}
          canStart
          counts={{ heard: 0, stored: 0, noPosition: 0 }}
          onStart={() => {}}
          onStop={() => {}}
          {...props}
        />
      </I18nProvider>
    );
    expect(screen.getByTestId('wardrive-hud-backlog').dataset.alarm).toBe('false');
    rerender(
      <I18nProvider>
        <Hud
          shown={null}
          nowMs={NOW}
          speedMps={null}
          unit="metric"
          running={false}
          canStart
          counts={{ heard: 0, stored: 0, noPosition: 0 }}
          onStart={() => {}}
          onStop={() => {}}
          pending={250}
        />
      </I18nProvider>
    );
    expect(screen.getByTestId('wardrive-hud-backlog').dataset.alarm).toBe('true');
  });

  it('says why the drive cannot start', () => {
    renderHud({ canStart: false, startHint: 'Log in first' });
    expect(screen.getByText('Log in first')).toBeTruthy();
  });

  it('starts and stops the drive', () => {
    const { props, rerender } = renderHud({ canStart: false });
    expect(
      (screen.getByRole('button', { name: 'Start driving' }) as HTMLButtonElement).disabled
    ).toBe(true);
    rerender(
      <I18nProvider>
        <Hud {...props} running canStart />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop driving' }));
    expect(props.onStop).toHaveBeenCalled();
  });

  it('keeps the drive counters', () => {
    renderHud({ counts: { heard: 3, stored: 2, noPosition: 1 } });
    expect(screen.getByTestId('wardrive-heard').textContent).toBe('3');
    expect(screen.getByTestId('wardrive-stored').textContent).toBe('2');
    expect(screen.getByTestId('wardrive-no-position').textContent).toBe('1');
  });
});
