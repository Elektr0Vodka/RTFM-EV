// Client-side cache and merge for the channel-finder wordlist sync (plan [09]).
//
// The browser cracker's bundled ENGLISH_WORDLIST is static. This module caches a
// remote candidate-name list (fetched via GET /api/registry/wordlist-sync) in
// localStorage and merges it with the bundled list before the single
// setWordlist() call. Sync uses REPLACE semantics (each sync stores the exact
// synced set), unlike the Channel Registry's add-only merge, because an upstream
// wordlist can shrink or rename entries and stale candidates should not linger.

const STORAGE_KEY = 'meshcore-wordlist-sync-cache';

/** Load the last synced candidate-name list. Returns [] on any read/parse error. */
export function loadSyncedWordlist(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

/** Replace the cached synced wordlist with the given set. */
export function saveSyncedWordlist(words: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
  } catch {
    // Quota exceeded or storage unavailable: keep the in-memory merge working
    // for this session; the sync just will not persist across reloads.
  }
}

/**
 * Merge candidate lists into one deduplicated array, preserving first-seen
 * order. Dedupe is case-insensitive since the cracker lowercases candidates
 * anyway; the first-seen casing is kept.
 */
export function mergeWordlists(...lists: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      if (typeof raw !== 'string') continue;
      const word = raw.trim();
      if (!word) continue;
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(word);
    }
  }
  return out;
}

// Second, independent cache: candidate names derived from the local Channel
// Registry (filled by the "Sync from channels" button in the cracker). Kept
// separate from the remote-sync cache so the two sources stay independently
// inspectable and re-syncable. Replace semantics, same as the remote cache.
const REGISTRY_STORAGE_KEY = 'meshcore-wordlist-registry-cache';

/** Load the last registry-synced candidate-name list. Returns [] on any read/parse error. */
export function loadRegistryWordlist(): string[] {
  try {
    const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

/** Replace the cached registry-derived wordlist with the given set. */
export function saveRegistryWordlist(words: string[]): void {
  try {
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(words));
  } catch {
    // Quota exceeded or storage unavailable: the in-memory merge still works for
    // this session; the sync just will not persist across reloads.
  }
}

/**
 * Turn registry channel names (each starting with '#', per
 * addableRegistryChannelNames) into cracker candidates: strip a single leading
 * '#', trim, drop empties. Dedupe/normalisation happens later in mergeWordlists.
 */
export function registryWordlistCandidates(names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const stripped = (raw.startsWith('#') ? raw.slice(1) : raw).trim();
    if (stripped) out.push(stripped);
  }
  return out;
}
