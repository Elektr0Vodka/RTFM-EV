import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { HeaderLanguageMenu } from '../components/HeaderLanguageMenu';
import { I18nProvider } from '../i18n';

function renderMenu() {
  return render(
    <I18nProvider>
      <HeaderLanguageMenu />
    </I18nProvider>
  );
}

describe('HeaderLanguageMenu', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the current language code on the trigger', () => {
    renderMenu();

    expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('EN');
  });

  it('opens a menu listing the three languages when clicked', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));

    expect(screen.getByRole('menuitemradio', { name: /Nederlands/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /English/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /Deutsch/ })).toBeInTheDocument();
  });

  it('marks the active language as checked', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));

    expect(screen.getByRole('menuitemradio', { name: /English/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('selecting a language updates the trigger, persists it, and closes the menu', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Deutsch/ }));

    // The trigger's aria-label is itself localized, so after switching to German
    // its accessible name becomes "Sprache"; it now shows the DE code.
    expect(screen.getByRole('button', { name: 'Sprache' })).toHaveTextContent('DE');
    expect(localStorage.getItem('locale')).toBe('de');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the menu on Escape', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
