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
        drives={<p>drives body</p>}
        reports={<p>reports body</p>}
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
    expect(screen.queryByText('drives body')).toBeNull();
  });

  it('switches tabs', () => {
    const onTab = renderMenu(true, 'status');
    const settings = screen.getByRole('tab', { name: 'Settings' });
    fireEvent.mouseDown(settings);
    fireEvent.click(settings);
    expect(onTab).toHaveBeenCalledWith('settings');
  });

  it('has the five tabs in order', () => {
    renderMenu(true, 'drives');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Status',
      'Settings',
      'Drives',
      'Reports',
      'About',
    ]);
    expect(screen.getByText('drives body')).toBeTruthy();
  });

  it('keeps its content off the screen edge and the tabs clear of the close button', () => {
    renderMenu(true, 'status');
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.paddingRight).toContain('1rem');
    expect(dialog.style.paddingTop).toContain('1rem');
    expect(screen.getByRole('tablist').className).toContain('mr-10');
  });

  it('holds the theme picker in Settings', () => {
    renderMenu(true, 'settings');
    expect(screen.getByText('Color theme')).toBeTruthy();
  });
});
