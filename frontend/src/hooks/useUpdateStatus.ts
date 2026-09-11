import { useEffect, useState } from 'react';

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

export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    let active = true;
    load().then((value) => {
      if (active) setStatus(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return status;
}
