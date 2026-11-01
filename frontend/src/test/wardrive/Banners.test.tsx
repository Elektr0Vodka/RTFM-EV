import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { Banners, SCREEN_HINT_KEY } from '../../wardrive/screen/Banners';

function renderBanners(over: Partial<ComponentProps<typeof Banners>> = {}) {
  const props: ComponentProps<typeof Banners> = {
    noRadio: false,
    radioLost: false,
    noFix: false,
    fixTooPoor: null,
    pausedAt: null,
    offline: false,
    error: null,
    otherAccounts: 0,
    onConnect: vi.fn(),
    onDismissError: vi.fn(),
    ...over,
  };
  const view = render(
    <I18nProvider>
      <Banners {...props} />
    </I18nProvider>
  );
  return { ...view, props };
}

afterEach(() => {
  localStorage.clear();
});

describe('wardrive banners', () => {
  it('offers to connect again when the radio was lost', () => {
    const { props } = renderBanners({ radioLost: true });
    expect(screen.getByText(/The radio disconnected/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(props.onConnect).toHaveBeenCalled();
  });

  it('says how rough the position is', () => {
    renderBanners({ fixTooPoor: 140 });
    expect(screen.getByText(/140 m/)).toBeTruthy();
  });

  it('says when the drive paused in the background', () => {
    const at = new Date(2026, 9, 20, 14, 5).getTime();
    renderBanners({ pausedAt: at });
    expect(screen.getByText(/14:05/)).toBeTruthy();
  });

  it('shows the offline, error and other-accounts notes', () => {
    renderBanners({ offline: true, error: 'boom', otherAccounts: 2 });
    expect(screen.getByText(/Working offline/)).toBeTruthy();
    expect(screen.getByText(/boom/)).toBeTruthy();
    expect(screen.getByText(/2 receptions of another account/)).toBeTruthy();
  });

  it('lets the error note be closed', () => {
    const { props } = renderBanners({ error: 'User cancelled the requestDevice() chooser.' });
    const note = screen.getByRole('alert');
    fireEvent.click(within(note).getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismissError).toHaveBeenCalled();
  });

  it('shows the keep-the-screen-on hint once', () => {
    const first = renderBanners();
    expect(screen.getByText(/Keep the screen on/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Keep the screen on/)).toBeNull();
    expect(localStorage.getItem(SCREEN_HINT_KEY)).toBe('1');
    first.unmount();
    renderBanners();
    expect(screen.queryByText(/Keep the screen on/)).toBeNull();
  });
});
