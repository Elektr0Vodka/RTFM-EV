// Browser-local preference for hiding chat messages by their path hop byte
// width (1-byte / 2-byte / 3-byte). Used to suppress spam that floods a channel
// at a given path-hash mode. Stored per-browser in localStorage; empty (nothing
// hidden) by default. Persisted so the choice survives the per-conversation
// remount of MessageList and page reloads.

export const HIDDEN_HOP_WIDTHS_KEY = 'remoteterm-hidden-hop-widths';

const VALID_WIDTHS = [1, 2, 3];

export function getSavedHiddenHopWidths(): Set<number> {
  try {
    const raw = localStorage.getItem(HIDDEN_HOP_WIDTHS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n) => VALID_WIDTHS.includes(n)));
  } catch {
    return new Set();
  }
}

export function setSavedHiddenHopWidths(widths: ReadonlySet<number>): void {
  try {
    if (widths.size === 0) {
      localStorage.removeItem(HIDDEN_HOP_WIDTHS_KEY);
    } else {
      localStorage.setItem(
        HIDDEN_HOP_WIDTHS_KEY,
        JSON.stringify([...widths].filter((n) => VALID_WIDTHS.includes(n)).sort())
      );
    }
  } catch {
    // localStorage may be unavailable
  }
}

// Whether to hide messages that carry no regional flood-scope ("unscoped"),
// e.g. global-flood noise. Off by default. Stored alongside the hop-width filter.
export const HIDE_UNSCOPED_KEY = 'remoteterm-hide-unscoped';

export function getSavedHideUnscoped(): boolean {
  try {
    return localStorage.getItem(HIDE_UNSCOPED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSavedHideUnscoped(hide: boolean): void {
  try {
    if (hide) {
      localStorage.setItem(HIDE_UNSCOPED_KEY, 'true');
    } else {
      localStorage.removeItem(HIDE_UNSCOPED_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
}
