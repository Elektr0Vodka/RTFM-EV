import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CRT_CHANGE_EVENT,
  CRT_EFFECTS,
  CRT_PHOSPHORS,
  CRT_PHOSPHOR_HUE,
  DEFAULT_CRT_PHOSPHOR,
  applyCrt,
  getActiveCrtPhosphor,
  getCrtEffect,
  getCrtMapTint,
  isCrtThemeId,
  legacyCrtThemeId,
  setCrtEffect,
  setCrtMapTint,
} from '../utils/crt';

describe('crt module', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    for (const e of CRT_EFFECTS) {
      document.documentElement.removeAttribute(`data-crt-${e}`);
    }
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('exposes exactly the four phosphors and four effects', () => {
    expect([...CRT_PHOSPHORS]).toEqual(['green', 'amber', 'white', 'blue']);
    expect([...CRT_EFFECTS]).toEqual(['scanlines', 'glow', 'curvature', 'flicker']);
    expect(DEFAULT_CRT_PHOSPHOR).toBe('green');
  });

  it('defines a hue for every phosphor', () => {
    for (const p of CRT_PHOSPHORS) {
      expect(typeof CRT_PHOSPHOR_HUE[p]).toBe('number');
    }
  });

  it('derives the active phosphor from the theme, or null off a CRT theme', () => {
    expect(getActiveCrtPhosphor()).toBeNull();
    document.documentElement.dataset.theme = 'cyberpunk';
    expect(getActiveCrtPhosphor()).toBeNull();
    document.documentElement.dataset.theme = 'crt-blue';
    expect(getActiveCrtPhosphor()).toBe('blue');
  });

  it('recognises CRT theme ids', () => {
    expect(isCrtThemeId('crt-green')).toBe(true);
    expect(isCrtThemeId('crt-white')).toBe(true);
    expect(isCrtThemeId('crt')).toBe(false);
    expect(isCrtThemeId('cyberpunk')).toBe(false);
    expect(isCrtThemeId(null)).toBe(false);
  });

  it('effects default on under a CRT theme and off otherwise', () => {
    for (const e of CRT_EFFECTS) expect(getCrtEffect(e)).toBe(false);
    document.documentElement.dataset.theme = 'crt-green';
    for (const e of CRT_EFFECTS) expect(getCrtEffect(e)).toBe(true);
  });

  it('an explicit effect value overrides the theme default (works on any theme)', () => {
    // Opt an effect on while on a non-CRT theme (universal overlay).
    document.documentElement.dataset.theme = 'light';
    setCrtEffect('glow', true);
    expect(getCrtEffect('glow')).toBe(true);
    // Opt an effect off while on a CRT theme.
    document.documentElement.dataset.theme = 'crt-green';
    setCrtEffect('scanlines', false);
    expect(getCrtEffect('scanlines')).toBe(false);
  });

  it('applyCrt stamps only the effect attributes on <html>', () => {
    document.documentElement.dataset.theme = 'crt-green';
    setCrtEffect('flicker', false);
    applyCrt();
    const root = document.documentElement;
    expect(root.getAttribute('data-crt-flicker')).toBe('0');
    expect(root.getAttribute('data-crt-scanlines')).toBe('1');
    // Phosphor is carried by the theme, not stamped as an attribute.
    expect(root.getAttribute('data-crt-phosphor')).toBeNull();
  });

  it('map tint defaults off and round-trips', () => {
    expect(getCrtMapTint()).toBe(false);
    setCrtMapTint(true);
    expect(getCrtMapTint()).toBe(true);
    setCrtMapTint(false);
    expect(getCrtMapTint()).toBe(false);
  });

  it('dispatches a crt-change event when an effect or map tint changes', () => {
    let count = 0;
    const onChange = () => {
      count += 1;
    };
    window.addEventListener(CRT_CHANGE_EVENT, onChange);
    setCrtEffect('glow', false);
    setCrtMapTint(true);
    window.removeEventListener(CRT_CHANGE_EVENT, onChange);
    expect(count).toBe(2);
  });

  it('migrates the legacy phosphor preference to a CRT theme id', () => {
    expect(legacyCrtThemeId()).toBe('crt-green');
    localStorage.setItem('remoteterm-crt-phosphor', 'amber');
    expect(legacyCrtThemeId()).toBe('crt-amber');
    localStorage.setItem('remoteterm-crt-phosphor', 'chartreuse');
    expect(legacyCrtThemeId()).toBe('crt-green');
  });
});
