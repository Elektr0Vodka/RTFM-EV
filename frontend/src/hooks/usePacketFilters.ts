import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  HOP_BYTE_WIDTH_BUCKETS,
  KNOWN_PAYLOAD_TYPES,
  ROUTE_FILTER_TYPES,
} from '../utils/rawPacketStats';
import { SF_FILTER_BUCKETS } from '../utils/radioSf';

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
  /** Route types shown (Flood, TransportFlood, Direct, TransportDirect). */
  enabledRoutes: Set<string>;
  /** SF buckets shown (`SF5`..`SF12`, `Unknown` = heard before stamps existed). */
  enabledSfs: Set<string>;
  hexFilter: string;
  groupByHash: boolean;
  /**
   * Hide packets whose decoded channel message is malformed (the chat filter's
   * rule). Remembered in this browser; only the live feed knows the flag.
   */
  hideMalformed: boolean;
  /**
   * Show Full capture damaged frames (CRC or header error) in the live feed.
   * Off by default; remembered in this browser.
   */
  showDamaged: boolean;
  /**
   * Only packets with an OpenHop policy verdict (a rule, or the default action,
   * decided them). Session-only. Packet History filters on the server.
   */
  policyOnly: boolean;
  /** Raw search input (decoded text/sender/channel, and the policy rule name). */
  searchQuery: string;

  allTypesEnabled: boolean;
  allHopWidthsEnabled: boolean;
  allRoutesEnabled: boolean;
  allSfsEnabled: boolean;
  hexQuery: string;
  hexInvalid: boolean;
  /** Trimmed search query; empty string means "no search". */
  searchTerm: string;
  activeFilterCount: number;

  toggleAll: () => void;
  toggleType: (type: string) => void;
  onlyType: (type: string) => void;
  toggleAllHopWidths: () => void;
  toggleHopWidth: (bucket: string) => void;
  onlyHopWidth: (bucket: string) => void;
  toggleAllRoutes: () => void;
  toggleRoute: (route: string) => void;
  onlyRoute: (route: string) => void;
  toggleAllSfs: () => void;
  toggleSf: (bucket: string) => void;
  onlySf: (bucket: string) => void;
  setHexFilter: (value: string) => void;
  setGroupByHash: (value: boolean) => void;
  setHideMalformed: (value: boolean) => void;
  setShowDamaged: (value: boolean) => void;
  setPolicyOnly: (value: boolean) => void;
  setSearchQuery: (value: string) => void;
  reset: () => void;
}

const HIDE_MALFORMED_KEY = 'remoteterm-packet-feed-hide-malformed';
const SHOW_DAMAGED_KEY = 'remoteterm-packet-feed-show-damaged';

function getSavedFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

function getSavedHideMalformed(): boolean {
  return getSavedFlag(HIDE_MALFORMED_KEY);
}

export interface UsePacketFiltersOptions {
  /**
   * Server-persisted initial value for the "Group repeats by content" toggle.
   * Kept in sync when it changes (e.g. once app settings load), so the last
   * selection is remembered across sessions.
   */
  initialGroupByHash?: boolean;
  /** Called whenever the group-by-content toggle changes, to persist it. */
  onGroupByHashChange?: (value: boolean) => void;
}

