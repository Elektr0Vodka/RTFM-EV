import { useCallback, useMemo, useState } from 'react';

import { HOP_BYTE_WIDTH_BUCKETS, KNOWN_PAYLOAD_TYPES } from '../utils/rawPacketStats';

/**
 * Normalize a raw-hex filter query. Lowercases, strips whitespace, `:`
 * separators, and a leading `0x`. Returns `invalid: true` when non-hex
 * characters remain so the UI can hint. Matches against `RawPacket.data`
 * (stored lowercase hex). Moved here from RawPacketFeedView so the hook and
 * every filter surface share one implementation.
 */
export function normalizeHexQuery(raw: string): { query: string; invalid: boolean } {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^0x/, '')
    .replace(/[\s:]+/g, '');
  if (cleaned === '') return { query: '', invalid: false };
  return { query: cleaned, invalid: !/^[0-9a-f]+$/.test(cleaned) };
}

export interface PacketFilters {
  enabledTypes: Set<string>;
  enabledHopWidths: Set<string>;
  hexFilter: string;
  groupByHash: boolean;

  allTypesEnabled: boolean;
  allHopWidthsEnabled: boolean;
  hexQuery: string;
  hexInvalid: boolean;
  activeFilterCount: number;

  toggleAll: () => void;
  toggleType: (type: string) => void;
  onlyType: (type: string) => void;
  toggleAllHopWidths: () => void;
  toggleHopWidth: (bucket: string) => void;
  onlyHopWidth: (bucket: string) => void;
  setHexFilter: (value: string) => void;
  setGroupByHash: (value: boolean) => void;
  reset: () => void;
}

export function usePacketFilters(): PacketFilters {
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(() => new Set(KNOWN_PAYLOAD_TYPES));
  const [enabledHopWidths, setEnabledHopWidths] = useState<Set<string>>(
    () => new Set(HOP_BYTE_WIDTH_BUCKETS)
  );
  const [hexFilter, setHexFilter] = useState('');
  const [groupByHash, setGroupByHash] = useState(false);

  const allTypesEnabled = enabledTypes.size === KNOWN_PAYLOAD_TYPES.length;
  const allHopWidthsEnabled = enabledHopWidths.size === HOP_BYTE_WIDTH_BUCKETS.length;

  const { query: hexQuery, invalid: hexInvalid } = useMemo(
    () => normalizeHexQuery(hexFilter),
    [hexFilter]
  );

  const activeFilterCount =
    KNOWN_PAYLOAD_TYPES.length -
    enabledTypes.size +
    (HOP_BYTE_WIDTH_BUCKETS.length - enabledHopWidths.size) +
    (hexFilter.trim() !== '' ? 1 : 0) +
    (groupByHash ? 1 : 0);

  const toggleAll = useCallback(() => {
    setEnabledTypes((prev) =>
      prev.size === KNOWN_PAYLOAD_TYPES.length ? new Set() : new Set(KNOWN_PAYLOAD_TYPES)
    );
  }, []);

  const toggleType = useCallback((type: string) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const onlyType = useCallback((type: string) => setEnabledTypes(new Set([type])), []);

  const toggleAllHopWidths = useCallback(() => {
    setEnabledHopWidths((prev) =>
      prev.size === HOP_BYTE_WIDTH_BUCKETS.length ? new Set() : new Set(HOP_BYTE_WIDTH_BUCKETS)
    );
  }, []);

  const toggleHopWidth = useCallback((bucket: string) => {
    setEnabledHopWidths((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }, []);

  const onlyHopWidth = useCallback((bucket: string) => setEnabledHopWidths(new Set([bucket])), []);

  const reset = useCallback(() => {
    setEnabledTypes(new Set(KNOWN_PAYLOAD_TYPES));
    setEnabledHopWidths(new Set(HOP_BYTE_WIDTH_BUCKETS));
    setHexFilter('');
    setGroupByHash(false);
  }, []);

  return {
    enabledTypes,
    enabledHopWidths,
    hexFilter,
    groupByHash,
    allTypesEnabled,
    allHopWidthsEnabled,
    hexQuery,
    hexInvalid,
    activeFilterCount,
    toggleAll,
    toggleType,
    onlyType,
    toggleAllHopWidths,
    toggleHopWidth,
    onlyHopWidth,
    setHexFilter,
    setGroupByHash,
    reset,
  };
}
