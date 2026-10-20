// Full screen for the whole page: the browser's address and navigation bars
// go away, so the map gets the phone's whole screen. Off where the browser
// has no Fullscreen API for pages (an iPhone). Leaving it (back gesture,
// swipe) is followed through fullscreenchange.
import { useCallback, useEffect, useState } from 'react';

export type FullscreenState = 'unsupported' | 'off' | 'on';

function supported(): boolean {
  return typeof document.documentElement.requestFullscreen === 'function';
}

function current(): FullscreenState {
  if (!supported()) return 'unsupported';
  return document.fullscreenElement === document.documentElement ? 'on' : 'off';
}

export function useFullscreen(): { state: FullscreenState; toggle: () => Promise<void> } {
  const [state, setState] = useState<FullscreenState>(current);

  useEffect(() => {
    const onChange = () => setState(current());
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Refused (no gesture, or a browser setting): the page stays as it is.
    }
    setState(current());
  }, []);

  return { state, toggle };
}
