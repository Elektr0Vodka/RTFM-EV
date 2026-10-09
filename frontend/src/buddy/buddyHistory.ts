import type { BuddyLineKind, BuddyTarget } from './buddyCatalog';
import type { BuddyGroup } from './buddyLogic';

/** One line the buddy said, or kept back while it was quiet. */
export interface BuddyHistoryEntry {
  /** Epoch ms. */
  at: number;
  kind: BuddyLineKind;
  group: BuddyGroup | null;
  text: string;
  target: BuddyTarget | null;
  /** False when the line was kept back during a quiet period. */
  shown: boolean;
}

export const BUDDY_HISTORY_LIMIT = 20;

// Session-wide and in memory: survives the host re-mounting, not a reload.
const entries: BuddyHistoryEntry[] = [];

export function recordBuddyLine(entry: BuddyHistoryEntry): void {
  entries.push(entry);
  if (entries.length > BUDDY_HISTORY_LIMIT) entries.splice(0, entries.length - BUDDY_HISTORY_LIMIT);
}

/** Oldest first. */
export function getBuddyHistory(): readonly BuddyHistoryEntry[] {
  return entries;
}

export function clearBuddyHistory(): void {
  entries.length = 0;
}
