import { useCallback, useEffect, useState } from 'react';

import { api } from '../api';
import type { FilterProfileKind, FilterProfilesState } from '../types';

/**
 * The profiles of one kind of the filter library.
 *
 * `version` is the settings version of the feature the profiles belong to.
 * When it changes, the profile in use may have become "modified" (or stopped
 * being so), so the list is loaded again.
 *
 * `run` performs a change and takes the server's answer as the new state. It
 * resolves to null, or to the raw error text for the caller to word.
 */
export function useFilterProfiles(kind: FilterProfileKind, version: number) {
  const [state, setState] = useState<FilterProfilesState | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setState(await api.getFilterProfiles(kind));
    } catch {
      // The card shows what it has; the next change or version reports the problem.
    }
  }, [kind]);

  useEffect(() => {
    void reload();
  }, [reload, version]);

  const run = useCallback(async (call: () => Promise<FilterProfilesState>) => {
    setBusy(true);
    try {
      setState(await call());
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, reload, run };
}
