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
  packetType: 'GroupText',
  heardDirect: false,
  sender: { kind: null, id: null, label: null, role: null },
  channel: null,
  text: null,
  stored: false,
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
    arrow: null,
    sender: { prefix: '', name: '', note: '' },
    onTargets: vi.fn(),
    onAddTarget: vi.fn(),
    onIgnore: vi.fn(),
    stand: 'filtered',
    onStand: vi.fn(),
    canTarget: false,
    canIgnore: false,
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
    const { props, rerender } = renderHud({ pending: 24 });
    expect(screen.queryByTestId('wardrive-hud-backlog')).toBeNull();
    rerender(
      <I18nProvider>
        <Hud {...props} pending={25} />
      </I18nProvider>
    );
    expect(screen.getByTestId('wardrive-hud-backlog').dataset.alarm).toBe('false');
    rerender(
      <I18nProvider>
        <Hud {...props} pending={250} />
      </I18nProvider>
    );
    expect(screen.getByTestId('wardrive-hud-backlog').dataset.alarm).toBe('true');
  });

  it('shows the measured signal coloured by the plotted one, with the offset', () => {
    renderHud({ shown: { ...entry(), rssi: -95 }, rssiOffset: 20 });
    expect(screen.getByTestId('wardrive-hud-rssi').textContent).toBe('-95');
    expect(screen.getByTestId('wardrive-hud-offset').textContent).toBe('+20');
    expect(screen.getByTestId('wardrive-hud-tier').style.backgroundColor).toBe(
      hexToRgb(tierColor('hot', false))
    );
  });

  it('shows the noise floor', () => {
    renderHud({ noiseFloor: -112 });
    expect(screen.getByTestId('wardrive-hud-noise').textContent).toContain('-112');
  });

  it('says why the drive cannot start', () => {
    renderHud({ canStart: false, startHint: 'Log in first' });
    // Its own full-width line, not a narrow column between Start and the counters.
    expect(screen.getByText('Log in first').className).toContain('basis-full');
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

  it('turns the arrow toward the sender, outlined for an estimate', () => {
    renderHud({ shown: entry(), arrow: { angle: 90, kind: 'estimate' } });
    const arrow = screen.getByTestId('wardrive-hud-arrow');
    expect(arrow.style.transform).toBe('rotate(90deg)');
    expect(arrow.dataset.kind).toBe('estimate');
    expect(arrow.getAttribute('fill')).toBe('none');
  });

  it('fills the arrow for an advertised position', () => {
    renderHud({ shown: entry(), arrow: { angle: -30, kind: 'advertised' } });
    const arrow = screen.getByTestId('wardrive-hud-arrow');
    expect(arrow.style.transform).toBe('rotate(-30deg)');
    expect(arrow.getAttribute('fill')).toBe('currentColor');
  });

  it('draws no arrow without one', () => {
    renderHud({ shown: entry(), arrow: null });
    expect(screen.queryByTestId('wardrive-hud-arrow')).toBeNull();
  });

  it('reads the sender line', () => {
    renderHud({ shown: entry(), sender: { prefix: 'via ~', name: 'Toren', note: '' } });
    expect(screen.getByTestId('wardrive-hud-sender').textContent).toBe('via ~Toren');
  });

  it('reads a note when there is nobody to name', () => {
    renderHud({ shown: entry(), sender: { prefix: '', name: '', note: 'Trace, no sender id' } });
    expect(screen.getByTestId('wardrive-hud-sender').textContent).toBe('Trace, no sender id');
  });

  it('shows no NaN or undefined anywhere for an empty HUD', () => {
    const { container } = renderHud({ arrow: null });
    expect(container.textContent).not.toMatch(/NaN|undefined/);
    expect(container.innerHTML).not.toMatch(/NaN|undefined/);
  });

  it('offers the target tools', () => {
    const { props } = renderHud({ shown: entry(), canTarget: true, canIgnore: true });
    fireEvent.click(screen.getByRole('button', { name: 'Targets' }));
    expect(props.onTargets).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add the shown sender to the targets' }));
    expect(props.onAddTarget).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ignore the shown sender' }));
    expect(props.onIgnore).toHaveBeenCalled();
  });

  it('greys Add and Ignore without a sender to use', () => {
    renderHud({ shown: entry(), canTarget: false, canIgnore: false });
    const add = screen.getByRole('button', { name: 'Add the shown sender to the targets' });
    const ignore = screen.getByRole('button', { name: 'Ignore the shown sender' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect((ignore as HTMLButtonElement).disabled).toBe(true);
  });

  it('switches between Filtered and All', () => {
    const { props, rerender } = renderHud({ stand: 'filtered' });
    const all = screen.getByRole('button', { name: 'Show all receptions' });
    expect(all.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(all);
    expect(props.onStand).toHaveBeenCalledWith('all');
    rerender(
      <I18nProvider>
        <Hud {...props} stand="all" />
      </I18nProvider>
    );
    const on = screen.getByRole('button', { name: 'Show all receptions' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(on);
    expect(props.onStand).toHaveBeenLastCalledWith('filtered');
  });

  it('offers Float only where the browser can float the reading', () => {
    const onFloat = vi.fn();
    const { rerender, props } = renderHud({ onFloat });
    expect(screen.queryByRole('button', { name: /floating window/ })).toBeNull();
    rerender(
      <I18nProvider>
        <Hud {...props} canFloat floatOpen={false} />
      </I18nProvider>
    );
    const button = screen.getByRole('button', { name: /floating window/ });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(onFloat).toHaveBeenCalled();
    rerender(
      <I18nProvider>
        <Hud {...props} canFloat floatOpen />
      </I18nProvider>
    );
    expect(
      screen.getByRole('button', { name: /floating window/ }).getAttribute('aria-pressed')
    ).toBe('true');
  });
});
