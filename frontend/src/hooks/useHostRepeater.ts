import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { HostRepeaterSettings, HostRepeaterState, HostRepeaterStats } from '../types';
import { subscribeHostRepeaterEvents } from '../utils/hostRepeaterEvents';

const STATS_POLL_MS = 5000;

export type HostRepeaterSaveResult =
  | { ok: true }
  | { ok: false; conflict: true }
  | { ok: false; conflict: false; errors: { loc: string; msg: string }[]; message?: string };

/**
 * Host repeater settings (plan 29) with optimistic versioning.
 *
 * The server holds one versioned settings document. `draft` is this browser's
 * edit copy. A WS `host_repeater` event from another browser replaces the draft
 * when there are no local edits; with local edits it sets `remoteChanged` so the
 * user can reload instead of overwriting (the server would answer 409 anyway).
 */
export function useHostRepeater(enabled: boolean) {
  const [state, setState] = useState<HostRepeaterState | null>(null);
  const [draft, setDraft] = useState<HostRepeaterSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [stats, setStats] = useState<HostRepeaterStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const reload = useCallback(async () => {
    try {
      const next = await api.getHostRepeater();
      setState(next);
      setDraft(next.settings);
      setDirty(false);
      setRemoteChanged(false);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    return subscribeHostRepeaterEvents(() => {
      if (dirtyRef.current) {
        setRemoteChanged(true);
        return;
      }
      void reload();
    });
  }, [enabled, reload]);

  const shadowOn = state?.state === 'shadow';
  useEffect(() => {
    if (!enabled || !shadowOn) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api.getHostRepeaterStats();
        if (!cancelled) setStats(next);
      } catch {
        // Stats are best-effort; the next tick retries.
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), STATS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, shadowOn]);

  const update = useCallback((patch: Partial<HostRepeaterSettings>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const save = useCallback(
    async (settings: HostRepeaterSettings | null = draft): Promise<HostRepeaterSaveResult> => {
      if (!state || !settings) return { ok: false, conflict: false, errors: [] };
      const check = await api.validateHostRepeaterSettings(settings);
      if (!check.valid) return { ok: false, conflict: false, errors: check.errors };
      try {
        const next = await api.saveHostRepeaterSettings(state.version, settings);
        setState(next);
        setDraft(next.settings);
        setDirty(false);
        setRemoteChanged(false);
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          return { ok: false, conflict: true };
        }
        return {
          ok: false,
          conflict: false,
          errors: [],
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [draft, state]
  );

  const discard = useCallback(() => {
    if (state) setDraft(state.settings);
    setDirty(false);
  }, [state]);

  const resetStats = useCallback(async () => {
    await api.resetHostRepeaterStats();
    setStats(await api.getHostRepeaterStats());
  }, []);

  return {
    state,
    draft,
    dirty,
    remoteChanged,
    stats,
    loadError,
    update,
    save,
    discard,
    reload,
    resetStats,
  };
}
