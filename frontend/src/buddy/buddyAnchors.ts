/**
 * Elements the desktop buddy can gesture toward. A component tags an element
 * with `data-buddy-anchor="<id>"`; the buddy looks it up at the moment it
 * speaks. The attribute does nothing else.
 */
export const BUDDY_ANCHOR_ATTR = 'data-buddy-anchor';

export const BUDDY_ANCHORS = {
  radio: 'status-radio',
  battery: 'status-battery',
  update: 'status-update',
  /** The phone menu button of the classic layout. */
  menu: 'nav-menu',
  theme: 'theme-button',
  /** The row with "Add channel/contact" at the top of the sidebar. */
  sidebarHead: 'sidebar-head',
  sidebarList: 'sidebar-list',
  sidebarTools: 'sidebar-tools',
  settingsNav: 'settings-nav',
  chatHeader: 'chat-header',
  composer: 'chat-composer',
  mapControls: 'map-controls',
  // The add-on tours (MeshCore 1.18, meshcomod).
  /** The command line console of the connected radio (Settings > Radio, My Node). */
  cliRadio: 'cli-radio',
  /** The command line toggle in a DM header. */
  chatCli: 'chat-cli-toggle',
  /** The meshcomod CAD toggle in a chat header. */
  chatCad: 'chat-cad',
  /** The Remote CLI permission switch in a contact's info. */
  remoteCli: 'contact-remote-cli',
  sensorPanel: 'sensor-panel',
  /** The Meshcomod (DMC-EV) panel in Settings > Radio. */
  meshcomod: 'settings-meshcomod',
  /** The companion receive filter card and two of its parts. */
  cfilter: 'cfilter',
  cfilterCounters: 'cfilter-counters',
  cfilterBackup: 'cfilter-backup',
} as const;

/** Anchor id of a sidebar conversation row. */
export function conversationAnchor(type: 'contact' | 'channel', id: string): string {
  return `conversation:${type}:${id.toLowerCase()}`;
}

/** Anchor id of a sidebar Tools row; `key` is the row's React key ("tool-map"). */
export function toolAnchor(key: string): string {
  return key;
}

/** Anchor id of a tab in the Atlas phone tab bar. */
export function tabAnchor(tab: string): string {
  return `tab-${tab}`;
}

/**
 * The first tagged element that is on screen with its box (viewport px), or
 * null: not rendered, no size (hidden) or its centre outside the viewport.
 * With `scrolledAway` an element that is rendered but outside the viewport
 * counts too (a row further down a scrolling list).
 */
export function findAnchorElement(
  anchor: string,
  scrolledAway = false
): { el: Element; rect: DOMRect } | null {
  if (typeof document === 'undefined') return null;
  for (const el of document.querySelectorAll(`[${BUDDY_ANCHOR_ATTR}]`)) {
    if (el.getAttribute(BUDDY_ANCHOR_ATTR) !== anchor) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const outside = x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight;
    if (outside && !scrolledAway) continue;
    return { el, rect };
  }
  return null;
}

/** Centre (viewport px) of the first tagged element that is on screen, or null. */
export function findAnchorPoint(anchor: string): { x: number; y: number } | null {
  const found = findAnchorElement(anchor);
  if (!found) return null;
  const { rect } = found;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
