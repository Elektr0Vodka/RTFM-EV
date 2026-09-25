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
    return subscribeHostRepeaterEvents((payload) => {
      if (dirtyRef.current) {
        // Keep the local edits, but follow the live armed / disarmed state so the
        // badge, the disarm reason and the kill switch stay truthful.
        setState((prev) =>
          prev
            ? {
                ...prev,
                state: payload.state,
                env_enabled: payload.env_enabled,
                armed_since: payload.armed_since ?? null,
                disarm_reason: payload.disarm_reason ?? null,
                rearm_pending: payload.rearm_pending ?? false,
              }
            : prev
        );
        setRemoteChanged(true);
        return;
      }
      void reload();
    });
  }, [enabled, reload]);

  // Poll while the engine runs; re-run (immediate tick) on shadow <-> armed transitions.
  const mode = state?.state;
  const engineOn = mode === 'shadow' || mode === 'armed';
  useEffect(() => {
    if (!enabled || !engineOn) return;
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
  }, [enabled, engineOn, mode]);

  /** Arm live forwarding (mode 'armed' + confirm) or leave it ('shadow' / 'off'). */
  const setMode = useCallback(
    async (mode: 'off' | 'shadow' | 'armed', confirm = false): Promise<HostRepeaterModeResult> => {
      try {
        const next = await api.setHostRepeaterMode(mode, confirm);
        setState((prev) => (prev && dirtyRef.current ? { ...prev, ...pickLive(next) } : next));
        if (!dirtyRef.current) setDraft(next.settings);
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const blockers = err.detail?.blockers;
          return {
            ok: false,
            blockers: Array.isArray(blockers) ? blockers.map(String) : [],
            message: err.message,
          };
        }
        return {
          ok: false,
          blockers: [],
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    []
  );

  /** Kill switch: stop forwarding now (also cancels a pending re-arm). */
  const disarm = useCallback(async () => {
    const next = await api.disarmHostRepeater();
    setState((prev) => (prev && dirtyRef.current ? { ...prev, ...pickLive(next) } : next));
    if (!dirtyRef.current) setDraft(next.settings);
  }, []);

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

  const resetStats = useCallback(async (lifetime = false) => {
    await api.resetHostRepeaterStats(lifetime);
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
    setMode,
    disarm,
  };
}

export type HostRepeaterModeResult =
  | { ok: true }
  | { ok: false; blockers: string[]; message?: string };

/** The live (non-settings) part of a state response, applied over local edits. */
function pickLive(next: HostRepeaterState): Partial<HostRepeaterState> {
  return {
    state: next.state,
    env_enabled: next.env_enabled,
    armed_since: next.armed_since,
    disarm_reason: next.disarm_reason,
    rearm_pending: next.rearm_pending,
    capabilities: next.capabilities,
  };
}
