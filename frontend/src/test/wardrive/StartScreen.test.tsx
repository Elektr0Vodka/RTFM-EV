import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import {
  START_DISMISSED_KEY,
  StartScreen,
  startScreenWanted,
} from '../../wardrive/screen/StartScreen';

function renderStart(over: Partial<ComponentProps<typeof StartScreen>> = {}) {
  const props: ComponentProps<typeof StartScreen> = {
    radioName: null,
    radioError: null,
    fixAccuracy: null,
    positionChosen: false,
    bleSupported: true,
    serialSupported: true,
    deviceAllowed: true,
    onConnectBle: vi.fn(),
    onConnectUsb: vi.fn(),
    onChoosePosition: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(
    <I18nProvider>
      <StartScreen {...props} />
    </I18nProvider>
  );
  return props;
}

afterEach(() => {
  sessionStorage.clear();
});

describe('wardrive start screen', () => {
  it('connects the radio over Bluetooth', () => {
    const props = renderStart();
    fireEvent.click(screen.getByRole('button', { name: 'Connect over Bluetooth' }));
    expect(props.onConnectBle).toHaveBeenCalled();
  });

  it('offers a position once the radio is connected', () => {
    const props = renderStart({ radioName: 'Car' });
    expect(screen.getByText(/Car/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this device location' }));
    expect(props.onChoosePosition).toHaveBeenCalledWith('device');
  });

  it('explains when the browser can reach no radio', () => {
    renderStart({ bleSupported: false, serialSupported: false });
    expect(screen.getByText(/cannot reach a radio/)).toBeTruthy();
  });

  it('closes', () => {
    const props = renderStart();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('is wanted until a usable fix or a close in this session', () => {
    expect(startScreenWanted(false)).toBe(true);
    expect(startScreenWanted(true)).toBe(false);
    sessionStorage.setItem(START_DISMISSED_KEY, '1');
    expect(startScreenWanted(false)).toBe(false);
  });
});
