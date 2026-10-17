import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  getSavedCvdMode,
  watchAccessibility,
  type CvdMode,
  type Tone,
} from '../utils/accessibility';
import { getDataColors, type DataColors } from '../utils/cvd/palettes';
import { THEME_CHANGE_EVENT } from '../utils/theme';

function pageTone(): Tone {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.tone === 'light' ? 'light' : 'dark';
}

/** The saved colourblind mode, re-rendering when it changes (here or in another tab). */
export function useCvdMode(): CvdMode {
  const [mode, setMode] = useState<CvdMode>(getSavedCvdMode);
  useEffect(() => watchAccessibility(() => setMode(getSavedCvdMode())), []);
  return mode;
}

/**
 * Map and chart colours for the current colourblind mode (today's colours when
 * off). `tone` is the surface the colours sit on: pass the basemap tone for
 * map marks; leave it out for in-page charts, which follow the theme's cards.
 */
export function useCvdColors(tone?: Tone): DataColors {
  const mode = useCvdMode();
  const [themeTone, setThemeTone] = useState<Tone>(pageTone);
  useEffect(() => {
    const sync = () => setThemeTone(pageTone());
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    const stop = watchAccessibility(sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      stop();
    };
  }, []);
  const effectiveTone = tone ?? themeTone;
  return useMemo(() => getDataColors(mode, effectiveTone), [mode, effectiveTone]);
}

/**
 * Colour for chart series `i`: the chart's own colour when the mode is off,
 * otherwise the palette's series (cycled). Use for charts that tell several
 * series apart by colour; single-colour charts need nothing.
 */
export function useSeriesColor(): (i: number, offColor: string) => string {
  const mode = useCvdMode();
  const { series } = useCvdColors();
  return useCallback(
    (i: number, offColor: string) => (mode === 'off' ? offColor : series[i % series.length]),
    [mode, series]
  );
}
