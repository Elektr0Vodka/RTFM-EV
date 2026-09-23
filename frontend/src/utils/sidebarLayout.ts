import type { ContactGroup, FavoriteSortOrder, SidebarFavoriteSortOrders } from '../types';

// Sidebar layout preferences (section order, tool order, favorites-group order,
// favorites-group sort orders, rail collapse).
//
// The three drag-orders (section, tool, favorites-group) are persisted
// SERVER-SIDE in app_settings so they sync across devices. This module holds the
// pure reconcilers that turn a stored server value into a valid, complete order,
// plus a one-time reader for legacy localStorage orders so they can be migrated
// up to the server. Rail-collapse stays client-local (a per-device viewport
// preference), as does the legacy section/tool localStorage until migrated.

// Reorderable list sections (Mark-All-Read is a pinned action row, not reorderable).
// A user-defined contact group also becomes a reorderable section, keyed
// `group:<id>` so it slots into the same order/hide/collapse machinery as the
// four built-in sections below (see groupSectionKey/isGroupSectionKey).
export type SidebarSectionKey = 'tools' | 'favorites' | 'channels' | 'contacts' | `group:${string}`;

export const ALL_SECTION_KEYS: SidebarSectionKey[] = ['tools', 'favorites', 'channels', 'contacts'];

const GROUP_SECTION_PREFIX = 'group:';

/** Section key for a user-defined contact group's sidebar section. */
export function groupSectionKey(groupId: string): SidebarSectionKey {
  return `${GROUP_SECTION_PREFIX}${groupId}`;
}

export function isGroupSectionKey(key: string): boolean {
  return key.startsWith(GROUP_SECTION_PREFIX);
}

/** Extracts the group id from a `group:<id>` section key. */
export function groupIdFromSectionKey(key: string): string {
  return key.slice(GROUP_SECTION_PREFIX.length);
}

// Tool rows, keyed to match the existing render in Sidebar.tsx.
export type SidebarToolKey =
  | 'my-node'
  | 'mesh-health'
  | 'mesh-trends'
  | 'mesh-discovery'
  | 'raw'
  | 'packet-history'
  | 'analyze'
  | 'map'
  | 'visualizer'
  | 'trace'
  | 'search'
  | 'channel-registry'
  | 'cracker';

export const ALL_TOOL_KEYS: SidebarToolKey[] = [
  'my-node',
  'mesh-health',
  'mesh-trends',
  'mesh-discovery',
  'raw',
  'packet-history',
  'analyze',
  'map',
  'visualizer',
  'trace',
  'search',
  'channel-registry',
  'cracker',
];

// Favorite type groups, orderable within the Favorites section (by-type mode).
export type FavoriteGroupKey = 'channels' | 'companions' | 'repeaters' | 'rooms' | 'sensors';

export const ALL_FAVORITE_GROUP_KEYS: FavoriteGroupKey[] = [
  'channels',
  'companions',
  'repeaters',
  'rooms',
  'sensors',
];

// Customize-sidebar entries the user has hidden from the sidebar. Each list
// holds keys hidden from that list; entries remain in the Customize panel.
export type SidebarHidden = {
  sections: SidebarSectionKey[];
  tools: SidebarToolKey[];
  favorites: FavoriteGroupKey[];
};

// Legacy localStorage keys (pre server-side move). Kept only so a one-time shim
// can migrate any stored orders up to the backend, then clear them.
const SECTION_ORDER_KEY = 'remoteterm-sidebar-section-order';
const TOOL_ORDER_KEY = 'remoteterm-sidebar-tool-order';
const RAIL_KEY = 'remoteterm-sidebar-rail-collapsed';

// Reconcile a stored order against the canonical key list: keep stored keys that
// are still valid (in order), drop unknown ones, append any newly-added keys.
function reconcile<T extends string>(stored: unknown, all: T[]): T[] {
  if (!Array.isArray(stored)) return [...all];
  const valid = stored.filter((k): k is T => all.includes(k as T));
  const missing = all.filter((k) => !valid.includes(k));
  return [...valid, ...missing];
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write failures (private mode, disabled storage).
  }
}

// Server-value reconcilers: turn the app_settings order (possibly empty/unset,
// stale, or containing unknown keys) into a valid, complete order.
//
// `groupIds` are the current user-defined contact groups: their section keys
// are valid alongside the four built-in ones, and any not yet in the stored
// order are appended (same "append newly-added keys" rule as the built-ins),
// so a freshly-created group shows up without needing a manual reorder. A
// group deleted since the order was last saved is silently dropped, same as
// any other unknown key.
export function resolveSectionOrder(
  serverValue: unknown,
  groupIds: string[] = []
): SidebarSectionKey[] {
  const all: SidebarSectionKey[] = [...ALL_SECTION_KEYS, ...groupIds.map(groupSectionKey)];
  return reconcile<SidebarSectionKey>(serverValue, all);
}
export function resolveToolOrder(serverValue: unknown): SidebarToolKey[] {
  return reconcile<SidebarToolKey>(serverValue, ALL_TOOL_KEYS);
}
export function resolveFavoritesOrder(serverValue: unknown): FavoriteGroupKey[] {
  return reconcile<FavoriteGroupKey>(serverValue, ALL_FAVORITE_GROUP_KEYS);
}

// Default sort order applied to a favorite group with no stored preference.
export const DEFAULT_FAVORITE_SORT_ORDER: FavoriteSortOrder = 'recent';

