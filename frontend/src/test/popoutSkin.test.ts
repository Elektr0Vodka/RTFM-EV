import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyPopoutSkin,
  getSavedPopoutLayout,
  getSavedPopoutSkin,
  POPOUT_LAYOUT_KEY,
  POPOUT_SKIN_KEY,
  savePopoutLayout,
  savePopoutSkin,
  watchPopoutAppearance,
} from '../popout/popoutSkin';
import { THEME_KEY } from '../utils/theme';

const root = document.documentElement;

function resetRoot() {
  delete root.dataset.theme;
  delete root.dataset.popoutTone;
  for (const attr of [...root.attributes]) {
    if (attr.name.startsWith('data-crt-')) root.removeAttribute(attr.name);
  }
}

describe('popout skin and layout preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRoot();
  });
  afterEach(() => {
    localStorage.clear();
    resetRoot();
  });

  it('defaults to the mIRC skin with classic lines', () => {
    expect(getSavedPopoutSkin()).toBe('mirc');
    expect(getSavedPopoutLayout()).toBe('lines');
  });

  it('remembers a choice and ignores junk', () => {
    savePopoutSkin('mirc-dark');
    savePopoutLayout('bubbles');
    expect(getSavedPopoutSkin()).toBe('mirc-dark');
    expect(getSavedPopoutLayout()).toBe('bubbles');

    localStorage.setItem(POPOUT_SKIN_KEY, 'hotdog-stand');
    localStorage.setItem(POPOUT_LAYOUT_KEY, 'sideways');
    expect(getSavedPopoutSkin()).toBe('mirc');
    expect(getSavedPopoutLayout()).toBe('lines');
  });

  it('paints a mIRC skin without touching the saved app theme', () => {
    localStorage.setItem(THEME_KEY, 'cyberpunk');

    applyPopoutSkin('mirc-dark');

    expect(root.dataset.theme).toBe('mirc-dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('cyberpunk');
  });

  it('follows the saved app theme for the theme skin', () => {
    localStorage.setItem(THEME_KEY, 'cyberpunk');
    applyPopoutSkin('theme');
    expect(root.dataset.theme).toBe('cyberpunk');

    localStorage.setItem(THEME_KEY, 'original');
    applyPopoutSkin('theme');
    expect(root.dataset.theme).toBeUndefined();
  });

  it('switches CRT effects off under a mIRC skin even when they are forced on', () => {
    localStorage.setItem(THEME_KEY, 'crt-green');
    applyPopoutSkin('theme');
    expect(root.getAttribute('data-crt-scanlines')).toBe('1');

    applyPopoutSkin('mirc');
    expect(root.getAttribute('data-crt-scanlines')).toBe('0');
  });

  it('re-applies when the main app changes theme and adopts changes from another popup', () => {
    const onSkin = vi.fn();
    const onLayout = vi.fn();
    const stop = watchPopoutAppearance({ getSkin: () => 'theme', onSkin, onLayout });

    localStorage.setItem(THEME_KEY, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY }));
    expect(root.dataset.theme).toBe('light');

    localStorage.setItem(POPOUT_SKIN_KEY, 'mirc-dark');
    window.dispatchEvent(new StorageEvent('storage', { key: POPOUT_SKIN_KEY }));
    expect(onSkin).toHaveBeenCalledWith('mirc-dark');

    localStorage.setItem(POPOUT_LAYOUT_KEY, 'bubbles');
    window.dispatchEvent(new StorageEvent('storage', { key: POPOUT_LAYOUT_KEY }));
    expect(onLayout).toHaveBeenCalledWith('bubbles');

    stop();
    localStorage.setItem(THEME_KEY, 'cyberpunk');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY }));
    expect(root.dataset.theme).toBe('light');
  });
});
