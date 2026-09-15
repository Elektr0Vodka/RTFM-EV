// Sidebar layout preferences (section order, tool order, favorites-group order,
// rail collapse).
//
// The three drag-orders (section, tool, favorites-group) are persisted
// SERVER-SIDE in app_settings so they sync across devices. This module holds the
// pure reconcilers that turn a stored server value into a valid, complete order,
// plus a one-time reader for legacy localStorage orders so they can be migrated
// up to the server. Rail-collapse stays client-local (a per-device viewport
// preference), as does the legacy section/tool localStorage until migrated.

// Reorderable list sections (Mark-All-Read is a pinned action row, not reorderable).
export type SidebarSectionKey = 'tools' | 'favorites' | 'channels' | 'contacts';

export const ALL_SECTION_KEYS: SidebarSectionKey[] = ['tools', 'favorites', 'channels', 'contacts'];

// Tool rows, keyed to match the existing render in Sidebar.tsx.
export type SidebarToolKey =
  | 'my-node'
  | 'mesh-health'
  | 'raw'
  | 'map'
  | 'visualizer'
  | 'trace'
  | 'search'
  | 'channel-registry'
  | 'cracker';

export const ALL_TOOL_KEYS: SidebarToolKey[] = [
  'my-node',
  'mesh-health',
  'raw',
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
export function resolveSectionOrder(serverValue: unknown): SidebarSectionKey[] {
  return reconcile<SidebarSectionKey>(serverValue, ALL_SECTION_KEYS);
}
export function resolveToolOrder(serverValue: unknown): SidebarToolKey[] {
  return reconcile<SidebarToolKey>(serverValue, ALL_TOOL_KEYS);
}
export function resolveFavoritesOrder(serverValue: unknown): FavoriteGroupKey[] {
  return reconcile<FavoriteGroupKey>(serverValue, ALL_FAVORITE_GROUP_KEYS);
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
