// Keeps the screen on while a drive runs: with the phone in a holder the
// screen would otherwise turn off, and a hidden page gets throttled. The
// browser drops the lock whenever the page is hidden, so it is asked for
// again when the page comes back. Where there is no Screen Wake Lock API
// nothing happens.
import { useEffect } from 'react';

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!active || !api) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const lock = await api.request('screen');
        if (cancelled) await lock.release();
        else sentinel = lock;
      } catch {
        // Refused (battery saver, page not visible): the drive goes on.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
