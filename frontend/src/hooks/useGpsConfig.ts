import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { GpsConfig, GpsConfigUpdate } from '../types';

/**
 * GPS state via the generic custom-vars protocol (GET/PATCH /radio/gps).
 * Unlike useMeshcomodConfig, this is not gated on the meshcomod DMC/DMC-EV
 * fork: any connected radio that reports the `gps` custom var can use it.
 */

let cache: GpsConfig | null = null;
let inflight: Promise<GpsConfig> | null = null;

function broadcast(cfg: GpsConfig | null): void {
  cache = cfg;
}

/** Test-only: clear the module cache between cases. */
export function __resetGpsConfigCache(): void {
  cache = null;
  inflight = null;
}

export interface UseGpsConfig {
  config: GpsConfig | null;
  setGps: (update: GpsConfigUpdate) => Promise<void>;
}

export function useGpsConfig(enabled: boolean): UseGpsConfig {
  const [config, setConfig] = useState<GpsConfig | null>(cache);

  useEffect(() => {
    if (!enabled) return;
    if (cache !== null) {
      setConfig(cache);
      return;
    }
    if (!inflight) {
      inflight = api.getGpsConfig();
      inflight
        .then((cfg) => {
          broadcast(cfg);
          setConfig(cfg);
        })
        .catch((err) => console.error('Failed to load GPS config:', err))
        .finally(() => {
          inflight = null;
        });
    }
  }, [enabled]);

  const setGps = useCallback(async (update: GpsConfigUpdate) => {
    const next = await api.updateGpsConfig(update);
    broadcast(next);
    setConfig(next);
  }, []);

  return { config, setGps };
}
