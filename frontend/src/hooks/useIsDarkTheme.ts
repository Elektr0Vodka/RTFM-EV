import { useEffect, useState } from 'react';
import { isDarkTheme, THEME_CHANGE_EVENT } from '../utils/theme';

/**
 * Tracks whether the rendered theme is dark, re-evaluating on in-app theme
 * changes and OS color-scheme changes (for the "Follow OS" theme). Shared by
 * the raster maps so they swap basemaps uniformly.
 */
export function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => {
    const update = () => setDark(isDarkTheme());
    window.addEventListener(THEME_CHANGE_EVENT, update);
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    mql.addEventListener?.('change', update);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, update);
      mql.removeEventListener?.('change', update);
    };
  }, []);
  return dark;
}
