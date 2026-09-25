// Map "relay signal" overlay (plan 21 S2): the Mesh Health relay-reception
// summary for the map's time window, drawn as SNR-coloured rings around the
// relays our radio heard copies from. Read-only: GET /packets/relay-reception.
// MapView owns the toggle; this hook owns fetch and layer.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';

import { api, isAbortError } from '../api';
import type { RelaySummary } from '../components/MeshRelayReceptionPanel';
import type { Contact } from '../types';
import { buildRelaySignalFeatures, createRelaySignalLayer } from './layers/relaySignalLayer';

const FETCH_DEBOUNCE_MS = 300;
/** Re-fetch interval while shown; relay receptions arrive continuously. */
const REFRESH_MS = 60_000;

export interface UseRelaySignalOptions {
  enabled: boolean;
  /** Window lower bound, Unix seconds; null = everything retained. */
  since: number | null;
  /** Window upper bound, Unix seconds; null = now. */
  until: number | null;
  /** Contacts with manual location overrides applied. */
  contacts: Contact[];
}

export function useRelaySignal({ enabled, since, until, contacts }: UseRelaySignalOptions) {
  const [relays, setRelays] = useState<RelaySummary[]>([]);
  const [tick, setTick] = useState(0);
  const layerRef = useRef<ReturnType<typeof createRelaySignalLayer> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) {
      setRelays([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const end = until != null ? Math.floor(until) : Math.floor(Date.now() / 1000);
      const start = since != null ? Math.floor(since) : 0;
      if (end <= start) {
        setRelays([]);
        return;
      }
      api
        .getRelayReception(start, end, 1, controller.signal)
        .then((res) => setRelays(res.relays))
        .catch((err) => {
          if (!isAbortError(err)) console.error('Failed to load relay reception:', err);
        });
    }, FETCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, since, until, tick]);

  // Open-ended windows keep filling; refresh them while the overlay is shown.
  useEffect(() => {
    if (!enabled || until != null) return;
    const id = window.setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [enabled, until]);

  const built = useMemo(() => buildRelaySignalFeatures(relays, contacts), [relays, contacts]);
  const builtRef = useRef(built);
  builtRef.current = built;

  useEffect(() => {
    layerRef.current?.setData(built.collection);
  }, [built]);
  useEffect(() => {
    layerRef.current?.setVisible(enabled);
  }, [enabled]);

  /** Create the layer on a ready map (call from MapView's handleReady, after the nodes). */
  const attach = useCallback((map: MlMap) => {
    const layer = createRelaySignalLayer(map);
    layer.ensure();
    layer.setData(builtRef.current.collection);
    layer.setVisible(enabledRef.current);
    layerRef.current = layer;
  }, []);

  /** Re-add the layer after a basemap style swap. */
  const reattach = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.reattach();
    layer.setData(builtRef.current.collection);
    layer.setVisible(enabledRef.current);
  }, []);

  return { attach, reattach, placed: built.placed, unplaced: built.unplaced };
}
