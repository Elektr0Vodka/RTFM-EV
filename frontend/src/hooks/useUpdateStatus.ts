import { useCallback, useEffect, useState } from 'react';

import { api } from '../api';
import type { UpdateStatus } from '../types';

let cached: Promise<UpdateStatus | null> | null = null;

function load(): Promise<UpdateStatus | null> {
  if (!cached) {
    cached = api.getUpdateStatus().catch(() => null);
  }
  return cached;
}

/** Test helper: clear the module-level session cache. */
export function __resetUpdateStatusCache(): void {
  cached = null;
}

export interface UseUpdateStatus {
  status: UpdateStatus | null;
  /** Force a fresh check (bypasses both the session cache and the 6h server TTL). */
  refresh: () => Promise<UpdateStatus | null>;
  refreshing: boolean;
}

export function useUpdateStatus(): UseUpdateStatus {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    load().then((value) => {
      if (active) setStatus(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<UpdateStatus | null> => {
    setRefreshing(true);
    try {
      const value = await api.getUpdateStatus(true).catch(() => null);
      // Re-seed the module cache so other consumers see the fresh result.
      cached = Promise.resolve(value);
      setStatus(value);
      return value;
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { status, refresh, refreshing };
}
