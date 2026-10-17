import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
} from '../../types';
import type { CvdMode, Tone } from '../../utils/accessibility';
import { getDataColors } from '../../utils/cvd/palettes';
import { NODE_TYPE_STROKE } from './nodesLayer';

// Per-role node stroke colour (the type encoding). Fill stays recency-based and
// the node-size slider is unchanged; only the stroke/role colour is user-editable.
export type NodeRoleColors = Record<number, string>;

/** Contact roles shown in the colour picker + legend, in display order. */
export const NODE_ROLE_TYPES: readonly number[] = [
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
];

export const DEFAULT_NODE_ROLE_COLORS: NodeRoleColors = { ...NODE_TYPE_STROKE };

export const NODE_ROLE_COLORS_STORAGE_KEY = 'remoteterm-node-role-colors';

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Merge a persisted (possibly partial/invalid) colour map over the defaults,
 *  keeping only the four known roles and valid 6-digit hex values. */
export function normalizeRoleColors(saved: unknown): NodeRoleColors {
  const out: NodeRoleColors = { ...DEFAULT_NODE_ROLE_COLORS };
  if (saved && typeof saved === 'object') {
    const rec = saved as Record<string, unknown>;
    for (const type of NODE_ROLE_TYPES) {
      const v = rec[String(type)];
      if (typeof v === 'string' && HEX6.test(v)) out[type] = v;
    }
  }
  return out;
}

export function getSavedNodeRoleColors(): NodeRoleColors {
  try {
    const raw = localStorage.getItem(NODE_ROLE_COLORS_STORAGE_KEY);
    if (raw) return normalizeRoleColors(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_NODE_ROLE_COLORS };
}

/** Store only the roles that differ from the defaults (none: no key), so a
 *  stock colour stays "not customised" and the colourblind mode can swap it. */
export function saveNodeRoleColors(colors: NodeRoleColors): void {
  const changed: NodeRoleColors = {};
  for (const type of NODE_ROLE_TYPES) {
    const c = colors[type];
    if (c && c.toLowerCase() !== DEFAULT_NODE_ROLE_COLORS[type].toLowerCase()) changed[type] = c;
  }
  try {
    if (Object.keys(changed).length === 0) {
      localStorage.removeItem(NODE_ROLE_COLORS_STORAGE_KEY);
    } else {
      localStorage.setItem(NODE_ROLE_COLORS_STORAGE_KEY, JSON.stringify(changed));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Role colours to draw. Under a colourblind mode, every role still on its stock
 * colour takes the mode's palette colour; a colour the user picked is kept.
 * A saved value equal to the stock default counts as not customised.
 */
export function effectiveRoleColors(
  saved: NodeRoleColors,
  mode: CvdMode,
  tone: Tone
): NodeRoleColors {
  if (mode === 'off') return saved;
  const palette = getDataColors(mode, tone).roles;
  const out: NodeRoleColors = { ...saved };
  for (const type of NODE_ROLE_TYPES) {
    const c = saved[type];
    if (!c || c.toLowerCase() === DEFAULT_NODE_ROLE_COLORS[type].toLowerCase()) {
      out[type] = palette[type];
    }
  }
  return out;
}
