import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PartialNodeResolution } from '../types';

/** Applied soft links (plan 16 case (b), PR #152) keyed by lowercase prefix hex. */
export type SoftResolutionMap = Map<string, PartialNodeResolution>;

const EMPTY: SoftResolutionMap = new Map();

/**
 * Load the user-applied prefix -> node soft links once per mount (a DB read,
 * no radio traffic). Surfaces that show a raw or ambiguous hop prefix use it
 * to name the node the user linked that prefix to. Empty while loading or on
 * error, so callers fall back to their prefix-only display.
 */
export function useSoftResolutions(enabled = true): SoftResolutionMap {
  const [map, setMap] = useState<SoftResolutionMap>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => api.listPartialResolutions())
      .then((rows) => {
        if (cancelled) return;
        setMap(new Map(rows.map((r) => [r.prefix_hex.toLowerCase(), r])));
      })
      .catch(() => {
        if (!cancelled) setMap(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return map;
}
