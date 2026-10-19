import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ThemeSelector } from '../../components/settings/ThemeSelector';
import { I18nProvider } from '../../i18n';
import { MenuSheet, type MenuTab } from '../../wardrive/screen/MenuSheet';

function renderMenu(open: boolean, tab: MenuTab, onTab = vi.fn()) {
  render(
    <I18nProvider>
      <MenuSheet
        open={open}
        onOpenChange={() => {}}
        tab={tab}
        onTab={onTab}
        status={<p>status body</p>}
        settings={<ThemeSelector />}
        map={<p>map body</p>}
        about={<p>about body</p>}
      />
    </I18nProvider>
  );
  return onTab;
}

describe('wardrive menu sheet', () => {
  it('renders nothing while closed', () => {
    renderMenu(false, 'status');
    expect(screen.queryByText('status body')).toBeNull();
  });

  it('shows the chosen tab', () => {
    renderMenu(true, 'status');
    expect(screen.getByText('status body')).toBeTruthy();
    expect(screen.queryByText('map body')).toBeNull();
  });

  it('switches tabs', () => {
    const onTab = renderMenu(true, 'status');
    const settings = screen.getByRole('tab', { name: 'Settings' });
    fireEvent.mouseDown(settings);
    fireEvent.click(settings);
    expect(onTab).toHaveBeenCalledWith('settings');
  });

  it('holds the theme picker in Settings', () => {
    renderMenu(true, 'settings');
    expect(screen.getByText('Color theme')).toBeTruthy();
  });
});