// Normalise the server's sidebar_favorite_sort_orders object into a complete,
// valid map (one order per favorite group). Unknown keys are dropped and any
// value other than 'alpha' falls back to the default 'recent'.
export function resolveFavoriteSortOrders(serverValue: unknown): SidebarFavoriteSortOrders {
  const obj = (serverValue ?? {}) as Record<string, unknown>;
  const coerce = (value: unknown): FavoriteSortOrder =>
    value === 'alpha' ? 'alpha' : DEFAULT_FAVORITE_SORT_ORDER;
  return {
    channels: coerce(obj.channels),
    companions: coerce(obj.companions),
    repeaters: coerce(obj.repeaters),
    rooms: coerce(obj.rooms),
    sensors: coerce(obj.sensors),
  };
}

// Normalise the server's sidebar_hidden object: keep only valid keys per list,
// tolerate a missing/invalid object.
export function resolveHidden(serverValue: unknown): SidebarHidden {
  const obj = (serverValue ?? {}) as Record<string, unknown>;
  const keep = <T extends string>(value: unknown, all: T[]): T[] =>
    Array.isArray(value) ? value.filter((k): k is T => all.includes(k as T)) : [];
  return {
    sections: keep(obj.sections, ALL_SECTION_KEYS),
    tools: keep(obj.tools, ALL_TOOL_KEYS),
    favorites: keep(obj.favorites, ALL_FAVORITE_GROUP_KEYS),
  };
}

// One-time migration helpers: read any legacy localStorage orders so the app can
// PATCH them up to the server, then clear them. A missing/corrupt key -> null.
export function readLegacyLocalOrders(): {
  section: SidebarSectionKey[] | null;
  tool: SidebarToolKey[] | null;
} {
  const readKey = <T extends string>(key: string, all: T[]): T[] | null => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return reconcile<T>(JSON.parse(raw), all);
    } catch {
      return null;
    }
  };
  return {
    section: readKey(SECTION_ORDER_KEY, ALL_SECTION_KEYS),
    tool: readKey(TOOL_ORDER_KEY, ALL_TOOL_KEYS),
  };
}

export function clearLegacyLocalOrders(): void {
  try {
    localStorage.removeItem(SECTION_ORDER_KEY);
    localStorage.removeItem(TOOL_ORDER_KEY);
  } catch {
    // Ignore.
  }
}

export function loadRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === 'true';
  } catch {
    return false;
  }
}
export function saveRailCollapsed(collapsed: boolean): void {
  saveJson(RAIL_KEY, collapsed);
}

export function resetSidebarLayout(): void {
  try {
    localStorage.removeItem(RAIL_KEY);
    localStorage.removeItem(SECTION_ORDER_KEY);
    localStorage.removeItem(TOOL_ORDER_KEY);
  } catch {
    // Ignore.
  }
}

// Per-group collapse state (which group sections are collapsed), keyed by
// group id. Client-local, same as every other section's collapse state.
const GROUP_COLLAPSE_KEY = 'remoteterm-sidebar-group-collapse-state';

export function loadGroupCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GROUP_COLLAPSE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean')
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function saveGroupCollapsed(state: Record<string, boolean>): void {
  saveJson(GROUP_COLLAPSE_KEY, state);
}

// --- Contact groups: pure state-transition helpers -------------------------
//
// Groups are stored server-side (app_settings.contact_groups) as a full list;
// every mutation below takes the current list and returns the next one, ready
// to hand to a full-list PATCH (see App.tsx handleSaveAppSettings). Keeping
// these pure and side-effect-free makes them independently testable and lets
// the same logic be shared by the Sidebar customize panel, ContactInfoBody
// and ChannelInfoPane.

function genGroupId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `grp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Builds a new, empty group with a fresh id and a trimmed name. */
export function createContactGroup(name: string): ContactGroup {
  return { id: genGroupId(), name: name.trim(), contact_keys: [], channel_keys: [] };
}

export function renameContactGroup(
  groups: ContactGroup[],
  groupId: string,
  name: string
): ContactGroup[] {
  const trimmed = name.trim();
  if (!trimmed) return groups;
  return groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g));
}

export function deleteContactGroup(groups: ContactGroup[], groupId: string): ContactGroup[] {
  return groups.filter((g) => g.id !== groupId);
}

/** Adds a member if absent, removes it if present. Contact keys are lowercased. */
export function toggleGroupMember(
  groups: ContactGroup[],
  groupId: string,
  kind: 'contact' | 'channel',
  key: string
): ContactGroup[] {
  const normalized = kind === 'contact' ? key.toLowerCase() : key;
  return groups.map((g) => {
    if (g.id !== groupId) return g;
    const field = kind === 'contact' ? 'contact_keys' : 'channel_keys';
    const current = g[field];
    const next = current.includes(normalized)
      ? current.filter((k) => k !== normalized)
      : [...current, normalized];
    return { ...g, [field]: next };
  });
}

/** Groups a contact currently belongs to (by lowercase public key). */
export function groupsContainingContact(
  groups: ContactGroup[],
  contactKey: string
): ContactGroup[] {
  const key = contactKey.toLowerCase();
  return groups.filter((g) => g.contact_keys.includes(key));
}

/** Groups a channel currently belongs to (by channel key). */
export function groupsContainingChannel(
  groups: ContactGroup[],
  channelKey: string
): ContactGroup[] {
  return groups.filter((g) => g.channel_keys.includes(channelKey));
}

export function isContactGrouped(groups: ContactGroup[], contactKey: string): boolean {
  return groupsContainingContact(groups, contactKey).length > 0;
}

export function isChannelGrouped(groups: ContactGroup[], channelKey: string): boolean {
  return groupsContainingChannel(groups, channelKey).length > 0;
}
