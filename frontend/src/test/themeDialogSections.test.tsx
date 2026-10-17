import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeSettingsDialog } from '../components/shell/ThemeSettingsDialog';
import { I18nProvider } from '../i18n/I18nProvider';
import {
  getOpenThemeDialogSections,
  THEME_DIALOG_SECTIONS_KEY,
} from '../utils/themeDialogSections';

const BUDDY_DISCOVERED_KEY = 'rtfm-buddy-discovered';

function renderDialog() {
  return render(
    <I18nProvider>
      <ThemeSettingsDialog open onOpenChange={() => {}} />
    </I18nProvider>
  );
}

const header = (name: string) => screen.getByRole('button', { name });

describe('theme dialog sections', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts with every section collapsed', () => {
    renderDialog();
    for (const name of ['Color theme', 'CRT screen effects', 'Accessibility']) {
      expect(header(name)).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByLabelText('Colourblind mode')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('opens a section and remembers it for next time', () => {
    const { unmount } = renderDialog();
    fireEvent.click(header('Accessibility'));
    expect(header('Accessibility')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Colourblind mode')).toBeInTheDocument();
    expect(getOpenThemeDialogSections()).toEqual(['accessibility']);
    unmount();

    renderDialog();
    expect(header('Accessibility')).toHaveAttribute('aria-expanded', 'true');
    expect(header('Color theme')).toHaveAttribute('aria-expanded', 'false');
  });

  it('forgets a section once it is collapsed again', () => {
    renderDialog();
    fireEvent.click(header('Color theme'));
    fireEvent.click(header('Color theme'));
    expect(header('Color theme')).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem(THEME_DIALOG_SECTIONS_KEY)).toBeNull();
  });

  it.each(['nonsense', '{"a":1}', '["theme","bogus"]'])(
    'treats the stored value %j safely',
    (raw) => {
      localStorage.setItem(THEME_DIALOG_SECTIONS_KEY, raw);
      expect(() => renderDialog()).not.toThrow();
      expect(getOpenThemeDialogSections()).toEqual(raw.includes('theme') ? ['theme'] : []);
    }
  );

  it('falls back to all collapsed when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(getOpenThemeDialogSections()).toEqual([]);
  });

  it('shows the buddy section only once the buddy is available', () => {
    renderDialog();
    expect(screen.queryByRole('button', { name: 'Desktop buddy' })).not.toBeInTheDocument();
  });
});

describe('theme dialog buddy section', () => {
  beforeEach(() => localStorage.clear());

  it('appears, collapsed, once the buddy has been unlocked', () => {
    localStorage.setItem(BUDDY_DISCOVERED_KEY, '1');
    renderDialog();
    expect(screen.getByRole('button', { name: 'Desktop buddy' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });
});
