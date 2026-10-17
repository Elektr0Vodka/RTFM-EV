/**
 * Accessibility preferences: a colourblind mode and a reading font. Both are
 * per browser (localStorage, like font scale), work on top of every theme and
 * are stamped on <html> as data attributes:
 *   data-cvd="protan|deutan|tritan"   absent when the mode is off
 *   data-reading-font="…"             absent for the theme's own font
 *   data-tone="dark|light"            tone of the surface content sits on
 */

import { hexToHslTriplet } from './cvd/colorMath';
import { getSemanticColors, type SemanticColors } from './cvd/palettes';

export type CvdMode = 'off' | 'protan' | 'deutan' | 'tritan';
export type ReadingFont = 'theme' | 'opendyslexic' | 'atkinson' | 'lexend';
export type Tone = 'dark' | 'light';

export const CVD_MODES: readonly CvdMode[] = ['off', 'protan', 'deutan', 'tritan'];
export const READING_FONTS: readonly ReadingFont[] = [
  'theme',
  'opendyslexic',
  'atkinson',
  'lexend',
];

export const CVD_MODE_KEY = 'remoteterm-cvd-mode';
export const READING_FONT_KEY = 'remoteterm-reading-font';
export const ACCESSIBILITY_CHANGE_EVENT = 'remoteterm-accessibility-change';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // localStorage may be unavailable
  }
}

function notify(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event(ACCESSIBILITY_CHANGE_EVENT));
  } catch {
    // Event constructor may be unavailable in some environments
  }
}

export function getSavedCvdMode(): CvdMode {
  const raw = read(CVD_MODE_KEY);
  return raw !== 'off' && (CVD_MODES as readonly string[]).includes(raw ?? '')
    ? (raw as CvdMode)
    : 'off';
}

export function getSavedReadingFont(): ReadingFont {
  const raw = read(READING_FONT_KEY);
  return raw !== 'theme' && (READING_FONTS as readonly string[]).includes(raw ?? '')
    ? (raw as ReadingFont)
    : 'theme';
}

/**
 * Themes the colourblind mode leaves alone. Empty on purpose: Monochrome and
 * the CRT themes get real status colour while a mode is on, as an experiment.
 * Add a theme id here to exclude it.
 */
export const CVD_EXCLUDED_THEMES: readonly string[] = [];

/** CSS token -> SemanticColors field, for the tokens the mode overrides. */
const CVD_TOKENS: ReadonlyArray<[string, keyof SemanticColors]> = [
  ['--success', 'success'],
  ['--success-foreground', 'successFg'],
  ['--warning', 'warning'],
  ['--warning-foreground', 'warningFg'],
  ['--destructive', 'destructive'],
  ['--destructive-foreground', 'destructiveFg'],
  ['--info', 'info'],
  ['--info-foreground', 'infoFg'],
  ['--status-connected', 'statusConnected'],
  ['--status-disconnected', 'statusDisconnected'],
];

/**
 * Writes the status tokens for the current data-cvd and tone as inline custom
 * properties on <html> (they beat every `:root[data-theme]` rule), or removes
 * them when the mode is off or the theme is excluded. Call after the theme or
 * the mode changes.
 */
export function refreshCvdTokens(excluded: readonly string[] = CVD_EXCLUDED_THEMES): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // Clear first so the tone is read from the theme's own --card.
  for (const [token] of CVD_TOKENS) root.style.removeProperty(token);
  const mode = (root.dataset.cvd ?? 'off') as CvdMode;
  const theme = root.dataset.theme ?? 'original';
  const tone = applyTone();
  const colors = excluded.includes(theme) ? null : getSemanticColors(mode, tone);
  if (colors) {
    for (const [token, key] of CVD_TOKENS) {
      root.style.setProperty(token, hexToHslTriplet(colors[key]));
    }
  }
  notify();
}

/** Stamps (or clears) data-cvd on <html> and refreshes the status tokens. */
export function applyCvdMode(mode: CvdMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (mode === 'off') {
    delete root.dataset.cvd;
  } else {
    root.dataset.cvd = mode;
  }
  refreshCvdTokens();
}

export function setSavedCvdMode(mode: CvdMode): void {
  write(CVD_MODE_KEY, mode === 'off' ? null : mode);
  applyCvdMode(mode);
  notify();
}

/** Stamps (or clears) data-reading-font on <html>. Never saves. */
export function applyReadingFont(font: ReadingFont): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (font === 'theme') {
    delete root.dataset.readingFont;
  } else {
    root.dataset.readingFont = font;
  }
}

export function setSavedReadingFont(font: ReadingFont): void {
  write(READING_FONT_KEY, font === 'theme' ? null : font);
  applyReadingFont(font);
  notify();
}

/**
 * Tone of the surface content sits on, from the lightness of `--card`.
 * Not isDarkTheme(): that reads `--background`, which calls Windows 95 (teal
 * desktop, light grey cards) dark. Defaults to dark when unreadable.
 */
export function surfaceTone(): Tone {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'dark';
  const card = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
  const parts = card.split(/\s+/);
  const lightness = parts.length >= 3 ? parseFloat(parts[2]) : NaN;
  if (Number.isNaN(lightness)) return 'dark';
  return lightness < 50 ? 'dark' : 'light';
}

/** Stamps data-tone on <html> and returns it. */
export function applyTone(): Tone {
  const tone = surfaceTone();
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.tone = tone;
  }
  return tone;
}

/**
 * Re-applies both settings when another tab or popup saves them (storage event
 * only, so it never re-enters on this document's own change event). Call once
 * at boot. Returns an unsubscribe function.
 */
export function followAccessibilityFromOtherWindows(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === CVD_MODE_KEY) {
      applyCvdMode(getSavedCvdMode());
      notify();
    } else if (event.key === READING_FONT_KEY) {
      applyReadingFont(getSavedReadingFont());
      notify();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/**
 * Calls `onChange` when either setting changes in this document or in another
 * tab or popup (storage event). Returns an unsubscribe function.
 */
export function watchAccessibility(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === CVD_MODE_KEY || event.key === READING_FONT_KEY) onChange();
  };
  window.addEventListener(ACCESSIBILITY_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(ACCESSIBILITY_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
