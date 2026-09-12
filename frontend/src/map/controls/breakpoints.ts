import { useEffect, useState } from 'react';

// Responsive vocabulary ported from EU-Meshcore-Analyzer web/js/lib/mobile.js.
// COMPACT_MAP_QUERY deliberately uses `pointer: coarse` (primary pointer), so a
// touch laptop with a trackpad stays on the floating desktop panels.
export const MOBILE_QUERY = '(max-width: 768px)';
export const COMPACT_MAP_QUERY = '(max-width: 1024px), (pointer: coarse)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try {
      return (
        typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches
      );
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    // older Safari (<14)
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [query]);
  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

export function useIsCompactMap(): boolean {
  return useMediaQuery(COMPACT_MAP_QUERY);
}
