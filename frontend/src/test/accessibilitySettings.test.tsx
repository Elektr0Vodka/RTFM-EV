import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { AccessibilitySettings } from '../components/settings/AccessibilitySettings';
import { I18nProvider } from '../i18n/I18nProvider';
import { CVD_MODE_KEY, READING_FONT_KEY } from '../utils/accessibility';

function renderSettings() {
  return render(
    <I18nProvider>
      <AccessibilitySettings />
    </I18nProvider>
  );
}

describe('AccessibilitySettings', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.cvd;
    delete document.documentElement.dataset.readingFont;
  });

  it('shows the saved values', () => {
    localStorage.setItem(CVD_MODE_KEY, 'tritan');
    localStorage.setItem(READING_FONT_KEY, 'lexend');
    renderSettings();
    expect(screen.getByLabelText('Colourblind mode')).toHaveValue('tritan');
    expect(screen.getByLabelText('Reading font')).toHaveValue('lexend');
  });

  it('applies and saves a colourblind mode', () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText('Colourblind mode'), { target: { value: 'deutan' } });
    expect(document.documentElement.dataset.cvd).toBe('deutan');
    expect(localStorage.getItem(CVD_MODE_KEY)).toBe('deutan');
  });

  it('goes back to the theme font', () => {
    localStorage.setItem(READING_FONT_KEY, 'atkinson');
    document.documentElement.dataset.readingFont = 'atkinson';
    renderSettings();
    fireEvent.change(screen.getByLabelText('Reading font'), { target: { value: 'theme' } });
    expect(document.documentElement.dataset.readingFont).toBeUndefined();
    expect(localStorage.getItem(READING_FONT_KEY)).toBeNull();
  });

  it('follows a change made in another tab', () => {
    renderSettings();
    act(() => {
      localStorage.setItem(CVD_MODE_KEY, 'protan');
      window.dispatchEvent(new StorageEvent('storage', { key: CVD_MODE_KEY }));
    });
    expect(screen.getByLabelText('Colourblind mode')).toHaveValue('protan');
  });

  it('names every option', () => {
    renderSettings();
    expect(
      screen.getByRole('option', { name: 'Green-weak or green-blind (deutan)' })
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Atkinson Hyperlegible' })).toBeInTheDocument();
  });
});
