import { useEffect, useState } from 'react';
import { getThemeLayout, THEME_CHANGE_EVENT, type ThemeLayout } from '../utils/theme';

/**
 * The layout the active theme asks the app shell for, re-read on theme changes.
 * "Follow OS" only ever resolves to Light or Original, both classic, so OS
 * colour-scheme changes need no listener here.
 */
export function useThemeLayout(): ThemeLayout {
  const [layout, setLayout] = useState<ThemeLayout>(() => getThemeLayout());
  useEffect(() => {
    const update = () => setLayout(getThemeLayout());
    update();
    window.addEventListener(THEME_CHANGE_EVENT, update);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, update);
  }, []);
  return layout;
}
