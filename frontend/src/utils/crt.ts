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

const PHOSPHOR_KEY = 'remoteterm-crt-phosphor';
const effectKey = (effect: CrtEffect): string => `remoteterm-crt-${effect}`;

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
