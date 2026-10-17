/** Sections of the quick theme dialog; all start collapsed. */
export type ThemeDialogSection = 'theme' | 'crt' | 'accessibility' | 'buddy';

export const THEME_DIALOG_SECTIONS: readonly ThemeDialogSection[] = [
  'theme',
  'crt',
  'accessibility',
  'buddy',
];

/** Which sections this browser left open (JSON array of section ids). */
export const THEME_DIALOG_SECTIONS_KEY = 'remoteterm-theme-dialog-open';

export function getOpenThemeDialogSections(): ThemeDialogSection[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(THEME_DIALOG_SECTIONS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return THEME_DIALOG_SECTIONS.filter((s) => parsed.includes(s));
  } catch {
    return [];
  }
}

export function saveOpenThemeDialogSections(open: readonly ThemeDialogSection[]): void {
  try {
    if (open.length === 0) {
      localStorage.removeItem(THEME_DIALOG_SECTIONS_KEY);
    } else {
      localStorage.setItem(THEME_DIALOG_SECTIONS_KEY, JSON.stringify(open));
    }
  } catch {
    // localStorage may be unavailable
  }
}
