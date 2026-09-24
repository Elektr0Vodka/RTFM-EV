import { useEffect, useState } from 'react';
import { api } from '../api';
import { subscribeHostRepeaterEvents } from '../utils/hostRepeaterEvents';

/**
 * Whether the host repeater is armed (live forwarding on air), for the navbar badge.
 *
 * Reads the state once on mount (best-effort; a failed read means "not armed") and
 * then follows the WS `host_repeater` event, which every arm / disarm broadcasts.
 */
export function useHostRepeaterArmed(): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .getHostRepeater()
      .then((state) => {
        if (!cancelled) setArmed(state.state === 'armed');
      })
      .catch(() => {
        // Older backend or transient error: no badge until an event says otherwise.
      });
    const unsubscribe = subscribeHostRepeaterEvents((payload) => {
      setArmed(payload.state === 'armed');
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return armed;
}
