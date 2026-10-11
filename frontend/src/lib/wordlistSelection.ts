// Per-browser persistence of which channel-finder wordlist bases are enabled.
// Cracking runs client-side and English/Dutch/known channels are client
// resources, so the SELECTION is a browser preference; custom-list CONTENTS live
// on the server and are referenced here only by id. Any combination can be on.

export interface WordlistSelection {
  english: boolean;
  dutch: boolean;
  /** Bundled channel names from the MCCL list (public/wordlists/known-channels.txt). */
  knownChannels: boolean;
  customIds: number[];
}

const STORAGE_KEY = 'meshcore-wordlist-selection';

export const DEFAULT_SELECTION: WordlistSelection = {
  english: true,
  dutch: false,
  knownChannels: true,
  customIds: [],
};

/** Load the saved selection, falling back to the default on any error. */
export function loadSelection(): WordlistSelection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SELECTION };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SELECTION };
    return {
      english: typeof parsed.english === 'boolean' ? parsed.english : DEFAULT_SELECTION.english,
      dutch: typeof parsed.dutch === 'boolean' ? parsed.dutch : DEFAULT_SELECTION.dutch,
      knownChannels:
        typeof parsed.knownChannels === 'boolean'
          ? parsed.knownChannels
          : DEFAULT_SELECTION.knownChannels,
      customIds: Array.isArray(parsed.customIds)
        ? parsed.customIds.filter((n: unknown): n is number => typeof n === 'number')
        : [],
    };
  } catch {
    return { ...DEFAULT_SELECTION };
  }
}

/** Persist the selection. Silently no-ops if storage is unavailable. */
export function saveSelection(selection: WordlistSelection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Quota exceeded or storage unavailable: selection just will not persist.
  }
}
