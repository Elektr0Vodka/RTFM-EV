import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ThemeSelector } from '../components/settings/ThemeSelector';
import { ThemeSettingsDialog } from '../components/shell/ThemeSettingsDialog';
import { I18nProvider } from '../i18n/I18nProvider';

describe('theme dialog accessibility section', () => {
  it('offers the colourblind mode and reading font in the quick theme dialog', () => {
    render(
      <I18nProvider>
        <ThemeSettingsDialog open onOpenChange={() => {}} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accessibility' }));
    expect(screen.getByLabelText('Colourblind mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Reading font')).toBeInTheDocument();
    // Compact: the dialog's section header is the only 'Accessibility' title.
    expect(screen.queryByRole('heading', { name: 'Accessibility' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Accessibility')).toHaveLength(1);
  });
});

describe('theme grid with a wide reading font', () => {
  it('keeps the swatch at full size and marks the grid and names for the reading-font layout', () => {
    render(
      <I18nProvider>
        <ThemeSelector />
      </I18nProvider>
    );
    const name = screen.getByText('Windows 95');
    const swatch = name.previousElementSibling as HTMLElement;
    expect(swatch.className).toContain('shrink-0');
    // Unchanged with the theme font: one line per name, four columns.
    expect(name.className).toContain('whitespace-nowrap');
    expect(name.className).toContain('theme-name');
    expect(name.closest('fieldset')!.className).toContain('theme-grid');
  });

  it('lets names wrap at spaces and fits the columns only while a reading font is on', () => {
    const css = readFileSync(resolve(__dirname, '../accessibility.css'), 'utf8');
    expect(css).toContain('html[data-reading-font] .theme-grid {');
    expect(css).toMatch(/\.theme-grid \{[^}]*grid-template-columns:\s*repeat\(auto-fill/);
    expect(css).toContain('html[data-reading-font] .theme-name {');
    expect(css).toMatch(/\.theme-name \{[^}]*white-space:\s*normal/);
  });
});
