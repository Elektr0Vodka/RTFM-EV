// Sidebar layout preferences (section order, tool order, rail collapse).
//
// These are client-local UI preferences persisted to localStorage, matching the
// established precedent (migration _051_drop_sidebar_sort_order.py deliberately
// moved sidebar sort order out of the backend into localStorage). Key names reuse
// the old fork's names for a clean migration.

// Reorderable list sections (Mark-All-Read is a pinned action row, not reorderable).
export type SidebarSectionKey =
  | 'tools'
  | 'favorites'
  | 'channels'
  | 'contacts'
  | 'repeaters'
  | 'rooms';

export const ALL_SECTION_KEYS: SidebarSectionKey[] = [
  'tools',
  'favorites',
  'channels',
  'contacts',
  'repeaters',
  'rooms',
];

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

function loadOrder<T extends string>(key: string, all: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...all];
    return reconcile<T>(JSON.parse(raw), all);
  } catch {
    return [...all];
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write failures (private mode, disabled storage).
  }
}

export function loadSectionOrder(): SidebarSectionKey[] {
  return loadOrder(SECTION_ORDER_KEY, ALL_SECTION_KEYS);
}
export function saveSectionOrder(order: SidebarSectionKey[]): void {
  saveJson(SECTION_ORDER_KEY, order);
}
export function loadToolOrder(): SidebarToolKey[] {
  return loadOrder(TOOL_ORDER_KEY, ALL_TOOL_KEYS);
}
export function saveToolOrder(order: SidebarToolKey[]): void {
  saveJson(TOOL_ORDER_KEY, order);
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
    localStorage.removeItem(SECTION_ORDER_KEY);
    localStorage.removeItem(TOOL_ORDER_KEY);
    localStorage.removeItem(RAIL_KEY);
  } catch {
    // Ignore.
  }
}
