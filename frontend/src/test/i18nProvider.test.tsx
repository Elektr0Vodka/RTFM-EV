import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { I18nProvider, useT, useLocale } from '../i18n';

function Probe() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="loc">{locale}</span>
      <span data-testid="txt">{t('settings_language')}</span>
      <button onClick={() => setLocale('nl')}>nl</button>
    </div>
  );
}

describe('I18nProvider', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to English and switches + persists', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('loc').textContent).toBe('en');
    expect(screen.getByTestId('txt').textContent).toBe('Language');
    act(() => screen.getByText('nl').click());
    expect(screen.getByTestId('loc').textContent).toBe('nl');
    expect(screen.getByTestId('txt').textContent).toBe('Taal');
    expect(localStorage.getItem('locale')).toBe('nl');
    expect(document.documentElement.lang).toBe('nl');
  });
});
