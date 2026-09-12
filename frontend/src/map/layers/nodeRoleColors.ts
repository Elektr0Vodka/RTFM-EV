import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
} from '../../types';
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

export function saveNodeRoleColors(colors: NodeRoleColors): void {
  try {
    localStorage.setItem(NODE_ROLE_COLORS_STORAGE_KEY, JSON.stringify(colors));
  } catch {
    /* ignore */
  }
}
