// The wardrive page wears the theme the main app saved (same origin, same
// keys): theme, CRT effects, font scale, reading font and colourblind mode,
// booted the way src/main.tsx does. A theme picked in another tab is followed
// too. Returns a function that stops following.
import {
  applyCvdMode,
  applyReadingFont,
  followAccessibilityFromOtherWindows,
  getSavedCvdMode,
  getSavedReadingFont,
} from '../utils/accessibility';
import { applyCrt } from '../utils/crt';
import { applyFontScale, getSavedFontScale } from '../utils/fontScale';
import { THEME_KEY, applyTheme, getSavedTheme, initFollowOSListener } from '../utils/theme';

export function bootWardriveTheme(): () => void {
  applyTheme(getSavedTheme());
  applyCrt();
  initFollowOSListener();
  applyFontScale(getSavedFontScale());
  applyReadingFont(getSavedReadingFont());
  applyCvdMode(getSavedCvdMode());
  const stopAccessibility = followAccessibilityFromOtherWindows();
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY) applyTheme(getSavedTheme());
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('storage', onStorage);
    stopAccessibility();
  };
}
