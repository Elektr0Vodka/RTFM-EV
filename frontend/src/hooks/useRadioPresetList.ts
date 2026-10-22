import { useEffect, useState } from 'react';

import { api } from '../api';
import type { RadioPresetEntry, RadioStamp } from '../types';
import { RADIO_PRESETS } from '../utils/radioPresets';

/**
 * The preset list Settings > Radio shows: the list last synced from the
 * official MeshCore presets API, else the bundled built-in list. Read-only;
 * syncing stays in Settings > Radio.
 */
export function useRadioPresetList(enabled = true): RadioPresetEntry[] {
  const [list, setList] = useState<RadioPresetEntry[]>(RADIO_PRESETS);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .getRadioPresets()
      .then((store) => {
        if (cancelled) return;
        setList(
          store.synced_at !== null && store.entries.length > 0 ? store.entries : RADIO_PRESETS
        );
      })
      .catch(() => {
        // Keep the built-in list if the backend is unreachable.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return list;
}

/** Name of the preset matching these settings exactly, or 'custom'. */
export function matchPreset(list: RadioPresetEntry[], stamp: Partial<RadioStamp>): string {
  const found = list.find(
    (p) => p.freq === stamp.freq && p.bw === stamp.bw && p.sf === stamp.sf && p.cr === stamp.cr
  );
  return found ? found.name : 'custom';
}
