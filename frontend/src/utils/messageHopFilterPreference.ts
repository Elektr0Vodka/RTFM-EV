// Legacy browser-local storage for the chat "Hide by hop size" filter (hiding
// messages by their path hop byte width, 1/2/3). The filter now lives in the
// server-side `hidden_hop_widths` app setting so unread counts, mentions and
// Web Push honour it too; these helpers only read and clear the old key so
// useAppSettings can migrate it once.

export const HIDDEN_HOP_WIDTHS_KEY = 'remoteterm-hidden-hop-widths';

const VALID_WIDTHS = [1, 2, 3];

/** The legacy locally stored hidden widths (sorted, valid only), or [] when absent. */
export function readLegacyHiddenHopWidths(): number[] {
  try {
    const raw = localStorage.getItem(HIDDEN_HOP_WIDTHS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set<number>(parsed.filter((n) => VALID_WIDTHS.includes(n)))].sort();
  } catch {
    return [];
  }
}

export function clearLegacyHiddenHopWidths(): void {
  try {
    localStorage.removeItem(HIDDEN_HOP_WIDTHS_KEY);
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