export function usePacketFilters(options: UsePacketFiltersOptions = {}): PacketFilters {
  const { initialGroupByHash = false, onGroupByHashChange } = options;
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(() => new Set(KNOWN_PAYLOAD_TYPES));
  const [enabledHopWidths, setEnabledHopWidths] = useState<Set<string>>(
    () => new Set(HOP_BYTE_WIDTH_BUCKETS)
  );
  const [enabledRoutes, setEnabledRoutes] = useState<Set<string>>(
    () => new Set(ROUTE_FILTER_TYPES)
  );
  const [enabledSfs, setEnabledSfs] = useState<Set<string>>(() => new Set(SF_FILTER_BUCKETS));
  const [hexFilter, setHexFilter] = useState('');
  const [groupByHash, setGroupByHashState] = useState(initialGroupByHash);
  const [hideMalformed, setHideMalformedState] = useState(getSavedHideMalformed);
  const [showDamaged, setShowDamagedState] = useState(() => getSavedFlag(SHOW_DAMAGED_KEY));
  const [policyOnly, setPolicyOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Adopt the persisted value once app settings load (or change elsewhere).
  useEffect(() => {
    setGroupByHashState(initialGroupByHash);
  }, [initialGroupByHash]);

  // Update local state and persist the new value.
  const setGroupByHash = useCallback(
    (value: boolean) => {
      setGroupByHashState(value);
      onGroupByHashChange?.(value);
    },
    [onGroupByHashChange]
  );

  const setHideMalformed = useCallback((value: boolean) => {
    setHideMalformedState(value);
    try {
      localStorage.setItem(HIDE_MALFORMED_KEY, String(value));
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  }, []);

  const setShowDamaged = useCallback((value: boolean) => {
    setShowDamagedState(value);
    saveFlag(SHOW_DAMAGED_KEY, value);
  }, []);

  const allTypesEnabled = enabledTypes.size === KNOWN_PAYLOAD_TYPES.length;
  const allHopWidthsEnabled = enabledHopWidths.size === HOP_BYTE_WIDTH_BUCKETS.length;
  const allRoutesEnabled = enabledRoutes.size === ROUTE_FILTER_TYPES.length;
  const allSfsEnabled = enabledSfs.size === SF_FILTER_BUCKETS.length;

  const { query: hexQuery, invalid: hexInvalid } = useMemo(
    () => normalizeHexQuery(hexFilter),
    [hexFilter]
  );

  const searchTerm = searchQuery.trim();

  const activeFilterCount =
    KNOWN_PAYLOAD_TYPES.length -
    enabledTypes.size +
    (HOP_BYTE_WIDTH_BUCKETS.length - enabledHopWidths.size) +
    (ROUTE_FILTER_TYPES.length - enabledRoutes.size) +
    (SF_FILTER_BUCKETS.length - enabledSfs.size) +
    (hexFilter.trim() !== '' ? 1 : 0) +
    (groupByHash ? 1 : 0) +
    (hideMalformed ? 1 : 0) +
    (showDamaged ? 1 : 0) +
    (policyOnly ? 1 : 0);

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

  const toggleAllRoutes = useCallback(() => {
    setEnabledRoutes((prev) =>
      prev.size === ROUTE_FILTER_TYPES.length ? new Set() : new Set(ROUTE_FILTER_TYPES)
    );
  }, []);

  const toggleRoute = useCallback((route: string) => {
    setEnabledRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(route)) next.delete(route);
      else next.add(route);
      return next;
    });
  }, []);

  const onlyRoute = useCallback((route: string) => setEnabledRoutes(new Set([route])), []);

  const toggleAllSfs = useCallback(() => {
    setEnabledSfs((prev) =>
      prev.size === SF_FILTER_BUCKETS.length ? new Set() : new Set(SF_FILTER_BUCKETS)
    );
  }, []);

  const toggleSf = useCallback((bucket: string) => {
    setEnabledSfs((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }, []);

  const onlySf = useCallback((bucket: string) => setEnabledSfs(new Set([bucket])), []);

  const reset = useCallback(() => {
    setEnabledTypes(new Set(KNOWN_PAYLOAD_TYPES));
    setEnabledHopWidths(new Set(HOP_BYTE_WIDTH_BUCKETS));
    setEnabledRoutes(new Set(ROUTE_FILTER_TYPES));
    setEnabledSfs(new Set(SF_FILTER_BUCKETS));
    setHexFilter('');
    setGroupByHash(false);
    setHideMalformed(false);
    setShowDamaged(false);
    setPolicyOnly(false);
    setSearchQuery('');
  }, [setGroupByHash, setHideMalformed, setShowDamaged]);

  return {
    enabledTypes,
    enabledHopWidths,
    enabledRoutes,
    enabledSfs,
    hexFilter,
    groupByHash,
    hideMalformed,
    showDamaged,
    policyOnly,
    searchQuery,
    allTypesEnabled,
    allHopWidthsEnabled,
    allRoutesEnabled,
    allSfsEnabled,
    hexQuery,
    hexInvalid,
    searchTerm,
    activeFilterCount,
    toggleAll,
    toggleType,
    onlyType,
    toggleAllHopWidths,
    toggleHopWidth,
    onlyHopWidth,
    toggleAllRoutes,
    toggleRoute,
    onlyRoute,
    toggleAllSfs,
    toggleSf,
    onlySf,
    setHexFilter,
    setGroupByHash,
    setHideMalformed,
    setShowDamaged,
    setPolicyOnly,
    setSearchQuery,
    reset,
  };
}
