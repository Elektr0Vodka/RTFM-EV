import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { I18nProvider } from '../i18n';
import { LanguageSelector } from '../components/settings/LanguageSelector';

describe('LanguageSelector', () => {
  beforeEach(() => localStorage.clear());

  it('shows three languages and switches the active one', () => {
    render(
      <I18nProvider>
        <LanguageSelector />
      </I18nProvider>
    );
    const en = screen.getByRole('radio', { name: /English/ }) as HTMLInputElement;
    const nl = screen.getByRole('radio', { name: /Nederlands/ }) as HTMLInputElement;
    const de = screen.getByRole('radio', { name: /Deutsch/ }) as HTMLInputElement;
    expect(en.checked).toBe(true);
    act(() => nl.click());
    expect(nl.checked).toBe(true);
    expect(localStorage.getItem('locale')).toBe('nl');
    expect(de.checked).toBe(false);
  });
});
