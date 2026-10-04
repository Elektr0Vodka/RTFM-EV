import type { MessageLayout } from '../contexts/MessageLayoutContext';
import { applyCrt, CRT_EFFECTS } from '../utils/crt';
import { getEffectiveTheme, isDarkTheme, THEME_CHANGE_EVENT, THEME_KEY } from '../utils/theme';

/**
 * Skin of the chat popup. `mirc` and `mirc-dark` are popup-only looks defined
 * in popout.css; `theme` follows whatever theme the main app has saved.
 */
export type PopoutSkin = 'mirc' | 'mirc-dark' | 'theme';

export const POPOUT_SKINS: readonly PopoutSkin[] = ['mirc', 'mirc-dark', 'theme'];
export const DEFAULT_POPOUT_SKIN: PopoutSkin = 'mirc';
export const DEFAULT_POPOUT_LAYOUT: MessageLayout = 'lines';

export const POPOUT_SKIN_KEY = 'rtfm-popout-skin';
export const POPOUT_LAYOUT_KEY = 'rtfm-popout-layout';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage may be unavailable
  }
}

export function getSavedPopoutSkin(): PopoutSkin {
  const raw = read(POPOUT_SKIN_KEY);
  return (POPOUT_SKINS as readonly string[]).includes(raw ?? '')
    ? (raw as PopoutSkin)
    : DEFAULT_POPOUT_SKIN;
}

export function savePopoutSkin(skin: PopoutSkin): void {
  write(POPOUT_SKIN_KEY, skin);
}

export function getSavedPopoutLayout(): MessageLayout {
  const raw = read(POPOUT_LAYOUT_KEY);
  return raw === 'bubbles' || raw === 'lines' ? raw : DEFAULT_POPOUT_LAYOUT;
}

export function savePopoutLayout(layout: MessageLayout): void {
  write(POPOUT_LAYOUT_KEY, layout);
}

/**
 * Paint a skin onto this document. Unlike applyTheme it never saves, so the
 * main app's theme preference is untouched by anything the popup does.
 */
export function applyPopoutSkin(skin: PopoutSkin): void {
  const root = document.documentElement;
  const effective = skin === 'theme' ? getEffectiveTheme() : skin;
  if (effective === 'original') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = effective;
  }

  applyCrt();
  if (skin !== 'theme') {
    // An explicitly enabled CRT effect applies to every theme; the mIRC skins
    // are not themes the user picked those effects for.
    for (const effect of CRT_EFFECTS) {
      root.setAttribute(`data-crt-${effect}`, '0');
    }
  }

  const dark = isDarkTheme();
  root.dataset.popoutTone = dark ? 'dark' : 'light';
  try {
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch {
    // style may be unavailable in exotic environments
  }
}

/**
 * Keep the popup's look current: a theme change in the main app (other
 * document, so a `storage` event), a skin or layout change in another popup,
 * and the Follow-OS listener re-applying the saved theme in this document.
 */
export function watchPopoutAppearance(handlers: {
  getSkin: () => PopoutSkin;
  onSkin: (skin: PopoutSkin) => void;
  onLayout: (layout: MessageLayout) => void;
}): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === POPOUT_SKIN_KEY) {
      handlers.onSkin(getSavedPopoutSkin());
    } else if (event.key === POPOUT_LAYOUT_KEY) {
      handlers.onLayout(getSavedPopoutLayout());
    } else if (event.key === THEME_KEY) {
      applyPopoutSkin(handlers.getSkin());
    }
  };
  const onThemeChange = () => applyPopoutSkin(handlers.getSkin());
  window.addEventListener('storage', onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  };
}
