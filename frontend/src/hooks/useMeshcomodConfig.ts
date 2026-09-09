import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { MeshcomodConfig } from '../types';

export const MESHCOMOD_CONFIG_CHANGE_EVENT = 'remoteterm-meshcomod-config-change';

// Module-level single source of truth. Reading CAD hits the radio, so the config
// is fetched at most once and shared by every consumer via the change event.
let cache: MeshcomodConfig | null = null;
let inflight: Promise<MeshcomodConfig> | null = null;

function broadcast(cfg: MeshcomodConfig | null): void {
  cache = cfg;
  window.dispatchEvent(new CustomEvent(MESHCOMOD_CONFIG_CHANGE_EVENT, { detail: cfg }));
}

/** Publish an externally-fetched config into the shared cache. */
export function broadcastMeshcomodConfig(cfg: MeshcomodConfig): void {
  broadcast(cfg);
}

/** Test-only: clear the module cache between cases. */
export function __resetMeshcomodConfigCache(): void {
  cache = null;
  inflight = null;
}

export interface UseMeshcomodConfig {
  config: MeshcomodConfig | null;
  cadSupported: boolean;
  cadEnabled: boolean | null;
  setCad: (value: boolean) => Promise<void>;
  toggleCad: () => Promise<void>;
}

export function useMeshcomodConfig(isMeshcomod: boolean): UseMeshcomodConfig {
  const [config, setConfig] = useState<MeshcomodConfig | null>(cache);

  // Stay in sync with every other consumer.
  useEffect(() => {
    const onChange = (e: Event) => setConfig((e as CustomEvent<MeshcomodConfig | null>).detail);
    window.addEventListener(MESHCOMOD_CONFIG_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(MESHCOMOD_CONFIG_CHANGE_EVENT, onChange);
  }, []);

  // Fetch once when we learn a meshcomod device is connected.
  useEffect(() => {
    if (!isMeshcomod) return;
    if (cache !== null) {
      setConfig(cache);
      return;
    }
    if (!inflight) {
      inflight = api.getMeshcomodConfig();
      inflight
        .then((cfg) => broadcast(cfg))
        .catch((err) => console.error('Failed to load meshcomod config:', err))
        .finally(() => {
          inflight = null;
        });
    }
  }, [isMeshcomod]);

  const setCad = useCallback(async (value: boolean) => {
    const next = await api.updateMeshcomodConfig({ cad_enabled: value });
    broadcast(next);
  }, []);

  const toggleCad = useCallback(async () => {
    const current = cache?.cad_enabled ?? null;
    await setCad(current === true ? false : true);
  }, [setCad]);

  return {
    config,
    cadSupported: config?.cad_supported ?? false,
    cadEnabled: config?.cad_enabled ?? null,
    setCad,
    toggleCad,
  };
}
