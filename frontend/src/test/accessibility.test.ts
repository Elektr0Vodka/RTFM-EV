import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hexToHslTriplet } from '../utils/cvd/colorMath';
import { getSemanticColors } from '../utils/cvd/palettes';
import {
  ACCESSIBILITY_CHANGE_EVENT,
  applyCvdMode,
  applyReadingFont,
  refreshCvdTokens,
  CVD_MODE_KEY,
  followAccessibilityFromOtherWindows,
  getSavedCvdMode,
  getSavedReadingFont,
  READING_FONT_KEY,
  setSavedCvdMode,
  setSavedReadingFont,
  surfaceTone,
  watchAccessibility,
} from '../utils/accessibility';

const root = () => document.documentElement;

describe('accessibility preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    delete root().dataset.cvd;
    delete root().dataset.readingFont;
    delete root().dataset.tone;
    root().removeAttribute('style');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults the colourblind mode to off when nothing is saved', () => {
    expect(getSavedCvdMode()).toBe('off');
  });

  it.each(['DEUTAN', '1', '{}', ''])('treats the foreign value %j as off', (raw) => {
    localStorage.setItem(CVD_MODE_KEY, raw);
    expect(getSavedCvdMode()).toBe('off');
  });

  it('reads a saved colourblind mode', () => {
    localStorage.setItem(CVD_MODE_KEY, 'deutan');
    expect(getSavedCvdMode()).toBe('deutan');
  });

  it('falls back to defaults when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(getSavedCvdMode()).toBe('off');
    expect(getSavedReadingFont()).toBe('theme');
  });

  it('removes the key when the mode is set to off', () => {
    localStorage.setItem(CVD_MODE_KEY, 'protan');
    setSavedCvdMode('off');
    expect(localStorage.getItem(CVD_MODE_KEY)).toBeNull();
    expect(root().dataset.cvd).toBeUndefined();
  });

  it('stores and stamps a chosen mode', () => {
    setSavedCvdMode('tritan');
    expect(localStorage.getItem(CVD_MODE_KEY)).toBe('tritan');
    expect(root().dataset.cvd).toBe('tritan');
  });

  it('defaults the reading font to the theme font', () => {
    expect(getSavedReadingFont()).toBe('theme');
    localStorage.setItem(READING_FONT_KEY, 'comic');
    expect(getSavedReadingFont()).toBe('theme');
  });

  it('stores and stamps a chosen reading font', () => {
    setSavedReadingFont('lexend');
    expect(localStorage.getItem(READING_FONT_KEY)).toBe('lexend');
    expect(root().dataset.readingFont).toBe('lexend');
  });

  it('removes the reading font attribute and key for the theme font', () => {
    setSavedReadingFont('atkinson');
    setSavedReadingFont('theme');
    expect(localStorage.getItem(READING_FONT_KEY)).toBeNull();
    expect(root().dataset.readingFont).toBeUndefined();
  });

  it('applyReadingFont only touches the attribute', () => {
    applyReadingFont('opendyslexic');
    expect(root().dataset.readingFont).toBe('opendyslexic');
    expect(localStorage.getItem(READING_FONT_KEY)).toBeNull();
  });

  it('reads the tone from the card colour, not the background', () => {
    // Windows 95: teal background (dark) but light grey cards.
    root().style.setProperty('--background', '180 100% 25%');
    root().style.setProperty('--card', '0 0% 75%');
    expect(surfaceTone()).toBe('light');
    root().style.setProperty('--card', '220 13% 11%');
    expect(surfaceTone()).toBe('dark');
  });

  it('follows a change made in another tab or popup', () => {
    const stop = followAccessibilityFromOtherWindows();
    localStorage.setItem(CVD_MODE_KEY, 'protan');
    localStorage.setItem(READING_FONT_KEY, 'atkinson');
    window.dispatchEvent(new StorageEvent('storage', { key: CVD_MODE_KEY }));
    window.dispatchEvent(new StorageEvent('storage', { key: READING_FONT_KEY }));
    expect(root().dataset.cvd).toBe('protan');
    expect(root().dataset.readingFont).toBe('atkinson');
    stop();
    localStorage.removeItem(CVD_MODE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: CVD_MODE_KEY }));
    expect(root().dataset.cvd).toBe('protan');
  });

  describe('status tokens', () => {
    const TOKENS = [
      '--success',
      '--success-foreground',
      '--warning',
      '--warning-foreground',
      '--destructive',
      '--destructive-foreground',
      '--info',
      '--info-foreground',
      '--status-connected',
      '--status-disconnected',
    ];
    // Theme tokens live in stylesheets; inline only holds what the mode wrote
    // (plus --card, which the tests set to steer the tone).
    const inline = (name: string) => root().style.getPropertyValue(name).trim();

    it('writes the light palette when the cards are light', () => {
      root().style.setProperty('--card', '0 0% 75%');
      applyCvdMode('deutan');
      expect(inline('--success')).toBe(
        hexToHslTriplet(getSemanticColors('deutan', 'light')!.success)
      );
      expect(root().dataset.tone).toBe('light');
    });

    it('moves to the dark palette when the tone changes', () => {
      root().style.setProperty('--card', '0 0% 75%');
      applyCvdMode('deutan');
      root().style.setProperty('--card', '220 13% 11%');
      refreshCvdTokens();
      expect(inline('--success')).toBe(
        hexToHslTriplet(getSemanticColors('deutan', 'dark')!.success)
      );
    });

    it('leaves no tokens behind when off', () => {
      applyCvdMode('tritan');
      applyCvdMode('off');
      for (const t of TOKENS) expect(inline(t)).toBe('');
      expect(root().dataset.cvd).toBeUndefined();
    });

    it('writes nothing for an excluded theme', () => {
      root().dataset.theme = 'monochrome';
      root().dataset.cvd = 'deutan';
      refreshCvdTokens(['monochrome']);
      for (const t of TOKENS) expect(inline(t)).toBe('');
      delete root().dataset.theme;
    });

    it('applies the tokens when the mode is saved', () => {
      setSavedCvdMode('protan');
      expect(inline('--destructive')).not.toBe('');
    });
  });

  it('calls back on the change event and on storage events for its keys', () => {
    const cb = vi.fn();
    const stop = watchAccessibility(cb);
    window.dispatchEvent(new Event(ACCESSIBILITY_CHANGE_EVENT));
    expect(cb).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: CVD_MODE_KEY }));
    expect(cb).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent('storage', { key: READING_FONT_KEY }));
    expect(cb).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new StorageEvent('storage', { key: 'remoteterm-theme' }));
    expect(cb).toHaveBeenCalledTimes(3);
    stop();
    window.dispatchEvent(new Event(ACCESSIBILITY_CHANGE_EVENT));
    expect(cb).toHaveBeenCalledTimes(3);
  });
});
