/**
 * Filtering for the map's "heard by this server" dimension.
 *
 * A contact row shows "Never heard by this server" when its `last_seen` is
 * null: it was imported from the radio's contact table (snapshot sync or a
 * NEW_CONTACT push) or added manually, but the server has not itself observed
 * any RF activity (advert, DM, discovery) that would stamp `last_seen`. This
 * dimension lets the user show all contacts, hide those never-heard rows, or
 * isolate only them.
 */

export type HeardFilterMode = 'all' | 'hide' | 'only';

/** Whether a contact passes the heard/never-heard dimension alone. */
export function passesHeardFilter(
  lastSeen: number | null | undefined,
  mode: HeardFilterMode
): boolean {
  switch (mode) {
    case 'hide':
      return lastSeen != null;
    case 'only':
      return lastSeen == null;
    case 'all':
    default:
      return true;
  }
}

export interface ContactVisibilityInput {
  lastSeen: number | null | undefined;
  mode: HeardFilterMode;
  /** The contact is the explicit focus target (search/selection). */
  isFocused: boolean;
  /** Precomputed result of the map's "since" time-window check for this contact. */
  isWithinSinceWindow: boolean;
}

/**
 * Combine the heard filter, the since window, and the focus override into a
 * single visibility decision for a contact marker.
 *
 * Rules:
 * - A focused contact is always shown, regardless of either filter.
 * - `only` mode bypasses the since window: never-heard contacts have no
 *   `last_seen` timestamp, so a relative window would otherwise hide all of
 *   them and make the mode look broken.
 * - Otherwise the since window applies as before.
 */
export function isContactVisibleForFilters({
  lastSeen,
  mode,
  isFocused,
  isWithinSinceWindow,
}: ContactVisibilityInput): boolean {
  if (isFocused) return true;
  if (!passesHeardFilter(lastSeen, mode)) return false;
  if (mode === 'only') return true;
  return isWithinSinceWindow;
}
