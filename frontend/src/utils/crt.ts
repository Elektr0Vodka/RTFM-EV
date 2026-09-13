/** CRT screen-effect preferences (scanlines, glow, curvature, flicker) plus the
 *  optional map tint.
 *
 *  The phosphor colour is no longer a standalone preference: it is carried by
 *  the selected theme (`crt-green` / `crt-amber` / `crt-white` / `crt-blue`, see
 *  theme.ts + themes.css). The effect toggles here are a theme-independent
 *  overlay: when an effect attribute is '1' it renders on top of ANY theme.
 *  Effects default ON while a CRT theme is active and OFF otherwise, so picking
 *  a CRT theme gives the full look out of the box while other themes stay clean
 *  until the user opts in. All state lives in localStorage and is applied as
 *  data attributes on <html>. */

export const CRT_PHOSPHORS = ['green', 'amber', 'white', 'blue'] as const;
export type CrtPhosphor = (typeof CRT_PHOSPHORS)[number];
export const DEFAULT_CRT_PHOSPHOR: CrtPhosphor = 'green';

export const CRT_EFFECTS = ['scanlines', 'glow', 'curvature', 'flicker'] as const;
export type CrtEffect = (typeof CRT_EFFECTS)[number];

/** Representative hue (HSL degrees) for each phosphor, matching the --crt-phosphor
 *  values in themes.css. Used to tint the Nova Dark map to the CRT colour. White
 *  has no meaningful hue, so it desaturates to greyscale (see mapTintDesaturate). */
export const CRT_PHOSPHOR_HUE: Record<CrtPhosphor, number> = {
  green: 123,
  amber: 38,
  white: 0,
  blue: 240,
};

/** Fired on <html> when a CRT preference that other views react to changes
 *  (effect toggles, the map-tint toggle, or the active phosphor via a theme
 *  change). The map listens to re-tint live. */
export const CRT_CHANGE_EVENT = 'remoteterm-crt-change';

const MAP_TINT_KEY = 'remoteterm-crt-map-tint';
/** Retired: the standalone phosphor preference, read only to migrate the old
 *  single `crt` theme to the matching `crt-<phosphor>` theme (see theme.ts). */
const LEGACY_PHOSPHOR_KEY = 'remoteterm-crt-phosphor';
const effectKey = (effect: CrtEffect): string => `remoteterm-crt-${effect}`;

function dispatchCrtChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event(CRT_CHANGE_EVENT));
  } catch {
    // Event constructor may be unavailable in some environments
  }
}

/** True when a theme id names one of the CRT phosphor themes. */
export function isCrtThemeId(themeId: string | null | undefined): boolean {
  return !!themeId && /^crt-(green|amber|white|blue)$/.test(themeId);
}

/** The phosphor of the currently applied theme, or null when the active theme
 *  is not a CRT theme. Derived from the <html> data-theme attribute (which
 *  applyTheme stamps) to avoid a circular import with theme.ts. */
export function getActiveCrtPhosphor(): CrtPhosphor | null {
  if (typeof document === 'undefined') return null;
  const theme = document.documentElement.dataset.theme ?? '';
  const m = /^crt-(green|amber|white|blue)$/.exec(theme);
  return m ? (m[1] as CrtPhosphor) : null;
}

/** Maps the retired single `crt` theme (+ stored phosphor) to the new theme id. */
export function legacyCrtThemeId(): string {
  try {
    const p = localStorage.getItem(LEGACY_PHOSPHOR_KEY);
    if (p && (CRT_PHOSPHORS as readonly string[]).includes(p)) {
      return `crt-${p}`;
    }
  } catch {
    // localStorage may be unavailable
  }
  return `crt-${DEFAULT_CRT_PHOSPHOR}`;
}

/** Whether to tint the Nova Dark map basemap to the active phosphor colour.
 *  Off by default: only an explicit '1' enables it. */
export function getCrtMapTint(): boolean {
  try {
    return localStorage.getItem(MAP_TINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setCrtMapTint(enabled: boolean): void {
  try {
    localStorage.setItem(MAP_TINT_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
  dispatchCrtChange();
}

/** An effect's on/off state. An explicit stored value wins; otherwise the
 *  default follows the active theme: ON under a CRT theme, OFF elsewhere. */
export function getCrtEffect(effect: CrtEffect): boolean {
  try {
    const stored = localStorage.getItem(effectKey(effect));
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // fall through to the theme-derived default
  }
  return getActiveCrtPhosphor() !== null;
}

export function setCrtEffect(effect: CrtEffect, enabled: boolean): void {
  try {
    localStorage.setItem(effectKey(effect), enabled ? '1' : '0');
  } catch {
    // ignore
  }
  applyCrt();
  dispatchCrtChange();
}

/** Stamp effect state onto <html> as data attributes. The phosphor colour is
 *  carried by the theme itself (data-theme), so it is not stamped here. */
export function applyCrt(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const effect of CRT_EFFECTS) {
    root.setAttribute(`data-crt-${effect}`, getCrtEffect(effect) ? '1' : '0');
  }
}
