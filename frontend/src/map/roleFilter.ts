import {
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_SENSOR,
} from '../types';

// Node roles the map role filter can toggle, in display order. A node's role is
// its numeric Contact.type. Roles not listed here (unknown types) have no toggle
// and are always visible.
export const ROLE_FILTER_TYPES: readonly number[] = [
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_SENSOR,
];

/**
 * A role is visible unless the user has toggled it off. `hiddenRoles` holds the
 * contact types that are currently switched off; an empty set means show all.
 */
export function isRoleVisibleForFilter(type: number, hiddenRoles: ReadonlySet<number>): boolean {
  return !hiddenRoles.has(type);
}

/** Parse the persisted hidden-roles list, keeping only known togglable roles. */
export function parseHiddenRoles(raw: string | null): Set<number> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((n): n is number => typeof n === 'number' && ROLE_FILTER_TYPES.includes(n))
    );
  } catch {
    return new Set();
  }
}

/** Serialize the hidden-roles set for localStorage persistence. */
export function serializeHiddenRoles(hidden: ReadonlySet<number>): string {
  return JSON.stringify([...hidden]);
}
