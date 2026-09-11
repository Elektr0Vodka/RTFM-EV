import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Conversation } from '../types';
import { getStateKey } from '../utils/conversationState';

export const SIDEBAR_SEEN_ITEMS_KEY = 'remoteterm-sidebar-seen-items';

function loadSeen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_SEEN_ITEMS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return null;
  }
}

function persistSeen(seen: Set<string>): void {
  try {
    localStorage.setItem(SIDEBAR_SEEN_ITEMS_KEY, JSON.stringify([...seen]));
  } catch {
    // localStorage may be disabled; keep in-memory only.
  }
}

export interface SeenItems {
  /** True when the identity is not in the seen set (and a baseline exists). */
  isNew: (identity: string) => boolean;
  /** Count of the given identities that are new. */
  countNew: (identities: string[]) => number;
  /** Mark the given identities seen (idempotent, persisted). */
  markSeen: (identities: string[]) => void;
}

/**
 * Tracks which sidebar items the client has already seen so newly discovered
 * items can be surfaced. Identity is the canonical conversation key from
 * getStateKey(type, id).
 *
 * On first run (no stored baseline) the first non-empty identity list is recorded
 * as the baseline, so nothing is flagged new on initial load. Only items that
 * appear after the baseline are new until opened or explicitly cleared.
 */
export function useSeenItems(
  allIdentities: string[],
  activeConversation: Conversation | null
): SeenItems {
  const [seen, setSeen] = useState<Set<string> | null>(() => loadSeen());
  const seenRef = useRef<Set<string> | null>(seen);
  seenRef.current = seen;

  // Baseline: first non-empty identity list with no stored baseline seeds the set.
  useEffect(() => {
    if (seenRef.current !== null) return;
    if (allIdentities.length === 0) return;
    const baseline = new Set(allIdentities);
    persistSeen(baseline);
    setSeen(baseline);
  }, [allIdentities]);

  // Mark the active channel/contact conversation seen when viewed. Deferred until
  // a baseline exists so it cannot pre-empt baseline seeding (the active item is
  // already part of the baseline snapshot).
  useEffect(() => {
    if (seenRef.current === null) return;
    if (!activeConversation) return;
    if (activeConversation.type !== 'channel' && activeConversation.type !== 'contact') return;
    const identity = getStateKey(activeConversation.type, activeConversation.id);
    setSeen((prev) => {
      if (!prev || prev.has(identity)) return prev;
      const next = new Set(prev);
      next.add(identity);
      persistSeen(next);
      return next;
    });
  }, [activeConversation]);

  const markSeen = useCallback((identities: string[]) => {
    setSeen((prev) => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      let changed = false;
      for (const id of identities) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (!changed) return prev;
      persistSeen(next);
      return next;
    });
  }, []);

  const isNew = useCallback(
    (identity: string): boolean => {
      if (seen === null) return false;
      return !seen.has(identity);
    },
    [seen]
  );

  const countNew = useCallback(
    (identities: string[]): number => {
      if (seen === null) return 0;
      let count = 0;
      for (const id of identities) if (!seen.has(id)) count++;
      return count;
    },
    [seen]
  );

  return useMemo(() => ({ isNew, countNew, markSeen }), [isNew, countNew, markSeen]);
}
