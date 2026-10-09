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
} as const;

/** Anchor id of a sidebar conversation row. */
export function conversationAnchor(type: 'contact' | 'channel', id: string): string {
  return `conversation:${type}:${id.toLowerCase()}`;
}

/**
 * Centre (viewport px) of the first tagged element that is on screen, or null:
 * not rendered, no size (hidden) or outside the viewport.
 */
export function findAnchorPoint(anchor: string): { x: number; y: number } | null {
  if (typeof document === 'undefined') return null;
  for (const el of document.querySelectorAll(`[${BUDDY_ANCHOR_ATTR}]`)) {
    if (el.getAttribute(BUDDY_ANCHOR_ATTR) !== anchor) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
    return { x, y };
  }
  return null;
}
