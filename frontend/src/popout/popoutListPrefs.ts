/**
 * How the chat popup's two lists are sorted, folded and filtered. Kept in this
 * browser only and apart from the main sidebar's sort settings: the popup's
 * list is its own, shorter thing.
 */
export type PopoutSection = 'channels' | 'direct' | 'rooms';

export type PopoutSortOrder =
  'recent' | 'oldest' | 'alpha' | 'alpha-desc' | 'unread' | 'nearest' | 'farthest';

export type PopoutSenderSort =
  'alpha' | 'alpha-desc' | 'recent' | 'messages' | 'nearest' | 'farthest';

export const POPOUT_SECTIONS: readonly PopoutSection[] = ['channels', 'direct', 'rooms'];

const CONTACT_SORTS: readonly PopoutSortOrder[] = [
  'recent',
  'oldest',
  'alpha',
  'alpha-desc',
  'unread',
  'nearest',
  'farthest',
];

/** The orders each section offers. Channels have no location, so no distance. */
export const POPOUT_SECTION_SORTS: Record<PopoutSection, readonly PopoutSortOrder[]> = {
  channels: ['recent', 'oldest', 'alpha', 'alpha-desc', 'unread'],
  direct: CONTACT_SORTS,
  rooms: CONTACT_SORTS,
};

export const POPOUT_SENDER_SORTS: readonly PopoutSenderSort[] = [
  'alpha',
  'alpha-desc',
  'recent',
  'messages',
  'nearest',
  'farthest',
];

export function isDistanceSort(order: PopoutSortOrder | PopoutSenderSort): boolean {
  return order === 'nearest' || order === 'farthest';
}

export interface PopoutListPrefs {
  sort: Record<PopoutSection, PopoutSortOrder>;
  collapsed: Record<PopoutSection, boolean>;
  favoritesOnly: boolean;
  unreadOnly: boolean;
  hideMuted: boolean;
  senderSort: PopoutSenderSort;
  sendersCollapsed: boolean;
}

/** The orders the lists had before they could be changed. */
export const DEFAULT_POPOUT_LIST_PREFS: PopoutListPrefs = {
  sort: { channels: 'alpha', direct: 'recent', rooms: 'recent' },
  collapsed: { channels: false, direct: false, rooms: false },
  favoritesOnly: false,
  unreadOnly: false,
  hideMuted: false,
  senderSort: 'alpha',
  sendersCollapsed: false,
};

export const POPOUT_LIST_PREFS_KEY = 'rtfm-popout-list-prefs';

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function getSavedPopoutListPrefs(): PopoutListPrefs {
  const defaults = DEFAULT_POPOUT_LIST_PREFS;
  let raw: Record<string, unknown> = {};
  try {
    raw = record(JSON.parse(localStorage.getItem(POPOUT_LIST_PREFS_KEY) ?? 'null'));
  } catch {
    // unreadable or unavailable: defaults
  }
  const sort = record(raw.sort);
  const collapsed = record(raw.collapsed);
  const perSection = <T>(pick: (section: PopoutSection) => T) =>
    Object.fromEntries(POPOUT_SECTIONS.map((section) => [section, pick(section)])) as Record<
      PopoutSection,
      T
    >;

  return {
    sort: perSection((section) =>
      oneOf(sort[section], POPOUT_SECTION_SORTS[section], defaults.sort[section])
    ),
    collapsed: perSection((section) => flag(collapsed[section], defaults.collapsed[section])),
    favoritesOnly: flag(raw.favoritesOnly, defaults.favoritesOnly),
    unreadOnly: flag(raw.unreadOnly, defaults.unreadOnly),
    hideMuted: flag(raw.hideMuted, defaults.hideMuted),
    senderSort: oneOf(raw.senderSort, POPOUT_SENDER_SORTS, defaults.senderSort),
    sendersCollapsed: flag(raw.sendersCollapsed, defaults.sendersCollapsed),
  };
}

export function savePopoutListPrefs(prefs: PopoutListPrefs): void {
  try {
    localStorage.setItem(POPOUT_LIST_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable
  }
}

/** Adopt a change made in another popup (other document, so a `storage` event). */
export function watchPopoutListPrefs(onChange: (prefs: PopoutListPrefs) => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === POPOUT_LIST_PREFS_KEY) onChange(getSavedPopoutListPrefs());
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
