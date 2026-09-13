import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CRT_EFFECTS,
  CRT_PHOSPHORS,
  DEFAULT_CRT_PHOSPHOR,
  applyCrt,
  getCrtEffect,
  getCrtPhosphor,
  setCrtEffect,
  setCrtPhosphor,
} from '../utils/crt';

describe('crt module', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-crt-phosphor');
    for (const e of CRT_EFFECTS) {
      document.documentElement.removeAttribute(`data-crt-${e}`);
    }
  });
  afterEach(() => localStorage.clear());

  it('defaults phosphor to green and effects to on', () => {
    expect(getCrtPhosphor()).toBe(DEFAULT_CRT_PHOSPHOR);
    expect(DEFAULT_CRT_PHOSPHOR).toBe('green');
    for (const e of CRT_EFFECTS) {
      expect(getCrtEffect(e)).toBe(true);
    }
  });

  it('applyCrt stamps phosphor and effect attributes on <html>', () => {
    setCrtPhosphor('amber');
    setCrtEffect('flicker', false);
    applyCrt();
    const root = document.documentElement;
    expect(root.getAttribute('data-crt-phosphor')).toBe('amber');
    expect(root.getAttribute('data-crt-flicker')).toBe('0');
    expect(root.getAttribute('data-crt-scanlines')).toBe('1');
  });

  it('ignores an unknown stored phosphor and falls back to green', () => {
    localStorage.setItem('remoteterm-crt-phosphor', 'chartreuse');
    expect(getCrtPhosphor()).toBe('green');
  });

  it('exposes exactly the four phosphors and four effects', () => {
    expect([...CRT_PHOSPHORS]).toEqual(['green', 'amber', 'white', 'blue']);
    expect([...CRT_EFFECTS]).toEqual(['scanlines', 'glow', 'curvature', 'flicker']);
  });
});
