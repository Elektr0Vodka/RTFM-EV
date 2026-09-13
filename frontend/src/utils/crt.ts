/** Per-device CRT theme preferences (phosphor colour + effect toggles).
 *
 * These are display-only preferences stored in localStorage, mirroring the
 * existing theme selection. They are applied as data attributes on <html> and
 * are visually inert unless data-theme='crt' (themes.css gates on both). */

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
 *  (phosphor colour, or the map-tint toggle). The map listens to re-tint live. */
export const CRT_CHANGE_EVENT = 'remoteterm-crt-change';

const PHOSPHOR_KEY = 'remoteterm-crt-phosphor';
const MAP_TINT_KEY = 'remoteterm-crt-map-tint';
const effectKey = (effect: CrtEffect): string => `remoteterm-crt-${effect}`;

function dispatchCrtChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event(CRT_CHANGE_EVENT));
  } catch {
    // Event constructor may be unavailable in some environments
  }
}

export function getCrtPhosphor(): CrtPhosphor {
  try {
    const stored = localStorage.getItem(PHOSPHOR_KEY);
    if (stored && (CRT_PHOSPHORS as readonly string[]).includes(stored)) {
      return stored as CrtPhosphor;
    }
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_CRT_PHOSPHOR;
}

export function setCrtPhosphor(phosphor: CrtPhosphor): void {
  try {
    localStorage.setItem(PHOSPHOR_KEY, phosphor);
  } catch {
    // ignore
  }
  applyCrt();
  dispatchCrtChange();
}

/** Whether to tint the Nova Dark map basemap to the selected phosphor colour.
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

/** Effects default ON: only an explicit '0' disables them. */
export function getCrtEffect(effect: CrtEffect): boolean {
  try {
    return localStorage.getItem(effectKey(effect)) !== '0';
  } catch {
    return true;
  }
}

export function setCrtEffect(effect: CrtEffect, enabled: boolean): void {
  try {
    localStorage.setItem(effectKey(effect), enabled ? '1' : '0');
  } catch {
    // ignore
  }
  applyCrt();
}

/** Stamp phosphor + effect state onto <html> as data attributes. */
export function applyCrt(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-crt-phosphor', getCrtPhosphor());
  for (const effect of CRT_EFFECTS) {
    root.setAttribute(`data-crt-${effect}`, getCrtEffect(effect) ? '1' : '0');
  }
}
