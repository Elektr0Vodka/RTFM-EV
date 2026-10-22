// Recent advert paths for every contact, shared by the map's guessed-locations
// layer and its hops filter. Fetched only while one of them needs it, then
// refreshed on an interval so new adverts show up without reopening the map.

import { useEffect, useState } from 'react';

import { api } from '../api';
import type { ContactAdvertPathSummary } from '../types';

const ADVERT_PATHS_REFRESH_MS = 60_000;

/** null until the first fetch completes (and whenever `enabled` is off). */
export function useAdvertPathSummaries(enabled: boolean): ContactAdvertPathSummary[] | null {
  const [summaries, setSummaries] = useState<ContactAdvertPathSummary[] | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSummaries(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      api
        .getRepeaterAdvertPaths()
        .then((data) => {
          if (!cancelled) setSummaries(data);
        })
        .catch((err) => {
          if (!cancelled) console.error('Failed to load advert paths for the map:', err);
        });
    };
    load();
    const timer = window.setInterval(load, ADVERT_PATHS_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return summaries;
}
