import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../api';
import { toast } from '../components/ui/sonner';
import type { SpamGuardSettings, SpamGuardState } from '../types';
import { subscribeSpamGuardEvents } from '../utils/spamGuardEvents';

/** Refetch this often while the page is open: counters move without a WS event. */
const POLL_MS = 30_000;
/** Several WS events in a burst (a spam wave) become one refetch. */
const EVENT_DEBOUNCE_MS = 400;

/**
 * Spam Guard state for the page and the settings card.
 *
 * The server holds the detail; the WS `spam_guard` event is only a nudge, so
 * the hook refetches (debounced) when one arrives and on a slow poll. Actions
 * answer with the new state directly. Settings are versioned: a stale save
 * answers 409, which reloads so the user sees what changed elsewhere.
 */
export function useSpamGuard(active = true) {
  const [state, setState] = useState<SpamGuardState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      setState(await api.getSpamGuard());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void reload();
    const unsubscribe = subscribeSpamGuardEvents(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void reload(), EVENT_DEBOUNCE_MS);
    });
    const poll = setInterval(() => void reload(), POLL_MS);
    return () => {
      unsubscribe();
      clearInterval(poll);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, reload]);

  const action = useCallback(
    async (op: string, args: Record<string, unknown> = {}, messageId?: number | null) => {
      setBusy(true);
      try {
        const outcome = await api.spamGuardAction(op, args, messageId);
        setState(outcome.state);
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const version = state?.version;
  const save = useCallback(
    async (settings: SpamGuardSettings) => {
      if (version === undefined) return false;
      setBusy(true);
      try {
        setState(await api.saveSpamGuardSettings(version, settings));
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        // 409: saved elsewhere in the meantime, or refused for this radio.
        if (err instanceof ApiError && err.status === 409) await reload();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [version, reload]
  );

  return { state, loadError, busy, reload, action, save };
}

export type SpamGuardController = ReturnType<typeof useSpamGuard>;
