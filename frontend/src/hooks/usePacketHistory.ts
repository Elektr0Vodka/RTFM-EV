import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api';
import type { PacketFilters } from './usePacketFilters';
import type { Channel, RawPacket } from '../types';
import { getRawPacketObservationKey } from '../utils/rawPacketIdentity';
import { buildHistoryParams } from '../utils/packetHistoryQuery';
import { matchesPacketFilters } from '../utils/packetFilterPredicate';

const PAGE_LIMIT = 500;

interface UsePacketHistoryArgs {
  startTs: number;
  endTs: number;
  filters: PacketFilters;
  /** When true, in-window live packets that pass the filter are appended. */
  isLive: boolean;
  /** The live packet buffer (e.g. from useRawPackets). */
  livePackets: RawPacket[];
  channels?: Channel[];
  /** When false, no fetch runs and rows stay empty (e.g. custom range not set). */
  enabled?: boolean;
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
  isLive,
  livePackets,
  channels,
  enabled = true,
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
      limit: PAGE_LIMIT,
    }),
    [startTs, endTs, filters.enabledTypes, filters.enabledHopWidths, filters.hexQuery]
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
  }, [baseInput, filters.hexInvalid, enabled]);

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

  // Live-append: in-window, filter-passing packets not already loaded.
  const displayed = useMemo(() => {
    if (!isLive) return rows;
    const seen = new Set(rows.map(getRawPacketObservationKey));
    const extra = livePackets.filter(
      (p) =>
        p.timestamp >= startTs &&
        p.timestamp <= endTs &&
        !seen.has(getRawPacketObservationKey(p)) &&
        matchesPacketFilters(p, filters, channels)
    );
    return extra.length > 0 ? [...rows, ...extra] : rows;
  }, [rows, isLive, livePackets, startTs, endTs, filters, channels]);

  return { rows: displayed, loading, error, nextCursor, loadOlder };
}
