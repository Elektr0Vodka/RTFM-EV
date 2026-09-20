import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api';
import type { PacketFilters } from './usePacketFilters';
import type { RawPacket } from '../types';
import { buildHistoryParams } from '../utils/packetHistoryQuery';

const PAGE_LIMIT = 500;

interface UsePacketHistoryArgs {
  startTs: number;
  endTs: number;
  filters: PacketFilters;
  /** When false, no fetch runs and rows stay empty (e.g. custom range not set). */
  enabled?: boolean;
  /** Bump to force a re-query without changing the range or filters (manual
   *  refresh). Presets should also re-anchor their window to "now" on refresh. */
  refreshToken?: number;
}

export interface UsePacketHistoryResult {
  rows: RawPacket[];
  loading: boolean;
  error: string | null;
  nextCursor: number | null;
  loadOlder: () => Promise<void>;
}

export function usePacketHistory({
  startTs,
  endTs,
  filters,
  enabled = true,
  refreshToken = 0,
}: UsePacketHistoryArgs): UsePacketHistoryResult {
  const [rows, setRows] = useState<RawPacket[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const baseInput = useMemo(
    () => ({
      startTs,
      endTs,
      enabledTypes: filters.enabledTypes,
      enabledHopWidths: filters.enabledHopWidths,
      hexQuery: filters.hexQuery,
      searchTerm: filters.searchTerm,
      limit: PAGE_LIMIT,
    }),
    [
      startTs,
      endTs,
      filters.enabledTypes,
      filters.enabledHopWidths,
      filters.hexQuery,
      filters.searchTerm,
    ]
  );

  // Fresh fetch whenever the range or filters change.
  useEffect(() => {
    if (!enabled || filters.hexInvalid) {
      setRows([]);
      setNextCursor(null);
      setError(null);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    api
      .getPacketHistory(buildHistoryParams(baseInput))
      .then((res) => {
        if (id !== reqId.current) return;
        setRows([...res.packets].reverse()); // server newest-first -> oldest-first
        setNextCursor(res.next_cursor);
      })
      .catch((e) => {
        if (id === reqId.current) setError(String(e));
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [baseInput, filters.hexInvalid, enabled, refreshToken]);

  const loadOlder = useCallback(async () => {
    if (nextCursor == null) return;
    setLoading(true);
    try {
      const res = await api.getPacketHistory(
        buildHistoryParams({ ...baseInput, beforeId: nextCursor })
      );
      setRows((prev) => [...[...res.packets].reverse(), ...prev]); // older rows on top
      setNextCursor(res.next_cursor);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [baseInput, nextCursor]);

  return { rows, loading, error, nextCursor, loadOlder };
}
